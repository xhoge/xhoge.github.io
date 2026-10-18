import {DialClient,encodeConfig,decodeConfig} from './webhid-client.mjs';
import {defaults,keyName,chord,readableError,storageModel,inspectGif,virtualFunctionKeys,modifierNames,keyboardRows,shortcutPresets} from './device-ui.mjs';
import {readGifSource,conversionOptions,INPUT_LIMIT} from './gif-tools.mjs';
import {newAction,newLayer,migrateConfig,defaultLayers} from './layer-config.mjs';
import {consumerKeys,extendedKeys,actionSummary,drawDial} from './layer-ui.mjs';
const $=id=>document.getElementById(id),clone=value=>structuredClone(value);
let keyboardPlatform=navigator.platform?.includes('Win')?'windows':'mac';
try{const p=localStorage.getItem('dialstudio-keyboard-platform');if(['mac','windows'].includes(p))keyboardPlatform=p;}catch{}
let client=null,info=null,diag=null,config=defaultLayers(defaults()),layerIndex=0,selected=0,editTarget='macro',dirty=false,busy=false,demo=false,view='keymap';
let demoSnapshot=null,previewFlash=null,previewDirection=1,flashTimer=0,bridgeEnabled=false,bridgeBusy=false,bridgeToken='',bridgeLastId=0;
let gifSourceBytes=null,gifSourceInfo=null,gifSourceName='',gifConverted=false,gifConverting=false,gifConversionJob=null;
let gifBytes=null,gifDetails=null,gifURL=null,recording=false,recordTimer=0,recoveryPolling=false;
let keyMode='keyboard';const modeSnapshots=new WeakMap();
const pressed=new Set(),draftKey='dialstudio-draft-v2';
const notify=(text,tone='')=>{$('notice-text').textContent=text;$('notice').className='notice '+tone;$('notice').hidden=false;};
const showError=e=>{notify(readableError(e,info),'error');$('diagnostics').textContent=JSON.stringify({info,diagnostics:diag,error:{message:e.message,status:e.status}},null,2);};
const layer=()=>config.layers[layerIndex];
function active(){return editTarget==='macro'?layer().macros[selected]:layer()[editTarget];}
function setActive(m){if(editTarget==='macro')layer().macros[selected]=m;else layer()[editTarget]=m;}
function resetSelection(){selected=0;editTarget=layer().mode==='select'?'macro':'cw';}
function canonical(value){return decodeConfig(encodeConfig(migrateConfig(value)));}
function saveDraft(){if(demo)return;try{localStorage.setItem(draftKey,JSON.stringify({schema:2,config}));}catch{}}
function changed(){dirty=true;saveDraft();renderOverview();renderAssignment(false);renderKeyboard();controls();}
function el(tag,classes,text){const n=document.createElement(tag);if(classes)n.className=classes;if(text!==undefined)n.textContent=text;return n;}
function switchView(name){view=name;window.scrollTo({top:0,behavior:'instant'});document.querySelectorAll('.view').forEach(n=>n.hidden=n.id!==`view-${name}`);document.querySelectorAll('.nav').forEach(n=>{const on=n.dataset.view===name;n.classList.toggle('active',on);if(on)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});stopRecording();}
function flashPreview(color='#63e6ae'){clearTimeout(flashTimer);previewFlash=color;renderOverview();flashTimer=setTimeout(()=>{previewFlash=null;renderOverview();},220);}
function renderLayers(populate=true){
 $('layer-tabs').replaceChildren(...config.layers.map((l,i)=>{const b=el('button','layer-tab'+(i===layerIndex?' selected':''));b.type='button';b.disabled=busy;b.setAttribute('aria-pressed',String(i===layerIndex));const dot=el('i');dot.style.background=l.color;b.append(dot,document.createTextNode(l.name||`レイヤー ${i+1}`));b.onclick=()=>{layerIndex=i;resetSelection();stopRecording();renderAll();};return b;}));
 if(populate){$('layer-name').value=layer().name;$('layer-color').value=layer().color;$('layer-mode').value=layer().mode;}
 $('layer-help').textContent=layer().mode==='select'?'回転で選択 · タッチで実行 · 押し込みで次のレイヤー':'左右回転とタッチに、それぞれ別の動作を設定 · 押し込みで次のレイヤー';
 try{$('config-capacity').textContent=`${encodeConfig(config).length} / 4096 bytes`;$('config-capacity').classList.remove('error');}catch(e){$('config-capacity').textContent=e.message;$('config-capacity').classList.add('error');}
}
function renderOverview(){
 renderLayers(false);const l=layer(),rotary=l.mode==='rotate';
 $('macro-count').textContent=`${config.layers.length} レイヤー`;
 drawDial($('dial-preview'),config,layerIndex,selected,keyboardPlatform,previewFlash,previewDirection);
 $('preview-summary').textContent='プレビュー操作は本体へ送信しません';
 $('action-list-title').textContent=rotary?'回転・タッチの割り当て':'マクロ一覧';
 const items=rotary?[['ccw','左回転',l.ccw],['cw','右回転',l.cw],['touch','タッチ',l.touch]]:l.macros.map((m,i)=>[i,String(i+1).padStart(2,'0'),m]);
 $('macro-list').replaceChildren(...items.map(([target,name,m])=>{const on=rotary?editTarget===target:selected===target;const b=el('button','macro-tile'+(on?' active':''));b.type='button';b.setAttribute('aria-pressed',String(on));b.append(el('span','tile-index',name),el('strong','',m.label||'名前未設定'),el('span','tile-chord',actionSummary(m,keyboardPlatform)));b.disabled=busy;b.onclick=()=>{if(rotary)editTarget=target;else selected=target;stopRecording();renderAll();};return b;}));
 for(const id of ['add','duplicate','delete'])$(id).hidden=rotary;
 $('draft-state').textContent=dirty?'● 未保存の変更':client?'本体と同期済み':'プレビュー';$('draft-state').classList.toggle('dirty',dirty);
 $('footer-state').textContent=dirty?'未保存の変更があります。「本体に保存」で反映します。':'変更は「本体に保存」を押すまで送信されません。';
}
function renderAssignment(populate=true){
 const m=active();$('editor-slot').textContent=editTarget==='macro'?`マクロ ${selected+1}`:{ccw:'左回転',cw:'右回転',touch:'固定タッチ動作'}[editTarget];
 if(populate){
  $('macro-label').value=m.label;$('hold-ms').value=m.holdMs;$('gap-ms').value=m.gapMs;$('action-type').value=m.type;
  $('consumer-code').value='0x'+m.value.toString(16).toUpperCase();$('consumer-preset').value=consumerKeys.some(([,v])=>v===m.value)?String(m.value):'custom';
  $('wheel-axis').value=String(m.flags&1);$('wheel-delta').value=m.type==='wheel'?m.value:1;$('text-value').value=m.text;$('text-method').value=String(m.flags);
 }
 $('label-bytes').textContent=`${new TextEncoder().encode(m.label).length} / 63 bytes`;
 $('text-bytes').textContent=`${new TextEncoder().encode(m.text).length} / 240 bytes`;
 $('text-help').textContent=m.flags?'日本語・記号・改行に対応。下の「PC連携」を有効にして使用します。':'USキーボード配列・英数入力で使用。日本語・絵文字やJIS配列ではPC連携を選んでください。';
 $('key-assignment').hidden=m.type!=='key';$('keyboard-panel').hidden=m.type!=='key';
 $('consumer-fields').hidden=m.type!=='consumer';$('wheel-fields').hidden=m.type!=='wheel';$('text-fields').hidden=m.type!=='text';
 const nodes=[];
 const token=(name,remove)=>{if(nodes.length)nodes.push(el('span','chord-plus','+'));const b=el('button','chord-token',name);b.disabled=busy;b.onclick=remove;nodes.push(b);};
 modifierNames(keyboardPlatform).forEach((n,i)=>{if(m.modifiers&(1<<i))token(n,()=>{m.modifiers&=~(1<<i);changed();});});
 m.keys.forEach(k=>token(keyName(k,keyboardPlatform),()=>{m.keys=m.keys.filter(x=>x!==k);changed();}));
 if(!nodes.length)nodes.push(el('span','chord-placeholder','キーを選んでください'));$('chord-editor').replaceChildren(...nodes);
 $('wheel-modifiers').replaceChildren(...modifierNames(keyboardPlatform).slice(0,4).map((name,i)=>{const label=el('label'),input=el('input');input.type='checkbox';input.checked=!!(m.modifiers&(1<<i));input.disabled=busy;input.onchange=()=>{m.modifiers^=1<<i;changed();};label.append(input,document.createTextNode(name));return label;}));
}
function toggleKey(id){const m=active();if(id<0)m.modifiers^=-id;else if(m.keys.includes(id))m.keys=m.keys.filter(x=>x!==id);else if(m.keys.length>=6){notify('通常キーは6個までです。','error');return;}else m.keys.push(id);changed();}
function renderKeyboard(){
 renderPresets();const m=active();document.querySelectorAll('[data-platform]').forEach(b=>{b.classList.toggle('selected',b.dataset.platform===keyboardPlatform);b.setAttribute('aria-pressed',String(b.dataset.platform===keyboardPlatform));});$('keyboard-platform-caption').textContent=keyboardPlatform==='windows'?'Windows':'Mac';
 $('virtual-key-grid').replaceChildren(...virtualFunctionKeys.map(([name,code])=>{const on=m.modifiers===0&&m.keys.length===1&&m.keys[0]===code,b=el('button','virtual-key'+(on?' active':''));b.disabled=busy;b.setAttribute('aria-label',`仮想キー ${name}`);b.setAttribute('aria-pressed',String(on));b.append(el('strong','',name),el('small','',on?'割り当て中':'割り当てる'));b.onclick=()=>{m.modifiers=0;m.keys=[code];changed();};return b;}));
 $('keyboard').replaceChildren(...keyboardRows(keyboardPlatform).map(row=>{const r=el('div','key-row');r.append(...row.map(([name,id])=>{const on=id<0?!!(m.modifiers&-id):m.keys.includes(id);const b=el('button','key'+(name==='Space'?' space':'')+(on?' active':''),name);b.type='button';b.setAttribute('aria-label',`キー ${name}`);b.setAttribute('aria-pressed',String(on));b.disabled=busy;b.onclick=()=>toggleKey(id);return b;}));return r;}));
 $('extended-key-grid').replaceChildren(...extendedKeys.map(([name,id])=>{const b=el('button','preset'+(m.keys.includes(id)?' active':''),name);b.disabled=busy;b.onclick=()=>toggleKey(id);return b;}));
}
function controls(){
 const linked=!!client&&!demo;
 $('connect').hidden=linked;$('connect').disabled=busy;$('disconnect').hidden=!linked;$('disconnect').disabled=busy;
 $('read').disabled=!linked||busy;$('refresh').disabled=!linked||busy;$('save').disabled=!linked||busy||!dirty||!info?.nvsOK;
 const editable=['macro-label','hold-ms','gap-ms','record','clear-keys','export','import','layer-name','layer-color','layer-mode','action-type','consumer-preset','consumer-code','wheel-axis','wheel-delta','text-value','text-method','generic-key-code','generic-key-add'];for(const id of editable)$(id).disabled=busy;
 $('add').disabled=$('duplicate').disabled=busy||layer().macros.length>=16;$('delete').disabled=busy||layer().macros.length<=1;
 $('layer-add').disabled=busy||config.layers.length>=4;$('layer-delete').disabled=busy||config.layers.length<=1;$('layer-prev').disabled=busy||!layerIndex;$('layer-next').disabled=busy||layerIndex===config.layers.length-1;
 document.querySelectorAll('.preview-controls button').forEach(b=>b.disabled=busy);
 $('dropzone').disabled=busy;for(const id of ['gif-width','gif-height','gif-fit','gif-background','gif-colors','gif-fps','gif-target','gif-auto'])$(id).disabled=busy;
 document.querySelectorAll('[data-gif-size],[data-platform]').forEach(b=>b.disabled=busy);
 $('gif-convert').disabled=busy||!gifSourceBytes;$('gif-download').disabled=busy||!gifConverted||!gifBytes;
 $('gif-cancel').hidden=!gifConverting;$('upload').disabled=!linked||busy||!info?.fsOK||!info?.nvsOK||!gifBytes||!gifDetails;
 $('setup').disabled=!linked||busy||!diag||diag.reason===1||!info?.nvsOK;$('confirm-reset').disabled=!$('erase-check').checked||busy;
 $('record').classList.toggle('recording',recording);$('record').textContent=recording?'入力待ち… Escで中止':'⏺ キーを入力して設定';
 $('offline-hint').hidden=linked||demo;$('demo-banner').hidden=!demo;
 $('side-state').textContent=linked?'USBで接続中':demo?'プレビュー表示':'デバイス未接続';$('side-dot').classList.toggle('green',linked);
 $('connection-label').replaceChildren(el('i','dot'+(linked?' green':'')),document.createTextNode(linked?'接続済み':demo?'プレビュー':'未接続'));
}
function renderStorage(){
 const model=storageModel(info,diag);$('storage-title').textContent=model.title;$('storage-description').textContent=model.description;
 $('storage-symbol').textContent=model.tone==='success'?'✓':model.tone==='warning'||model.tone==='error'?'!':'◌';
 $('usb-health').textContent=client?'接続済み':demo?'プレビュー':'未接続';$('usb-health').className='health-title'+(client?' success':'');
 $('nvs-health').textContent=info?info.nvsOK?'正常':'要確認':'確認待ち';$('nvs-health').className='health-title'+(info?.nvsOK?' success':'');
 $('fs-health').textContent=info?info.fsOK?'使用できます':'要セットアップ':'確認待ち';$('fs-health').className='health-title'+(info?.fsOK?' success':info?' warning':'');
 const units=n=>`${(n/1048576).toFixed(2)} MiB`;
 $('fs-capacity').textContent=info?.fsOK?`${units(info.fsUsed)} / ${units(info.fsTotal)} 使用中`:info?'画像の書き込みはまだできません':'本体を接続してください';
 $('setup-guidance').hidden=!info||!!info.fsOK;$('old-fw-help').hidden=!info||!!diag||!!info.fsOK;
 $('go-image').hidden=!info?.fsOK;$('storage-dot').hidden=!info||!!info.fsOK;
 $('image-storage-alert').hidden=!info||!!info.fsOK;
 $('image-alert-title').textContent=model.title;$('image-alert-body').textContent=model.description;
 $('diagnostics').textContent=JSON.stringify({device:info,storage:diag},null,2);
}
function renderAll(){renderLayers();renderOverview();renderAssignment();renderKeyboard();renderStorage();controls();}
async function action(fn){if(busy||bridgeBusy){notify('処理が終わってから操作してください。');return;}stopRecording();busy=true;controls();renderOverview();renderKeyboard();renderAssignment(false);
 try{return await fn();}catch(e){showError(e);}finally{busy=false;controls();renderOverview();renderKeyboard();renderAssignment(false);}}
async function refreshInfo(){if(!client)return;info=await client.info();try{diag=await client.storageDiagnostics();}catch(e){if(e.status!==3)throw e;diag=null;}renderStorage();controls();}
async function readFromDevice(){
 const incoming=canonical(await client.readConfig());
 if(dirty&&JSON.stringify(incoming)!==JSON.stringify(config)&&!window.confirm('編集中の変更を置き換えて、本体の設定を読み込みますか？'))return;
 config=incoming;layerIndex=0;resetSelection();dirty=false;saveDraft();renderAll();
}
$('connect').onclick=()=>action(async()=>{
 if(!navigator.hid)throw Error('WebHIDに対応したChromeまたはEdgeで、localhostのURLを開いてください。');
 const next=await DialClient.connect();client=next;demo=false;
 try{await refreshInfo();await readFromDevice();notify(info.schema===2?'接続しました。レイヤーを編集できます。':'レイヤー機能には本体をv1.2.0へ更新してください。');}
 catch(e){if(!client.device.opened){client=null;info=null;diag=null;}throw e;}
});
$('disconnect').onclick=()=>action(async()=>{stopBridge();if(client)await client.close();client=null;info=null;diag=null;renderAll();notify('接続を解除しました。');});
$('read').onclick=()=>action(async()=>{await readFromDevice();await refreshInfo();notify('本体の設定を読み込みました。','success');});
$('refresh').onclick=()=>action(async()=>{await refreshInfo();notify(storageModel(info,diag).title);});
$('save').onclick=()=>action(async()=>{
 const sent=canonical(config);await client.writeConfig(sent);const readback=canonical(await client.readConfig());
 if(JSON.stringify(readback)!==JSON.stringify(sent))throw Error('保存した設定の読み戻しが一致しません。再接続して確認してください。');
 config=sent;dirty=false;saveDraft();await refreshInfo();renderAll();notify('レイヤーとマクロを本体に保存しました。','success');
});
$('layer-name').oninput=e=>{layer().name=e.target.value;changed();};$('layer-color').oninput=e=>{layer().color=e.target.value;changed();};
$('layer-mode').onchange=e=>{
 const l=layer(),old=l.mode,cache=modeSnapshots.get(l)??{};cache[old]=clone({macros:l.macros,ccw:l.ccw,cw:l.cw,touch:l.touch});l.mode=e.target.value;
 const next=cache[l.mode]??newLayer(l.name,l.mode,l.color);Object.assign(l,{macros:clone(next.macros),ccw:clone(next.ccw),cw:clone(next.cw),touch:clone(next.touch)});modeSnapshots.set(l,cache);resetSelection();dirty=true;saveDraft();renderAll();
};
$('layer-add').onclick=()=>{if(config.layers.length>=4)return;config.layers.push(newLayer(`レイヤー ${config.layers.length+1}`,'select',['#32d5d2','#b8a1ff','#ffbd59','#8cdbbb'][config.layers.length]));layerIndex=config.layers.length-1;resetSelection();dirty=true;saveDraft();renderAll();};
$('layer-delete').onclick=()=>{if(config.layers.length<=1||!confirm(`「${layer().name}」のレイヤーと割り当てを削除しますか？`))return;config.layers.splice(layerIndex,1);layerIndex=Math.min(layerIndex,config.layers.length-1);resetSelection();dirty=true;saveDraft();renderAll();};
function moveLayer(delta){const i=layerIndex,j=i+delta;if(j<0||j>=config.layers.length)return;[config.layers[i],config.layers[j]]=[config.layers[j],config.layers[i]];layerIndex=j;dirty=true;saveDraft();renderAll();}
$('layer-prev').onclick=()=>moveLayer(-1);$('layer-next').onclick=()=>moveLayer(1);
$('preview-click').onclick=()=>{layerIndex=(layerIndex+1)%config.layers.length;resetSelection();renderAll();};
function previewRotate(delta){previewDirection=delta;if(layer().mode==='select')selected=(selected+delta+layer().macros.length)%layer().macros.length;else {editTarget=delta>0?'cw':'ccw';if(active().type!=='none')flashPreview();}renderAll();}
$('preview-ccw').onclick=()=>previewRotate(-1);$('preview-cw').onclick=()=>previewRotate(1);$('preview-touch').onclick=()=>{if(layer().mode==='rotate')editTarget='touch';if(active().type!=='none')flashPreview();renderAll();};
$('macro-label').oninput=e=>{active().label=e.target.value;changed();};$('hold-ms').oninput=e=>{active().holdMs=Number(e.target.value);changed();};$('gap-ms').oninput=e=>{active().gapMs=Number(e.target.value);changed();};
$('action-type').onchange=e=>{const type=e.target.value,m=newAction(active().label,type);if(type==='key')m.keys=[40];if(type==='consumer')m.value=0xe9;if(type==='wheel')m.value=1;if(type==='text')m.flags=keyboardPlatform==='mac'?3:1;setActive(m);dirty=true;saveDraft();renderAll();};
$('consumer-preset').replaceChildren(...consumerKeys.map(([name,v])=>new Option(name,String(v))),new Option('その他のUsage ID','custom'));
$('consumer-preset').onchange=e=>{if(e.target.value==='custom')return;active().value=Number(e.target.value);changed();renderAssignment();};
$('consumer-code').onchange=e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<1||value>0x3ff){notify('Consumerコードは0x001〜0x3FFです。','error');return;}active().value=value;changed();renderAssignment();};
$('wheel-axis').onchange=e=>{active().flags=Number(e.target.value);changed();};$('wheel-delta').oninput=e=>{active().value=Number(e.target.value);changed();};
$('text-value').oninput=e=>{active().text=e.target.value.replace(/\r\n?/g,'\n');changed();};$('text-method').onchange=e=>{active().flags=Number(e.target.value);changed();};
$('generic-key-add').onclick=()=>{const value=Number($('generic-key-code').value);if(!Number.isInteger(value)||value<4||value>0xa4){notify('Keyboardコードは0x04〜0xA4です。','error');return;}toggleKey(value);};
$('clear-keys').onclick=()=>{active().keys=[];active().modifiers=0;changed();};
$('add').onclick=()=>{if(layer().macros.length>=16)return;layer().macros.push({...newAction(`マクロ ${layer().macros.length+1}`,'key'),keys:[40]});selected=layer().macros.length-1;dirty=true;saveDraft();renderAll();};
$('duplicate').onclick=()=>{if(layer().macros.length>=16)return;layer().macros.splice(selected+1,0,clone(active()));selected++;dirty=true;saveDraft();renderAll();};
$('delete').onclick=()=>{if(layer().macros.length<2)return;layer().macros.splice(selected,1);selected=Math.min(selected,layer().macros.length-1);dirty=true;saveDraft();renderAll();};
function renderPresets(){
 $('presets').replaceChildren(...shortcutPresets(keyboardPlatform).map(([name,mods,key])=>{const b=el('button','preset');b.disabled=busy;b.append(el('span','',name),el('small','',chord({modifiers:mods,keys:[key]},keyboardPlatform).join(' + ')));b.onclick=()=>{setActive({...newAction(name,'key'),modifiers:mods,keys:[key]});dirty=true;saveDraft();renderAll();};return b;}));
}
document.querySelectorAll('[data-platform]').forEach(b=>b.onclick=()=>{if(busy)return;keyboardPlatform=b.dataset.platform;try{localStorage.setItem('dialstudio-keyboard-platform',keyboardPlatform);}catch{}renderOverview();renderAssignment(false);renderKeyboard();controls();});
document.querySelectorAll('[data-keymode]').forEach(b=>b.onclick=()=>{keyMode=b.dataset.keymode;document.querySelectorAll('[data-keymode]').forEach(n=>n.classList.toggle('selected',n===b));$('keyboard').hidden=keyMode!=='keyboard';$('presets').hidden=keyMode!=='presets';$('virtual-functions').hidden=keyMode!=='virtual';$('extended-keys').hidden=keyMode!=='extended';});
const codeMap=new Map([['Space',44],['Enter',40],['Escape',41],['Backspace',42],['Tab',43],['Minus',45],['Equal',46],['BracketLeft',47],['BracketRight',48],['Backslash',49],['Semicolon',51],['Quote',52],['Backquote',53],['Comma',54],['Period',55],['Slash',56],['CapsLock',57],['ArrowRight',79],['ArrowLeft',80],['ArrowDown',81],['ArrowUp',82],['Delete',76],['Home',74],['End',77],['PageUp',75],['PageDown',78]]);
for(let i=0;i<26;i++)codeMap.set(`Key${String.fromCharCode(65+i)}`,4+i);for(let i=1;i<=9;i++)codeMap.set(`Digit${i}`,29+i);codeMap.set('Digit0',39);for(let i=1;i<=12;i++)codeMap.set(`F${i}`,57+i);for(const [name,usage] of virtualFunctionKeys)codeMap.set(name,usage);
function stopRecording(){recording=false;pressed.clear();clearTimeout(recordTimer);$('key-help').textContent='最大6キー＋修飾キー。';controls();}
$('record').onclick=()=>{if(recording){stopRecording();return;}recording=true;pressed.clear();$('key-help').textContent='キーを押して離してください。Escで中止。';recordTimer=setTimeout(stopRecording,15000);controls();};
window.addEventListener('keydown',e=>{if(!recording)return;e.preventDefault();e.stopPropagation();if(e.code==='Escape'){stopRecording();return;}const key=codeMap.get(e.code);if(!key||pressed.size>=6&&!pressed.has(key))return;pressed.add(key);active().modifiers=(e.ctrlKey?1:0)|(e.shiftKey?2:0)|(e.altKey?4:0)|(e.metaKey?8:0);active().keys=[...pressed];changed();},true);
window.addEventListener('keyup',e=>{if(!recording)return;e.preventDefault();const key=codeMap.get(e.code);if(key&&pressed.has(key)){pressed.delete(key);if(!pressed.size)stopRecording();}},true);window.addEventListener('blur',()=>{if(recording)stopRecording();});
$('export').onclick=()=>{try{const saved=canonical(config),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));a.href=url;a.download='m5dial-layers.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){showError(e);}};
$('import').onclick=()=>$('import-file').click();$('import-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>65536)throw Error('設定ファイルが大きすぎます。');config=canonical(JSON.parse(await f.text()));layerIndex=0;resetSelection();dirty=true;saveDraft();renderAll();notify('バックアップを読み込みました。「本体に保存」で反映します。');}catch(e){showError(e);}finally{e.target.value='';}};
function stopBridge(){bridgeEnabled=false;bridgeToken='';$('bridge-token').value='';$('bridge-enable').hidden=false;$('bridge-disable').hidden=true;$('bridge-status').textContent='PC連携は停止中';}
async function helper(path,data,token=bridgeToken){const response=await fetch(`http://127.0.0.1:8765${path}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(data),signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error('PC補助ツールに接続できません。起動状態とトークンを確認してください。');return response.json();}
$('bridge-enable').onclick=async()=>{try{if(busy||bridgeBusy)return;const token=$('bridge-token').value.trim();if(!token)throw Error('補助ツールのトークンを入力してください。');await helper('/check',{},token);bridgeToken=token;bridgeEnabled=true;bridgeLastId=0;$('bridge-enable').hidden=true;$('bridge-disable').hidden=false;$('bridge-status').textContent='PC連携中 · WebHID接続とこの画面を開いたまま使用してください';}catch(e){showError(e);}};
$('bridge-disable').onclick=stopBridge;
setInterval(async()=>{
 if(!bridgeEnabled||bridgeBusy||busy||!client||client.busy||info?.schema!==2)return;bridgeBusy=true;const connected=client;
 try{const event=await connected.pendingText();if(!event)return;if(event.id===bridgeLastId)return;
  await helper('/clipboard',{text:event.text,platform:event.platform});if(!bridgeEnabled||client!==connected)return;await connected.acknowledgeText(event.id,true);bridgeLastId=event.id;$('bridge-status').textContent='PC連携中';
 }catch(e){stopBridge();showError(e);}finally{bridgeBusy=false;}
},250);
function previewGif(bytes){
 if(gifURL)URL.revokeObjectURL(gifURL);
 gifURL=URL.createObjectURL(new Blob([bytes],{type:'image/gif'}));
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),header=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const width=header.getUint16(6,true),height=header.getUint16(8,true),scale=Math.min(1,240/width,240/height);
 $('gif-preview').style.width=`${width*scale/240*100}%`;$('gif-preview').style.height=`${height*scale/240*100}%`;
 $('gif-preview').src=gifURL;$('gif-preview').hidden=false;$('gif-empty').hidden=true;
}
function invalidateGifConversion(){
 if(!gifSourceBytes||busy)return;gifBytes=null;gifDetails=null;gifConverted=false;
 $('gif-ready-state').textContent='変換して反映';
 $('gif-conversion-result').hidden=true;controls();
}
async function chooseGif(file){
 if(!file||busy)return;
 gifBytes=null;gifDetails=null;gifSourceBytes=null;gifSourceInfo=null;gifConverted=false;
 $('gif-error').hidden=true;$('file-info').hidden=true;$('transfer').hidden=true;
 $('gif-adjust').hidden=true;$('gif-conversion-progress').hidden=true;$('gif-conversion-result').hidden=true;
 if(gifURL){URL.revokeObjectURL(gifURL);gifURL=null;}$('gif-preview').hidden=true;$('gif-empty').hidden=false;
 try{
  if(file.size>INPUT_LIMIT)throw Error('読み込めるGIFは20 MiBまでです。');
  const bytes=await file.arrayBuffer(),source=readGifSource(bytes);
  gifSourceBytes=new Uint8Array(bytes);gifSourceInfo=source;gifSourceName=file.name||'animation.gif';
  previewGif(bytes);$('gif-adjust').hidden=false;
  $('gif-width').value=Math.min(240,Math.max(24,source.width));$('gif-height').value=Math.min(240,Math.max(24,source.height));
  $('file-info').textContent=`元のGIF：${gifSourceName}　${source.width} × ${source.height} px / ${source.frames.length}フレーム / ${(source.size/1024).toFixed(1)} KiB`;$('file-info').hidden=false;
  try{gifDetails=inspectGif(bytes);gifBytes=bytes;$('gif-ready-state').textContent='そのまま保存できます';}
  catch{$('gif-ready-state').textContent='本体用に変換してください';}
 }catch(e){$('gif-error').textContent=readableError(e,info);$('gif-error').hidden=false;}
 controls();
}
document.querySelectorAll('[data-gif-size]').forEach(b=>b.onclick=()=>{if(busy)return;$('gif-width').value=b.dataset.gifSize;$('gif-height').value=b.dataset.gifSize;invalidateGifConversion();});
for(const id of ['gif-width','gif-height','gif-fit','gif-background','gif-colors','gif-fps','gif-target','gif-auto'])$(id).addEventListener('change',invalidateGifConversion);
$('gif-convert').onclick=()=>action(async()=>{
 if(!gifSourceBytes)return;
 const options=conversionOptions({width:$('gif-width').value,height:$('gif-height').value,colors:$('gif-colors').value,fps:$('gif-fps').value,targetKiB:$('gif-target').value,fit:$('gif-fit').value,background:$('gif-background').value,auto:$('gif-auto').checked});
 gifConverting=true;gifBytes=null;gifDetails=null;gifConverted=false;controls();
 $('gif-error').hidden=true;$('gif-conversion-result').hidden=true;$('gif-conversion-progress').hidden=false;
 $('gif-conversion-bar').value=0;$('gif-conversion-status').textContent='GIFを変換中…';
 try{
  const result=await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./gif-worker.mjs',import.meta.url),{type:'module'});
   const timer=setTimeout(()=>{worker.terminate();reject(Error('変換に時間がかかりすぎています。短いGIFでお試しください。'));},120000);
   const stop=()=>{clearTimeout(timer);worker.terminate();gifConversionJob=null;};
   gifConversionJob={cancel:()=>{stop();resolve(null);}};
   worker.onmessage=event=>{const data=event.data;
    if(data.type==='progress'){$('gif-conversion-status').textContent=`変換中 ${data.attempt}/${data.attempts}　${data.width} × ${data.height} px・${data.colors}色`;$('gif-conversion-bar').value=data.progress;}
    else if(data.type==='done'){stop();resolve(data);}
    else if(data.type==='error'){stop();reject(Error(data.message));}
   };
   worker.onerror=()=>{stop();reject(Error('GIF変換処理を開始できませんでした。ページを再読み込みしてください。'));};
   const copy=gifSourceBytes.slice();worker.postMessage({bytes:copy.buffer,options},[copy.buffer]);
  });
  if(!result){notify('GIFの変換を中止しました。');return;}
  const output=result.bytes;
  if(output.byteLength>524288){
   $('gif-ready-state').textContent='さらに容量調整が必要です';
   throw Error(`変換後も${(output.byteLength/1024).toFixed(1)} KiBあり、上限512 KiBを超えています。自動調整を有効にするか、サイズ・色数・フレーム数を下げてください。`);
  }
  const details=inspectGif(output);gifBytes=output;gifDetails=details;gifConverted=true;previewGif(output);
  const reduction=Math.round((1-output.byteLength/gifSourceInfo.size)*100);
  $('gif-conversion-result').textContent=`${gifSourceInfo.width} × ${gifSourceInfo.height} → ${details.width} × ${details.height} px\n${(gifSourceInfo.size/1024).toFixed(1)} → ${(output.byteLength/1024).toFixed(1)} KiB${reduction>0?`（${reduction}%削減）`:''}\n${details.frames}フレーム・上限${result.colors}色・上限${result.fps}fps${result.meetsTarget?'・目標容量内':'・目標容量には未達（本体への保存は可能）'}`;
  $('gif-conversion-result').hidden=false;$('gif-ready-state').textContent='変換済み・保存できます';
 }catch(e){$('gif-error').textContent=readableError(e,info);$('gif-error').hidden=false;throw e;}
 finally{gifConverting=false;gifConversionJob=null;$('gif-conversion-progress').hidden=true;}
});
$('gif-cancel').onclick=()=>gifConversionJob?.cancel();
$('gif-download').onclick=()=>{
 if(!gifBytes||!gifConverted)return;const a=document.createElement('a');a.href=gifURL;a.download=gifSourceName.replace(/\.gif$/i,'')+'-dial.gif';a.click();
};
$('dropzone').onclick=()=>$('gif-file').click();$('gif-file').onchange=e=>{chooseGif(e.target.files[0]);e.target.value='';};
$('dropzone').ondragover=e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('drag');};$('dropzone').ondragleave=()=>$('dropzone').classList.remove('drag');$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('drag');chooseGif(e.dataTransfer.files[0]);};
window.addEventListener('paste',e=>{if(view!=='image'||busy)return;const file=[...(e.clipboardData?.files??[])].find(f=>f.type==='image/gif'||/\.gif$/i.test(f.name));if(file){e.preventDefault();chooseGif(file);}});
$('upload').onclick=()=>action(async()=>{
 await refreshInfo();if(!info.fsOK){switchView('device');throw Error('画像保存領域のセットアップが必要です。');}
 $('transfer').hidden=false;$('progress').value=0;$('transfer-label').textContent='画像を本体に送信中';$('transfer-help').textContent='USBを抜かずにお待ちください。';
 try{await client.uploadGif(gifBytes,(sent,total)=>{const ratio=sent/total;$('progress').value=ratio;$('transfer-percent').textContent=`${Math.floor(ratio*100)}%`;
  if(sent===total){$('transfer-label').textContent='全フレームを確認中';$('transfer-help').textContent='まだ完了していません。画像の検証と保存を待っています。';}});
 await refreshInfo();$('transfer-label').textContent='画像を保存しました';$('transfer-percent').textContent='完了';$('transfer-help').textContent='30秒操作しないと再生されます。';notify('アイドル画像を保存しました。30秒無操作で再生します。','success');
 }catch(e){$('transfer-label').textContent='送信を完了できませんでした';$('transfer-help').textContent=readableError(e,info);throw e;}
});
$('setup').onclick=()=>{$('erase-check').checked=false;controls();$('reset-dialog').showModal();};$('erase-check').onchange=controls;
$('confirm-reset').onclick=()=>{if(!$('erase-check').checked)return;$('reset-dialog').close();action(async()=>{
 await client.armStorageReset();$('hold-dialog').showModal();recoveryPolling=true;let deadline=Date.now()+40000;
 try{while(recoveryPolling){await new Promise(r=>setTimeout(r,650));diag=await client.storageDiagnostics();$('countdown').textContent=`残り${Math.ceil(diag.remainingMs/1000)}秒`;
  if(diag.recovery===2){recoveryPolling=false;await refreshInfo();notify('画像保存領域の準備ができました。GIFを保存できます。','success');break;}
  if(diag.recovery===3)throw Error('画像保存領域を初期化できませんでした。パーティション設定を確認してください。');
  if(diag.recovery===4){notify('セットアップを中止しました。もう一度開始できます。');break;}
  if(Date.now()>deadline)throw Error('本体の確認が時間内に完了しませんでした。状態を更新して確認してください。');
 }}finally{recoveryPolling=false;$('hold-dialog').close();renderStorage();}
 });};
$('cancel-reset').onclick=async()=>{if(!client)return;$('cancel-reset').disabled=true;try{while(client.busy)await new Promise(r=>setTimeout(r,20));await client.cancelStorageReset();recoveryPolling=false;}catch(e){showError(e);}finally{$('cancel-reset').disabled=false;}};
$('hold-dialog').addEventListener('cancel',e=>{e.preventDefault();$('cancel-reset').click();});
$('image-setup').onclick=()=>switchView('device');$('go-image').onclick=()=>switchView('image');
$('notice-close').onclick=()=>$('notice').hidden=true;document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('try-demo').onclick=()=>{demoSnapshot={config:clone(config),layerIndex,selected,editTarget,dirty};demo=true;info={firmware:'1.2.0',schema:2,fsOK:false,nvsOK:true,fsTotal:0,fsUsed:0,gifValid:false};diag=null;renderAll();};
$('exit-demo').onclick=()=>{demo=false;if(demoSnapshot){({config,layerIndex,selected,editTarget,dirty}=demoSnapshot);demoSnapshot=null;}info=null;diag=null;renderAll();};
navigator.hid?.addEventListener('disconnect',e=>{if(client?.device===e.device){stopBridge();client=null;info=null;diag=null;recoveryPolling=false;stopRecording();renderAll();notify('USB接続が切れました。編集中の設定は画面に残っています。','error');}});
window.addEventListener('beforeunload',e=>{if(dirty&&client){e.preventDefault();e.returnValue='';}});
try{const raw=localStorage.getItem(draftKey);if(raw){const saved=JSON.parse(raw);if(saved.schema===2){config=canonical(saved.config);dirty=true;}}else{const old=localStorage.getItem('dialstudio-draft-v1');if(old){config=canonical(JSON.parse(old).macros);dirty=true;}}}catch{}
resetSelection();renderAll();
