import {GifReader} from './vendor/omggif.mjs';
import {GIFEncoder,quantize,applyPalette} from './vendor/gifenc.mjs';
export const INPUT_LIMIT=20*1024*1024, DEVICE_LIMIT=512*1024;
const error=message=>{throw Error(message);};

// Bounds-check the GIF container before passing it to the LZW decoder.
export function readGifSource(input){
 const a=input instanceof Uint8Array?input:new Uint8Array(input);
 if(a.length<14||a.length>INPUT_LIMIT)error('読み込めるGIFは20 MiBまでです。');
 if(!['GIF87a','GIF89a'].includes(String.fromCharCode(...a.subarray(0,6))))error('GIFファイルを選んでください。');
 const v=new DataView(a.buffer,a.byteOffset,a.byteLength),w=v.getUint16(6,true),h=v.getUint16(8,true);
 if(!w||!h||w>4096||h>4096||w*h>4194304)error('元画像は4096px以内・合計約400万画素以内にしてください。');
 let p=13,gce={delay:100,disposal:0,transparent:false},global=!!(a[10]&128),duration=0;
 const frames=[];let background=[0,0,0,255];
 const take=n=>{if(p+n>a.length)error('GIFファイルが途中で切れています。');const start=p;p+=n;return start;};
 const blocks=()=>{let n;while((n=a[take(1)]))take(n);};
 if(global){const n=3<<(1+(a[10]&7)),o=take(n),b=a[11]*3;if(b<n)background=[a[o+b],a[o+b+1],a[o+b+2],255];}
 for(;;){
  const tag=a[take(1)];
  if(tag===59){if(!frames.length)error('GIFに画像がありません。');return {width:w,height:h,size:a.length,frames,duration,background};}
  if(tag===33){const label=a[take(1)];
   if(label===249){const o=take(6);if(a[o]!==4||a[o+5]||(a[o+1]&0xe2)||((a[o+1]>>2)&7)>3)error('GIFのフレーム情報に対応していません。');
    gce={delay:Math.max(20,Math.min(10000,(v.getUint16(o+2,true)||10)*10)),disposal:(a[o+1]>>2)&7,transparent:!!(a[o+1]&1),transparentIndex:a[o+4]};
   }else if(label===255){const n=a[take(1)];if(n!==11)error('GIFの拡張情報が不正です。');take(n);blocks();}
   else if(label===254)blocks();else error('このGIFの拡張形式には対応していません。');
  }else if(tag===44){const o=take(9),x=v.getUint16(o,true),y=v.getUint16(o+2,true),fw=v.getUint16(o+4,true),fh=v.getUint16(o+6,true),flags=a[o+8];
   if(!fw||!fh||x+fw>w||y+fh>h||(flags&0x18))error('GIFのフレーム範囲が不正です。');
   if(flags&128)take(3<<(1+(flags&7)));else if(!global)error('GIFの色データがありません。');
   const code=a[take(1)];if(code<2||code>8)error('GIFの圧縮形式に対応していません。');blocks();
   frames.push({...gce,x,y,width:fw,height:fh,start:duration});duration+=gce.delay;
   if(frames.length>2000||duration>120000||w*h*frames.length>400000000)error('元のGIFが長すぎます。2分・2000フレーム以内で、短い動画に切り出してください。');
   gce={delay:100,disposal:0,transparent:false};
  }else error('GIFの構造を読み取れません。');
 }
}

export function conversionOptions(values={}){
 const o={width:Number(values.width??240),height:Number(values.height??240),colors:Number(values.colors??128),fps:Number(values.fps??15),targetKiB:Number(values.targetKiB??512),fit:values.fit??'contain',background:values.background??'#000000',auto:values.auto!==false};
 if(!Number.isInteger(o.width)||!Number.isInteger(o.height)||o.width<24||o.width>240||o.height<24||o.height>240)error('出力サイズは縦・横とも24〜240pxにしてください。');
 if(![16,32,64,128,256].includes(o.colors)||![3,5,8,10,15,20,30].includes(o.fps)||!Number.isInteger(o.targetKiB)||o.targetKiB<16||o.targetKiB>512)error('色数・FPS・目標容量の設定を確認してください。');
 if(!['contain','cover'].includes(o.fit)||!/^#[0-9a-f]{6}$/i.test(o.background))error('画像の配置・背景色の設定を確認してください。');
 return o;
}
export function conversionPlan(o){
 const levels=o.auto?[[1,o.colors,o.fps],[1,Math.min(o.colors,64),Math.min(o.fps,10)],[.85,Math.min(o.colors,64),Math.min(o.fps,10)],[.7,Math.min(o.colors,32),Math.min(o.fps,8)],[.55,16,Math.min(o.fps,5)],[.4,16,3],[.25,16,3]]:[[1,o.colors,o.fps]];
 return levels.map(([scale,colors,fps])=>({...o,width:Math.max(24,Math.round(o.width*scale)),height:Math.max(24,Math.round(o.height*scale)),colors,fps})).filter((x,i,a)=>!a.slice(0,i).some(y=>x.width===y.width&&x.height===y.height&&x.colors===y.colors&&x.fps===y.fps));
}
export function samplingPlan(source,fps){
 const interval=Math.max(1000/fps,source.duration/590),chosen=[];let next=0;
 for(let i=0;i<source.frames.length;i++){const f=source.frames[i];if(i===0||f.start>=next){chosen.push({index:i,start:f.start});next=f.start+interval;}}
 for(let i=0;i<chosen.length;i++)chosen[i].delay=(chosen[i+1]?.start??source.duration)-chosen[i].start;
 return chosen;
}
function clearRect(rgba,w,frame,color){for(let y=frame.y;y<frame.y+frame.height;y++)for(let x=frame.x;x<frame.x+frame.width;x++)rgba.set(color,(y*w+x)*4);}

// Each yielded frame is the fully composited source canvas. The array is reused.
export function* compositeGif(input,source=readGifSource(input)){
 const reader=new GifReader(input instanceof Uint8Array?input:new Uint8Array(input));
 if(reader.numFrames()!==source.frames.length)error('GIFのフレーム数を読み取れません。');
 let canvas=new Uint8Array(source.width*source.height*4),previous=null,saved=null;
 if(!source.frames[0].transparent)for(let p=0;p<canvas.length;p+=4)canvas.set(source.background,p);
 for(let i=0;i<source.frames.length;i++){
  if(previous?.disposal===2)clearRect(canvas,source.width,previous,previous.transparent?[0,0,0,0]:source.background);
  else if(previous?.disposal===3&&saved)canvas.set(saved);
  const frame=source.frames[i];saved=frame.disposal===3?canvas.slice():null;
  // omggif retains the last GCE internally; GIF control data applies to one image.
  reader.frameInfo(i).transparent_index=frame.transparent?frame.transparentIndex:null;
  reader.decodeAndBlitFrameRGBA(i,canvas);previous=frame;
  yield {index:i,rgba:canvas,frame};
 }
}
export function resizeOpaque(rgba,sw,sh,o){
 const out=new Uint8Array(o.width*o.height*4),bg=[1,3,5].map(i=>parseInt(o.background.slice(i,i+2),16));
 const scale=(o.fit==='cover'?Math.max:Math.min)(o.width/sw,o.height/sh),ox=(o.width-sw*scale)/2,oy=(o.height-sh*scale)/2;
 for(let y=0;y<o.height;y++)for(let x=0;x<o.width;x++){
  const at=(y*o.width+x)*4,sx=(x+.5-ox)/scale-.5,sy=(y+.5-oy)/scale-.5;
  if(x+.5<ox||x+.5>=ox+sw*scale||y+.5<oy||y+.5>=oy+sh*scale){out.set([...bg,255],at);continue;}
  const cx=Math.max(0,Math.min(sw-1,sx)),cy=Math.max(0,Math.min(sh-1,sy)),x0=Math.floor(cx),y0=Math.floor(cy),dx=cx-x0,dy=cy-y0;
  const samples=[[(y0*sw+x0)*4,(1-dx)*(1-dy)],[(y0*sw+Math.min(sw-1,x0+1))*4,dx*(1-dy)],[(Math.min(sh-1,y0+1)*sw+x0)*4,(1-dx)*dy],[(Math.min(sh-1,y0+1)*sw+Math.min(sw-1,x0+1))*4,dx*dy]];
  for(let c=0;c<3;c++){let value=0;for(const [p,weight] of samples){const a=rgba[p+3]/255;value+=(rgba[p+c]*a+bg[c]*(1-a))*weight;}out[at+c]=Math.round(value);}out[at+3]=255;
 }
 return out;
}
export function convertGif(input,values={},onProgress=()=>{}){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),source=readGifSource(bytes),requested=conversionOptions(values),attempts=conversionPlan(requested),target=requested.targetKiB*1024;
 let best=null;
 for(let attempt=0;attempt<attempts.length;attempt++){
  const o=attempts[attempt],plan=samplingPlan(source,o.fps),chosen=new Map(plan.map(f=>[f.index,f])),writer=GIFEncoder();let frameCount=0,oversized=false;
  for(const frame of compositeGif(bytes,source)){
   if(chosen.has(frame.index)){
    const rgba=resizeOpaque(frame.rgba,source.width,source.height,o),palette=quantize(rgba,o.colors,{format:'rgb444'}),indexed=applyPalette(rgba,palette,'rgb444');
    writer.writeFrame(indexed,o.width,o.height,{palette,delay:chosen.get(frame.index).delay,dispose:1,transparent:false,repeat:0});frameCount++;
   }
   if(frame.index%5===0)onProgress({attempt:attempt+1,attempts:attempts.length,progress:(frame.index+1)/source.frames.length,width:o.width,height:o.height,colors:o.colors,fps:o.fps});
   // Avoid retaining a huge failed candidate; a later attempt is deliberately smaller.
   if(attempt<attempts.length-1&&writer.bytesView().length>Math.max(target*1.6,1048576)){oversized=true;break;}
  }
  if(oversized)continue;writer.finish();const result=writer.bytes();
  if(!best||result.length<best.bytes.length)best={bytes:result,width:o.width,height:o.height,colors:o.colors,fps:o.fps,frames:frameCount,duration:source.duration,meetsTarget:result.length<=target,attempts:attempt+1};
  if(best.meetsTarget)break;
 }
 if(!best)error('GIFを変換できませんでした。短いGIFでお試しください。');
 return best;
}
