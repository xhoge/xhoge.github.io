import {convertGif} from './gif-tools.mjs';
self.onmessage=event=>{
 try{
  const result=convertGif(event.data.bytes,event.data.options,progress=>self.postMessage({type:'progress',...progress}));
  self.postMessage({type:'done',...result,bytes:result.bytes.buffer},[result.bytes.buffer]);
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
