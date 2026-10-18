import {chord} from './device-ui.mjs';
export const consumerKeys=[['音量を上げる',0xe9],['音量を下げる',0xea],['ミュート',0xe2],['再生・一時停止',0xcd],['次の曲',0xb5],['前の曲',0xb6],['停止',0xb7],['早送り',0xb3],['巻き戻し',0xb4],['明るさを上げる',0x6f],['明るさを下げる',0x70],['ブラウザ：戻る',0x224],['ブラウザ：進む',0x225],['ブラウザ：更新',0x227],['ブラウザ：ホーム',0x223],['検索',0x221],['電卓',0x192]];
export const extendedKeys=[['Print Screen',70],['Scroll Lock',71],['Pause',72],['Insert',73],['Home',74],['Page Up',75],['Delete',76],['End',77],['Page Down',78],['Num Lock',83],['テンキー /',84],['テンキー *',85],['テンキー −',86],['テンキー ＋',87],['テンキー Enter',88],...Array.from({length:9},(_,i)=>[`テンキー ${i+1}`,89+i]),['テンキー 0',98],['テンキー .',99],['Menu',101],['JIS ろ',135],['JIS かな',136],['JIS ¥',137],['変換',138],['無変換',139],['かな / LANG1',144],['英数 / LANG2',145]];
export function actionSummary(m,platform='mac'){
 switch(m.type??'key'){
  case 'none':return '未設定';
  case 'key':return chord(m,platform).join(' + ')||'キー未設定';
  case 'consumer':return consumerKeys.find(([,v])=>v===m.value)?.[0]??`Consumer 0x${m.value.toString(16).toUpperCase()}`;
  case 'wheel':return `${m.flags?'横':'縦'}スクロール ${m.value>0?'+':''}${m.value}`;
  case 'text':return `文字列 · ${new TextEncoder().encode(m.text).length} bytes`;
 }
}
export function drawDial(canvas,config,index,selected,platform='mac',flash=null,direction=1){
 const c=canvas.getContext('2d'),l=config.layers[index],rotary=l.mode==='rotate',m=l.macros[selected],accent=l.color,active=flash??accent;
 c.setTransform(canvas.width/240,0,0,canvas.height/240,0,0);c.clearRect(0,0,240,240);c.save();c.beginPath();c.arc(120,120,120,0,Math.PI*2);c.clip();c.fillStyle='#0b1422';c.fillRect(0,0,240,240);
 const count=rotary?24:l.macros.length,slot=rotary?(direction<0?18:6):selected;
 c.lineWidth=13;
 for(let i=0;i<count;i++){c.strokeStyle=i===slot?active:'#253f58';c.beginPath();const gap=count===1?0:.035;c.arc(120,120,110,(i/count)*Math.PI*2-Math.PI/2+gap,((i+1)/count)*Math.PI*2-Math.PI/2-gap);c.stroke();}
 for(let i=0;i<48;i++){const a=i*Math.PI/24,r=i%4?98:95;c.strokeStyle='#41677b';c.lineWidth=1;c.beginPath();c.moveTo(120+Math.cos(a)*r,120+Math.sin(a)*r);c.lineTo(120+Math.cos(a)*100,120+Math.sin(a)*100);c.stroke();}
 if(flash){c.strokeStyle=active;c.lineWidth=1;c.beginPath();c.arc(120,120,91,0,Math.PI*2);c.stroke();}
 for(let i=0;i<config.layers.length;i++){c.fillStyle=i===index?accent:'#253f58';c.beginPath();c.arc(120+i*12-(config.layers.length-1)*6,58,3,0,Math.PI*2);c.fill();}
 const label=rotary?l.name:(m?.label||'名前未設定');c.fillStyle='#f4f8ff';c.textAlign='center';c.textBaseline='middle';c.font='600 30px -apple-system, sans-serif';if(c.measureText(label).width>166)c.font='600 24px -apple-system, sans-serif';
 const lines=[];let line='';for(const ch of label){if(c.measureText(line+ch).width>166&&line){lines.push(line);line='';if(lines.length===2){line='…';break;}}line+=ch;}if(line)lines.push(line);
 lines.forEach((s,i)=>c.fillText(s,120,112+(i-(lines.length-1)*.5)*29));
 if(!rotary&&m?.type==='key'){
  let caption=chord(m,platform).join(' + ');c.font='12px -apple-system, sans-serif';while(c.measureText(caption).width>154)caption=caption.slice(0,-1);
  c.fillStyle='#142a3b';c.beginPath();c.roundRect(35,160,170,25,12);c.fill();c.fillStyle=accent;c.fillText(caption,120,172);
 }else if(rotary){c.font='18px sans-serif';c.fillStyle=direction<0?active:'#253f58';c.fillText('‹',63,164);c.fillStyle=direction>0?active:'#253f58';c.fillText('›',177,164);}
 c.restore();
}
