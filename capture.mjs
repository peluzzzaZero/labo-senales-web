import {LIMITS,MOTION_CHANNELS,isNumber} from './signal.mjs';
const nullable=v=>isNumber(v)?v:null;
export class MotionCapture{
  constructor(env){this.env=env;this.status='idle';this.samples=[];this.generation=0;this.timer=null;this.handler=null;this.ignoredSynthetic=0;}
  inventory(){return {secure:this.env.secure===true,api:typeof this.env.Motion==='function',permissionAPI:typeof this.env.Motion?.requestPermission==='function',synthetic:this.env.synthetic===true};}
  notify(code,message){this.status=code;this.onStatus?.({code,message,count:this.samples.length,ignoredSynthetic:this.ignoredSynthetic});}
  async start({seconds=15,onStatus,onComplete}={}){
    if(['awaiting','recording'].includes(this.status))return false;
    this.onStatus=onStatus;this.onComplete=onComplete;
    const inv=this.inventory();
    if(!inv.secure){this.notify('unavailable','Contexto no seguro. La captura no se inicia. Usa un contexto seguro en el dispositivo.');return false;}
    if(!inv.api){this.notify('unavailable','DeviceMotion no está expuesto. No se sustituye por datos sintéticos.');return false;}
    if(![10,15,20].includes(seconds)){this.notify('error','Duración permitida: 10, 15 o 20 segundos.');return false;}
    const generation=++this.generation;this.samples=[];this.ignoredSynthetic=0;
    this.notify('awaiting',inv.permissionAPI?'Esperando permiso estándar del navegador…':'Preparando escucha; API presente no acredita sensores.');
    try{
      if(inv.permissionAPI){const result=await this.env.Motion.requestPermission();if(generation!==this.generation)return false;if(result!=='granted'){this.notify('denied','Permiso denegado. No se registró ningún listener ni muestra.');return false;}}
    }catch(error){if(generation!==this.generation)return false;this.notify('denied',`No se obtuvo permiso (${error?.name||'error'}). No hay captura.`);return false;}
    if(generation!==this.generation)return false;
    this.handler=event=>{
      if(this.status!=='recording')return;
      if(event.isTrusted!==true&&!this.env.synthetic){this.ignoredSynthetic++;return;}
      const a=event.acceleration,g=event.accelerationIncludingGravity,r=event.rotationRate;
      this.samples.push({timestamp_ms:nullable(event.timeStamp),ax:nullable(a?.x),ay:nullable(a?.y),az:nullable(a?.z),gx:nullable(g?.x),gy:nullable(g?.y),gz:nullable(g?.z),alpha:nullable(r?.alpha),beta:nullable(r?.beta),gamma:nullable(r?.gamma)});
      if(this.samples.length>=LIMITS.max)this.stop('limit');
    };
    this.env.target.addEventListener('devicemotion',this.handler);
    this.notify('recording',this.env.synthetic?'QA: recibiendo eventos ARTIFICIALES. No es una medición física.':'Escuchando DeviceMotion. La presencia de datos se comprobará al recibir eventos.');
    this.timer=this.env.setTimeout(()=>this.stop('deadline'),seconds*1000);
    return true;
  }
  stop(reason='manual'){
    const active=['awaiting','recording'].includes(this.status);++this.generation;
    if(this.handler)this.env.target.removeEventListener('devicemotion',this.handler);this.handler=null;
    if(this.timer!==null)this.env.clearTimeout(this.timer);this.timer=null;
    if(!active)return false;
    const count=this.samples.length;
    const text=reason==='deadline'?'Tiempo de captura terminado.':reason==='limit'?'Alcanzado el límite de 2048 eventos.':reason==='hidden'?'Captura detenida al ocultar la pestaña.':'Captura detenida por ti.';
    this.notify('stopped',`${text} ${count} eventos. Listener retirado.${count===0?' No se recibieron datos; API, permiso o hardware pueden no entregarlos.':''}`);
    this.onComplete?.({source:this.env.synthetic?'qa-motion':'device-motion',label:this.env.synthetic?'QA · eventos ARTIFICIALES, no medición física':'DeviceMotion · eventos recibidos del navegador',gravity:'canales con/sin gravedad separados',channels:MOTION_CHANNELS,samples:structuredClone(this.samples),clock:'event.timeStamp: reloj de entrega del navegador, no reloj hardware acreditado',stopReason:reason});
    return true;
  }
}
export function browserEnvironment(win){return {target:win,Motion:win.DeviceMotionEvent,secure:win.isSecureContext,setTimeout:win.setTimeout.bind(win),clearTimeout:win.clearTimeout.bind(win),synthetic:false};}
