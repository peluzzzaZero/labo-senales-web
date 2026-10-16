import {spectrum} from './signal.mjs';
self.onmessage=({data})=>{
  try{self.postMessage({id:data.id,result:spectrum(data.samples,data.key)});}
  catch(error){self.postMessage({id:data.id,error:String(error.message||error)});}
};
