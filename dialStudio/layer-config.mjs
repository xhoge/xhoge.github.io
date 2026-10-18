export const CONFIG_MAX=4096;
export const types=['none','key','consumer','wheel','text'];
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export function newAction(label='未設定',type='none'){
 return {label,type,flags:0,modifiers:0,keys:[],value:0,text:'',holdMs:40,gapMs:40};
}
export function newLayer(name='レイヤー',mode='select',color='#32d5d2'){
 return {name,mode,color,ccw:newAction(),cw:newAction(),touch:newAction(),macros:mode==='select'?[{...newAction('マクロ 1','key'),keys:[40]}]:[]};
}
export function migrateConfig(value){
 if(Array.isArray(value)){
  const layer=newLayer('マクロ');layer.macros=value.map(m=>({...newAction(),...m,type:'key'}));
  return {schema:2,layers:[layer]};
 }
 return value;
}
const integer=(n,min,max,message)=>{if(!Number.isInteger(n)||n<min||n>max)throw Error(message);return n;};
function textBytes(text,max,multiline=false){
 if(typeof text!=='string'||!text.length||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))throw Error('文字列を正しく入力してください。');
 const b=enc.encode(text);if(b.length>max|| (multiline?/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u:/[\u0000-\u001f\u007f-\u009f]/u).test(text))throw Error(`文字列はUTF-8で${max}バイト以内にしてください。`);
 return b;
}
export function encodeLayers(config){
 if(config?.schema!==2||!Array.isArray(config.layers)||config.layers.length<1||config.layers.length>4)throw Error('レイヤーは1〜4個にしてください。');
 const a=new Uint8Array(CONFIG_MAX),v=new DataView(a.buffer);let offset=12,total=0;
 a.set([77,67,2,config.layers.length]);
 const action=m=>{
  const label=textBytes(m.label,63),type=types.indexOf(m.type),keys=m.keys??[];
  integer(type,0,4,'動作の種類を選んでください。');integer(m.flags,0,3,'動作設定が不正です。');integer(m.modifiers,0,255,'修飾キーが不正です。');
  integer(m.holdMs,10,1000,'押下時間は10〜1000msです。');integer(m.gapMs,0,2000,'実行間隔は0〜2000msです。');
  const text=type===4?textBytes(m.text,240,true):new Uint8Array();
  if(offset+84+text.length>CONFIG_MAX)throw Error('設定の合計が4096バイトを超えています。文字列やマクロを減らしてください。');
  if(type!==1&&keys.length||type!==1&&type!==3&&m.modifiers||type!==4&&m.text)throw Error('動作の種類と内容が一致しません。');
  if(type===1){
   if(m.flags||m.value||!Array.isArray(keys)||keys.length>6||!keys.length&&!m.modifiers||new Set(keys).size!==keys.length||keys.some(k=>!Number.isInteger(k)||k<4||k>0xa4))throw Error('キーは0x04〜0xA4、重複なしで6個まで指定してください。');
  }else if(type===2){if(m.flags)throw Error('制御キーの設定が不正です。');integer(m.value,1,0x3ff,'Consumerコードは0x001〜0x3FFです。');}
  else if(type===3){integer(m.value,-127,127,'スクロール量は±1〜127です。');if(!m.value||m.flags>1)throw Error('スクロール量と方向を指定してください。');}
  else if(type===4){if(![0,1,3].includes(m.flags)||m.value)throw Error('文字列の入力方式が不正です。');if(!m.flags&&/[^\x09\x0a\x20-\x7e]/u.test(m.text))throw Error('日本語は「PC連携で貼り付け」を選択してください。');}
  else if(m.flags||m.value)throw Error('未設定の内容が不正です。');
  a.set(label,offset);a[offset+64]=type;a[offset+65]=m.flags;a[offset+66]=m.modifiers;a[offset+67]=keys.length;a.set(keys,offset+68);
  v.setUint16(offset+74,m.value&65535,true);v.setUint16(offset+76,text.length,true);v.setUint16(offset+78,m.holdMs,true);v.setUint16(offset+80,m.gapMs,true);a.set(text,offset+84);offset+=84+text.length;
 };
 for(const l of config.layers){
  const name=textBytes(l.name,31);if(!/^#[0-9a-f]{6}$/i.test(l.color)||!['select','rotate'].includes(l.mode)||!Array.isArray(l.macros)||l.macros.length>16||(l.mode==='select'?!l.macros.length:l.macros.length))throw Error('レイヤー名・色・マクロ数を確認してください。');
  if(offset+40>CONFIG_MAX)throw Error('設定の容量を超えています。');
  const start=offset;a[offset+2]=l.mode==='rotate'?1:0;a[offset+3]=l.macros.length;
  a.set([1,3,5].map(i=>parseInt(l.color.slice(i,i+2),16)),offset+4);a.set(name,offset+8);offset+=40;
  for(const m of [l.ccw,l.cw,l.touch,...l.macros]){if(l.mode==='select'&&[l.ccw,l.cw,l.touch].includes(m)&&m.type!=='none')throw Error('選択式レイヤーの固定動作は未設定にしてください。');action(m);}
  v.setUint16(start,offset-start,true);total+=l.macros.length;
 }
 if(total>32)throw Error('マクロは全レイヤー合計32個までです。');v.setUint16(4,offset,true);return a.slice(0,offset);
}
export function decodeLayers(a){
 if(a.length<12||a.length>CONFIG_MAX||a[0]!==77||a[1]!==67||a[2]!==2||a[3]<1||a[3]>4)throw Error('未対応のレイヤー設定です。');
 const v=new DataView(a.buffer,a.byteOffset,a.byteLength);let offset=12;
 const readName=(start,cap)=>{const z=a.subarray(start,start+cap).indexOf(0);if(z<1)throw Error('名前が不正です。');return dec.decode(a.subarray(start,start+z));};
 const action=()=>{if(offset+84>a.length)throw Error('動作設定が途中で切れています。');const o=offset,n=v.getUint16(o+76,true);if(n>240||o+84+n>a.length)throw Error('文字列が途中で切れています。');offset+=84+n;
  return {label:readName(o,64),type:types[a[o+64]],flags:a[o+65],modifiers:a[o+66],keys:Array.from(a.subarray(o+68,o+68+a[o+67])),value:a[o+64]===3?v.getInt16(o+74,true):v.getUint16(o+74,true),text:dec.decode(a.subarray(o+84,o+84+n)),holdMs:v.getUint16(o+78,true),gapMs:v.getUint16(o+80,true)};
 };
 const layers=[];
 for(let i=0;i<a[3];i++){
  if(offset+40>a.length)throw Error('レイヤー設定が途中で切れています。');const o=offset,size=v.getUint16(o,true),count=a[o+3];if(count>16||a[o+2]>1)throw Error('レイヤー設定が不正です。');offset+=40;
  const l={name:readName(o+8,32),mode:a[o+2]?'rotate':'select',color:'#'+Array.from(a.subarray(o+4,o+7),x=>x.toString(16).padStart(2,'0')).join(''),ccw:action(),cw:action(),touch:action(),macros:[]};
  for(let j=0;j<count;j++)l.macros.push(action());if(offset!==o+size)throw Error('レイヤー長が不正です。');layers.push(l);
 }
 const result={schema:2,layers},canonical=encodeLayers(result);if(canonical.length!==a.length||canonical.some((b,i)=>b!==a[i]))throw Error('設定に未対応または不正なデータがあります。');return result;
}
export function defaultLayers(macros){
 const config=migrateConfig(macros),volume=newLayer('音量','rotate','#b8a1ff');
 volume.ccw={...newAction('音量 −','consumer'),value:0xea};volume.cw={...newAction('音量 ＋','consumer'),value:0xe9};volume.touch={...newAction('ミュート','consumer'),value:0xe2};config.layers.push(volume);return config;
}
