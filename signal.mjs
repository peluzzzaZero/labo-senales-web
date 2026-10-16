// Núcleo numérico propio. Criterios fijados en criterios.json antes de las pruebas.
export const LIMITS=Object.freeze({bytes:524288,max:2048,min:128,cv:.05,deviation:.20,gap:1.5});
export const XYZ=['x','y','z'].map(key=>({key,label:`Aceleración ${key}`,unit:'m/s²'}));
export const MOTION_CHANNELS=[
  ...['ax','ay','az'].map((key,i)=>({key,label:`Sin gravedad · ${'xyz'[i]}`,unit:'m/s²'})),
  ...['gx','gy','gz'].map((key,i)=>({key,label:`Con gravedad · ${'xyz'[i]}`,unit:'m/s²'})),
  ...['alpha','beta','gamma'].map(key=>({key,label:`Giro · ${key}`,unit:'°/s'}))
];
export const isNumber=x=>typeof x==='number'&&Number.isFinite(x);
const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function parseCSV(text,{gravity='desconocida'}={}){
  if(new TextEncoder().encode(text).length>LIMITS.bytes)throw Error('El CSV supera 512 KiB. No se ha cargado.');
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if(lines[0]?.trim()!=='timestamp_ms,x,y,z')throw Error('Cabecera exacta necesaria: timestamp_ms,x,y,z (separador coma).');
  if(lines.length-1<2||lines.length-1>LIMITS.max)throw Error('Se requieren entre 2 y 2048 filas, sin líneas vacías intermedias.');
  const samples=[];
  for(let i=1;i<lines.length;i++){
    const cells=lines[i].split(',').map(s=>s.trim());
    if(cells.length!==4||cells.some(s=>!numeric.test(s)||!Number.isFinite(Number(s))))throw Error(`Fila ${i+1}: cuatro números finitos obligatorios; no se rellenan vacíos.`);
    const [timestamp_ms,x,y,z]=cells.map(Number);
    if(timestamp_ms<0)throw Error(`Fila ${i+1}: timestamp_ms debe ser no negativo.`);
    if(samples.length&&timestamp_ms<=samples.at(-1).timestamp_ms)throw Error(`Fila ${i+1}: timestamp repetido o fuera de orden; no se ordena ni fusiona.`);
    samples.push({timestamp_ms,x,y,z});
  }
  return {source:'csv',label:'CSV importado · unidades declaradas',gravity,channels:XYZ,samples};
}
export function synthetic(kind='sine'){
  const definitions={sine:{fs:50,n:500,label:'SINTÉTICA · seno 5 Hz, amplitud 2 m/s²',tones:[[5,2]]},mix:{fs:100,n:1000,label:'SINTÉTICA · mezcla 7 + 13 Hz',tones:[[7,2],[13,.8]]},alias:{fs:50,n:500,label:'SINTÉTICA · 32 Hz muestreados a 50 Hz',tones:[[32,2]],warning:'El generador supera Nyquist (25 Hz): las muestras aparentan 18 Hz. Un espectro no recupera los 32 Hz originales.'},short:{fs:50,n:64,label:'SINTÉTICA · ventana insuficiente (64 muestras)',tones:[[5,2]]},irregular:{fs:50,n:500,label:'SINTÉTICA · cadencia irregular deliberada',tones:[[5,2]]}};
  const d=definitions[kind];if(!d)throw Error('Señal sintética desconocida.');
  const samples=Array.from({length:d.n},(_,i)=>{const t=1000*i/d.fs+(kind==='irregular'&&i%10===5?8:0);return {timestamp_ms:t,x:3+d.tones.reduce((s,[f,a])=>s+a*Math.sin(2*Math.PI*f*t/1000),0),y:0,z:0};});
  return {source:'synthetic',label:d.label,warning:d.warning||'Generada por fórmula, no por un sensor. Offset +3 m/s²; el análisis elimina la media.',gravity:'no aplicable: fórmula',channels:XYZ,samples,known:d};
}
export function quality(samples,key){
  const n=samples.length,reasons=[],intervals=[];
  const invalidTimes=samples.filter(s=>!isNumber(s.timestamp_ms)||s.timestamp_ms<0).length;
  const missing=samples.filter(s=>!isNumber(s[key])).length;
  if(n<LIMITS.min||n>LIMITS.max)reasons.push(`Muestras: ${n}; espectro requiere 128–2048.`);
  if(invalidTimes)reasons.push(`${invalidTimes} timestamps inválidos.`);
  let duplicates=0,backwards=0;
  for(let i=1;i<n;i++){const dt=samples[i].timestamp_ms-samples[i-1].timestamp_ms;intervals.push(dt);if(dt===0)duplicates++;if(dt<0)backwards++;}
  if(duplicates||backwards)reasons.push(`${duplicates} intervalos duplicados y ${backwards} en retroceso. No se reordenan.`);
  if(missing)reasons.push(`${missing} valores ausentes/no finitos en el canal; no se imputan ni se eliminan filas.`);
  const validTime=invalidTimes===0&&intervals.length>0&&intervals.every(v=>Number.isFinite(v)&&v>0);
  let fs=null,median=null,cv=null,maxDeviation=null,maxGapRatio=null,duration=null,gaps=null;
  if(validTime){
    duration=(samples.at(-1).timestamp_ms-samples[0].timestamp_ms)/1000;
    fs=(n-1)/duration;
    const sorted=[...intervals].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
    median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
    const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
    cv=Math.sqrt(intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length)/mean;
    maxDeviation=Math.max(...intervals.map(v=>Math.abs(v-median)/median));
    maxGapRatio=Math.max(...intervals)/median;gaps=intervals.filter(v=>v>LIMITS.gap*median).length;
    if(cv>LIMITS.cv+1e-12)reasons.push(`Variación de intervalos ${(100*cv).toFixed(2)}% > 5%.`);
    if(maxDeviation>LIMITS.deviation+1e-12)reasons.push(`Desviación máxima ${(100*maxDeviation).toFixed(2)}% > 20% de la mediana.`);
    if(maxGapRatio>LIMITS.gap+1e-12)reasons.push(`Hueco máximo ${maxGapRatio.toFixed(2)}× > 1,5× mediana.`);
  }else if(!invalidTimes&&!duplicates&&!backwards)reasons.push('No hay suficientes intervalos positivos para calcular la tasa.');
  if(fs!==null&&(!Number.isFinite(fs)||fs<=0||![duration,median,cv,maxDeviation,maxGapRatio].every(Number.isFinite))){fs=null;reasons.push('Rango temporal no representable.');}
  return {ok:reasons.length===0,n,missing,invalidTimes,duplicates,backwards,fs,median,cv,maxDeviation,maxGapRatio,gaps,duration,reasons};
}
export function spectrum(samples,key){
  const q=quality(samples,key);if(!q.ok)return {quality:q,bins:[],peaks:[]};
  const n=samples.length,values=samples.map(s=>s[key]);
  const mean=values.reduce((a,b)=>a+b/n,0); // Evita desbordar la suma para valores grandes.
  const w=values.map((_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1))),sumW=w.reduce((a,b)=>a+b,0);
  const data=values.map((v,i)=>(v-mean)*w[i]);
  // DFT directa y acotada: no presupone N potencia de dos, no rellena ni interpola.
  const bins=[];
  for(let k=0;k<=Math.floor(n/2);k++){
    let re=0,im=0;
    for(let i=0;i<n;i++){const angle=2*Math.PI*k*i/n;re+=data[i]*Math.cos(angle);im-=data[i]*Math.sin(angle);}
    const factor=k===0||(n%2===0&&k===n/2)?1:2;
    bins.push({hz:k*q.fs/n,amplitude:factor*Math.hypot(re,im)/sumW});
  }
  if(bins.some(b=>!Number.isFinite(b.amplitude)))return {quality:{...q,ok:false,reasons:['La amplitud desborda el rango numérico. No se presenta un espectro.']},bins:[],peaks:[]};
  const maximum=Math.max(...bins.slice(1).map(b=>b.amplitude)),threshold=Math.max(1e-10,maximum*.1);
  const candidates=[];
  for(let k=1;k<bins.length;k++)if(bins[k].amplitude>=threshold&&bins[k].amplitude>bins[k-1].amplitude&&(k===bins.length-1||bins[k].amplitude>=bins[k+1].amplitude))candidates.push({...bins[k],bin:k});
  candidates.sort((a,b)=>b.amplitude-a.amplitude);
  const peaks=[];for(const p of candidates)if(peaks.length<3&&peaks.every(x=>Math.abs(x.bin-p.bin)>=2))peaks.push(p);
  return {quality:q,bins,peaks,mean,nyquist:q.fs/2,binWidth:q.fs/n,window:'Hann simétrica',weightedEnergy:data.reduce((a,b)=>a+b*b,0),sumWindow:sumW};
}
export function exportPackage(dataset){
  if(!dataset?.samples?.length)throw Error('No hay muestras para exportar.');
  return {format:'labo-senales-samples',version:1,source:dataset.source,label:dataset.label,gravity:dataset.gravity,clock:dataset.clock||'timestamp_ms declarado/generado; milisegundos',channels:structuredClone(dataset.channels),samples:structuredClone(dataset.samples),notice:'Exportación manual. No es el CSV de importación; conserva null y separa unidades/canales. El origen declarado no acredita calibración ni medición S25.'};
}
