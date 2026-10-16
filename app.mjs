import {LIMITS,isNumber,parseCSV,synthetic,quality,exportPackage} from './signal.mjs';
import {MotionCapture,browserEnvironment} from './capture.mjs';
const $=id=>document.getElementById(id);
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=2)=>!isNumber(x)?'—':Math.abs(x)>99999||(x!==0&&Math.abs(x)<.001)?x.toExponential(2):x.toLocaleString('es-ES',{maximumFractionDigits:d});
let dataset=null,result=null,capture=new MotionCapture(browserEnvironment(window)),worker=null,analysisId=0,importId=0,busy=false,liveTimer=null,startedAt=null;
const running=()=>['awaiting','recording'].includes(capture.status);
const channel=()=>dataset?.channels.find(c=>c.key===$('channel').value);
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function controls(){
  for(const id of ['duration','generate','csv-file','csv-confirm','gravity', 'channel'])$(id).disabled=running()||(id==='channel'&&!dataset);
  for(const el of document.querySelectorAll('[data-mode]'))el.disabled=running();
  $('start').disabled=running();$('stop').disabled=!running();
  $('analyze').disabled=!dataset||running()||busy||!quality(dataset.samples,channel()?.key).ok;
  $('export').disabled=!dataset?.samples.length||running();
}
function inventory(){
  const i=capture.inventory();
  $('inventory').innerHTML=[['Contexto seguro',i.secure?'Sí':'No'],['DeviceMotion',i.api?'API presente · datos sin probar':'No expuesto'],['Permiso estándar',i.permissionAPI?'Se solicitará al iniciar':'Sin método explícito'],['Barómetro / magnetómetro','No por esta API']].map(([a,b])=>`<div><dt>${escape(a)}</dt><dd>${escape(b)}</dd></div>`).join('');
}
function stopWorker(){++analysisId;worker?.terminate();worker=null;busy=false;}
function setDataset(next){
  stopWorker();dataset=next;result=null;
  if(dataset?.samples.length){
    const preferred=dataset.channels.find(c=>dataset.samples.some(s=>isNumber(s[c.key])))?.key||dataset.channels[0].key;
    $('channel').innerHTML=dataset.channels.map(c=>`<option value="${c.key}"${c.key===preferred?' selected':''}>${escape(c.label)} · ${escape(c.unit)}</option>`).join('');
  }else{dataset=null;$('channel').innerHTML='<option>Sin muestras</option>';}
  render();
}
function placeholder(text){return `<p class="empty-plot">${escape(text)}</p>`;}
function draw(points,{xlabel,ylabel,color='signal',title,xMin=0,xMax,yMin,yMax}){
  const finite=points.filter(p=>p&&isNumber(p[0])&&isNumber(p[1]));
  if(!finite.length)return placeholder('Sin valores observados en este canal.');
  xMax??=Math.max(...finite.map(p=>p[0]));yMin??=Math.min(0,...finite.map(p=>p[1]));yMax??=Math.max(0,...finite.map(p=>p[1]));
  if(xMax===xMin)xMax=xMin+1;if(yMax===yMin){yMax+=1;yMin-=1;}
  const pad=(yMax-yMin)*.07;yMax+=pad;yMin-=pad;
  if(![xMax-xMin,yMax-yMin].every(v=>Number.isFinite(v)&&v>0))return placeholder('Rango numérico no representable en la gráfica.');
  const W=800,H=285,L=85,R=26,T=23,B=54,px=v=>L+(v-xMin)/(xMax-xMin)*(W-L-R),py=v=>H-B-(v-yMin)/(yMax-yMin)*(H-T-B);
  let marks='';
  for(let i=0;i<=4;i++){
    const xv=xMin+(xMax-xMin)*i/4,yv=yMin+(yMax-yMin)*i/4;
    marks+=`<line class="gridline" x1="${px(xv)}" x2="${px(xv)}" y1="${T}" y2="${H-B}"/><line class="gridline" x1="${L}" x2="${W-R}" y1="${py(yv)}" y2="${py(yv)}"/><text class="axistext" text-anchor="middle" x="${px(xv)}" y="${H-B+22}">${fmt(xv)}</text><text class="axistext" text-anchor="end" x="${L-10}" y="${py(yv)+4}">${fmt(yv)}</text>`;
  }
  let d='',continuing=false;
  for(const p of points){if(!p||!isNumber(p[0])||!isNumber(p[1])){continuing=false;continue;}d+=`${continuing?'L':'M'}${px(p[0]).toFixed(3)},${py(p[1]).toFixed(3)} `;continuing=true;}
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${marks}<path class="${color}-line" d="${d}"/><text class="axislabel" text-anchor="middle" x="${(L+W-R)/2}" y="${H-8}">${escape(xlabel)}</text><text class="axislabel" text-anchor="middle" transform="translate(20 ${(T+H-B)/2}) rotate(-90)">${escape(ylabel)}</text></svg>`;
}
function render(){
  controls();$('peaks').innerHTML='';
  if(!dataset){
    for(const id of ['stat-n','stat-fs','stat-nyquist','stat-peak'])$(id).textContent='—';
    $('source-label').textContent='SIN SEÑAL';$('source-label').className='source-tag';
    $('time-caption').textContent='Sin datos';$('time-plot').innerHTML=placeholder('Sin muestras. Elige una entrada.');
    $('frequency-plot').innerHTML=placeholder('El espectro espera una señal válida.');
    $('spectrum-summary').textContent='El espectro no identifica por sí mismo una causa, gesto o avería.';
    $('quality-report').textContent='Sin muestras para evaluar.';return;
  }
  const c=channel(),q=quality(dataset.samples,c.key);
  $('source-label').textContent=dataset.label;$('source-label').className='source-tag'+(['synthetic','qa-motion'].includes(dataset.source)?' synthetic':'');
  $('stat-n').textContent=String(q.n);$('stat-fs').innerHTML=isNumber(q.fs)?`${fmt(q.fs)}<small>Hz</small>`:'—';
  $('stat-nyquist').innerHTML=isNumber(q.fs)?`${fmt(q.fs/2)}<small>Hz</small>`:'—';
  $('stat-peak').innerHTML=result?.peaks.length?`${fmt(result.peaks[0].hz)}<small>Hz</small>`:'—';
  $('time-caption').textContent=`${c.label} · ${c.unit} · ${fmt(q.duration)} s entre extremos`;
  if(q.invalidTimes)$('time-plot').innerHTML=placeholder('Timestamps inválidos: no se dibuja un calendario inventado.');
  else{
    const first=dataset.samples[0].timestamp_ms,points=[];
    dataset.samples.forEach((s,i)=>{if(i&&q.median&&s.timestamp_ms-dataset.samples[i-1].timestamp_ms>LIMITS.gap*q.median)points.push(null);points.push(isNumber(s[c.key])?[(s.timestamp_ms-first)/1000,s[c.key]]:null);});
    $('time-plot').innerHTML=draw(points,{xlabel:'Tiempo desde primera muestra (s)',ylabel:c.unit,title:`Serie temporal: ${c.label}, ${q.n} muestras, ${q.missing} valores ausentes. La línea une observaciones; no remuestrea.`});
  }
  $('quality-report').innerHTML=`<p class="source-description"><strong>Origen:</strong> ${escape(dataset.label)}. Gravedad: ${escape(dataset.gravity)}. ${escape(dataset.clock||'Timestamps declarados/generados en milisegundos.')}</p><div class="quality-grid"><p>Tasa (N−1)/duración: <strong>${fmt(q.fs)} Hz</strong></p><p>Mediana de intervalo: <strong>${fmt(q.median)} ms</strong></p><p>Variación de intervalos: <strong>${fmt(q.cv===null?null:q.cv*100)} %</strong></p><p>Desviación máxima: <strong>${fmt(q.maxDeviation===null?null:q.maxDeviation*100)} %</strong></p><p>Hueco máx. / mediana: <strong>${fmt(q.maxGapRatio)} ×</strong></p><p>Ausentes en canal: <strong>${q.missing} / ${q.n}</strong></p></div>${q.ok?'<p>Cadencia aceptada para esta exploración, sin garantía de reloj hardware ni filtrado antialias.</p>':`<ul class="quality-reasons">${q.reasons.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>`}<p>Valores recibidos por canal: ${dataset.channels.map(ch=>`${escape(ch.label)} ${dataset.samples.filter(s=>isNumber(s[ch.key])).length}/${q.n}`).join(' · ')}.</p>`;
  if(!q.ok){$('frequency-plot').innerHTML=placeholder('Espectro rechazado por calidad.');$('spectrum-summary').textContent=q.reasons.join(' ');$('quality-details').open=true;}
  else if(!result){$('frequency-plot').innerHTML=placeholder(busy?'Calculando en un trabajador local…':'Lista para calcular el espectro.');$('spectrum-summary').textContent='La tasa describe los timestamps observados. No acredita ausencia de aliasing ni frecuencia hardware.';}
  else{
    if(!result.quality.ok){$('frequency-plot').innerHTML=placeholder('Espectro no representable.');$('spectrum-summary').textContent=result.quality.reasons.join(' ');return;}
    $('frequency-plot').innerHTML=draw(result.bins.map(b=>[b.hz,b.amplitude]),{xlabel:'Frecuencia (Hz)',ylabel:`Amplitud (${c.unit})`,color:'spectrum',title:`Espectro unilateral de ${c.label}; resolución de bin ${fmt(result.binWidth,4)} Hz; límite Nyquist ${fmt(result.nyquist)} Hz.`,xMax:result.nyquist,yMin:0});
    $('spectrum-summary').textContent=`Resolución de bin ${fmt(result.binWidth,4)} Hz · ${q.n} muestras · amplitud unilateral corregida por Hann (${c.unit}). Picos en centros de bin, sin precisión sub-bin. ${dataset.warning||'Filtrado previo desconocido: las frecuencias superiores a Nyquist pueden plegarse.'}`;
    $('peaks').innerHTML=result.peaks.length?`<table class="peak-table"><caption>Picos exploratorios, sin diagnóstico</caption><thead><tr><th>Pico</th><th>Frecuencia (Hz)</th><th>Amplitud (${escape(c.unit)})</th></tr></thead><tbody>${result.peaks.map((p,i)=>`<tr><td>${i+1}</td><td>${fmt(p.hz,4)}</td><td>${fmt(p.amplitude,4)}</td></tr>`).join('')}</tbody></table>`:'<p class="small">No hay picos por encima del criterio exploratorio. No implica ausencia de movimiento o problema.</p>';
  }
}
function onStatus(s){
  $('capture-status').textContent=s.message;
  if(s.code==='recording'){startedAt=performance.now();$('capture-meter').max=Number($('duration').value);}
  if(!['recording','awaiting'].includes(s.code)){clearInterval(liveTimer);liveTimer=null;$('capture-progress').textContent=`${s.count} eventos`;}
  controls();if(['denied','unavailable','error'].includes(s.code))notice(s.message,true);
}
async function start(){
  ++importId;setDataset(null);startedAt=null;
  notice(capture.inventory().synthetic?'QA: solo eventos artificiales inyectados. No se solicitarán sensores físicos.':'Sesión en memoria. No se guardará un archivo automáticamente.');
  clearInterval(liveTimer);liveTimer=setInterval(()=>{$('capture-progress').textContent=`${capture.samples.length} eventos${startedAt===null?'':` · ${fmt((performance.now()-startedAt)/1000,1)} s`}`;if(startedAt!==null)$('capture-meter').value=(performance.now()-startedAt)/1000;},200);
  await capture.start({seconds:Number($('duration').value),onStatus,onComplete:d=>{setDataset(d.samples.length?d:null);notice(d.samples.length?`${d.label}. ${d.samples.length} eventos. Elige un canal y revisa su calidad antes del espectro.`:'Sesión terminada sin eventos. No hay medición que analizar.',!d.samples.length);}});
}
$('start').addEventListener('click',start);
$('stop').addEventListener('click',()=>capture.stop());
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>{
  if(running())return;
  for(const mode of ['device','csv','synthetic']){$(`mode-${mode}`).setAttribute('aria-pressed',String(mode===button.dataset.mode));$(`panel-${mode}`).hidden=mode!==button.dataset.mode;}
});
$('generate').addEventListener('click',()=>{if(running())return;++importId;setDataset(synthetic($('synthetic-kind').value));notice(dataset.label+'. '+dataset.warning);});
$('channel').addEventListener('change',()=>{stopWorker();result=null;render();});
$('csv-file').addEventListener('change',async()=>{
  const file=$('csv-file').files[0];if(!file||running())return;
  const id=++importId;setDataset(null);
  try{
    if(!$('csv-confirm').checked)throw Error('Confirma primero el contrato de unidades del CSV.');
    if(file.size>LIMITS.bytes)throw Error('El archivo supera 512 KiB: no se lee su contenido.');
    const gravity=$('gravity').value,text=await file.text();if(id!==importId)return;
    setDataset(parseCSV(text,{gravity}));notice(`CSV leído en memoria: ${dataset.samples.length} filas. Origen y unidades declarados, sin verificar calibración.`);
  }catch(error){if(id===importId)notice(`Importación rechazada. ${error.message}`,true);}
  finally{$('csv-file').value='';}
});
$('analyze').addEventListener('click',()=>{
  if(!dataset||running()||busy||!quality(dataset.samples,channel().key).ok)return;
  stopWorker();const id=analysisId;busy=true;render();
  try{
    worker=new Worker('./analysis-worker.mjs',{type:'module'});
    worker.onmessage=({data})=>{if(id!==analysisId)return;worker.terminate();worker=null;busy=false;if(data.error){notice(data.error,true);render();return;}result=data.result;render();notice(result.quality.ok?'Espectro calculado localmente. Picos exploratorios; no diagnóstico.':result.quality.reasons.join(' '),!result.quality.ok);};
    worker.onerror=()=>{if(id!==analysisId)return;stopWorker();render();notice('El trabajador de análisis no está disponible. No se presenta un resultado alternativo.',true);};
    worker.postMessage({id,samples:dataset.samples,key:channel().key});
  }catch(error){stopWorker();render();notice('No se pudo iniciar el análisis local. '+error.message,true);}
});
$('clear').addEventListener('click',()=>{++importId;capture.stop();setDataset(null);$('capture-meter').value=0;notice('Sesión vacía. No se ha guardado ningún archivo.');});
$('export').addEventListener('click',()=>{
  if(!dataset||running())return;
  const text=JSON.stringify(exportPackage(dataset),null,2)+'\n',url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='labo-senales-muestras-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  notice('Exportación manual solicitada: JSON v1 con origen, unidades y valores null conservados. No es el formato CSV de importación.');
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)capture.stop('hidden');});
window.addEventListener('pagehide',()=>{capture.stop('hidden');stopWorker();});
inventory();render();
