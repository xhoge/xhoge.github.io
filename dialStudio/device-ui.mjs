// UI-facing models shared by the editor and tests. All text is rendered with textContent.
export const defaults=()=>[
 {label:'コピー',modifiers:8,keys:[6],holdMs:40,gapMs:150},
 {label:'貼り付け',modifiers:8,keys:[25],holdMs:40,gapMs:150},
 {label:'元に戻す',modifiers:8,keys:[29],holdMs:40,gapMs:150},
 {label:'保存',modifiers:8,keys:[22],holdMs:40,gapMs:150},
];
export const keyRows=[
 [['Esc',41],...Array.from({length:12},(_,i)=>['F'+(i+1),58+i])],
 [['`',53],...Array.from({length:9},(_,i)=>[String(i+1),30+i]),['0',39],['−',45],['=',46],['⌫',42]],
 [['Tab',43],...Array.from('QWERTYUIOP',x=>[x,4+x.charCodeAt(0)-65]),['[',47],[']',48],['\\',49]],
 [['Caps',57],...Array.from('ASDFGHJKL',x=>[x,4+x.charCodeAt(0)-65]),[';',51],["'",52],['Enter',40]],
 [['Shift',-2],...Array.from('ZXCVBNM',x=>[x,4+x.charCodeAt(0)-65]),[',',54],['.',55],['/',56],['↑',82]],
 [['Ctrl',-1],['Option',-4],['Command',-8],['Space',44],['←',80],['↓',81],['→',79]],
];
// USB HID Keyboard/Keypad Usage IDs: F13..F24 = 0x68..0x73.
export const virtualFunctionKeys=Array.from({length:12},(_,i)=>[`F${13+i}`,0x68+i]);
export function assignVirtualFunction(macro,usage){
  if(!virtualFunctionKeys.some(([,code])=>code===usage))throw Error('対応するF13〜F24を選んでください。');
  return {...macro,modifiers:0,keys:[usage]};
}
const keyNames=new Map([...keyRows.flat().filter(([,v])=>v>0),...virtualFunctionKeys].map(([n,v])=>[v,n]));
export function keyName(code,platform='mac'){if(platform==='windows'&&code===42)return 'Backspace';return keyNames.get(code)??`Key ${code.toString(16).toUpperCase()}`;}
export function modifierNames(platform='mac'){return platform==='windows'?['Ctrl','Shift','Alt','Win','右Ctrl','右Shift','右Alt','右Win']:['Ctrl','Shift','Option','Command','右Ctrl','右Shift','右Option','右Command'];}
export function keyboardRows(platform='mac'){
 if(platform!=='windows')return keyRows;
 return [...keyRows.slice(0,-1).map(row=>row.map(([name,id])=>[name==='⌫'?'Backspace':name,id])),[['Ctrl',-1],['Win',-8],['Alt',-4],['Space',44],['←',80],['↓',81],['→',79]]];
}
export function chord(m,platform='mac'){return [...modifierNames(platform).filter((_,i)=>m.modifiers&(1<<i)),...m.keys.map(k=>keyName(k,platform))];}
export function shortcutPresets(platform='mac'){
 const primary=platform==='windows'?1:8;
 return [['コピー',primary,6],['貼り付け',primary,25],['切り取り',primary,27],['保存',primary,22],['元に戻す',primary,29],platform==='windows'?['やり直す',1,28]:['やり直す',10,29],['すべて選択',primary,4],['検索',primary,9]];
}
export function readableError(error,info){
  const messages={1:'通信データを正しく読み取れませんでした。接続し直してお試しください。',2:'ファームウェアと画面の通信バージョンが一致しません。新しい一式をご使用ください。',3:'この機能にはファームウェア v1.1.0 以降が必要です。更新後に接続し直してください。',4:'本体が別の処理を実行しています。処理が終わってからお試しください。',5:'転送が中断されました。30秒待ってから、もう一度送信してください。',6:'転送順序を確認できませんでした。最初から送信し直してください。',7:'ファイルサイズ、キーの数、または設定値が対応範囲を超えています。',8:'転送したデータが一致しませんでした。USB接続を確認して再送してください。',9:'GIFまたは設定の形式に対応していません。画像の条件を確認してください。',10:info?.nvsOK===false?'本体の設定保存領域を開けていません。再起動後も続く場合はファームウェアを確認してください。':info?.fsOK===false?'画像保存領域を開けていません。「デバイス状態」からセットアップしてください。':'本体へ保存できませんでした。画像保存領域の空き容量と接続を確認してください。'};
  if(Number.isInteger(error?.status))return messages[error.status]??'本体で処理を完了できませんでした。';
  if(error?.name==='NotFoundError')return '接続するデバイスが選択されませんでした。';
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return 'USBデバイスへのアクセスが許可されていません。Chromeで開き、接続を許可してください。';
  if(error?.name==='NetworkError'||error?.name==='InvalidStateError')return 'USB接続が切れたか、別のタブが本体を使用しています。接続し直してください。';
  const msg=error?.message??'';
  if(msg.startsWith('No response'))return '本体から応答がありません。USBを接続し直して、保存状態を読み出してください。';
  if(msg.includes('Validation timed out'))return '画像の確認が時間内に終わりませんでした。30秒後に状態を確認してください。';
  if(msg.startsWith('GIF must'))return 'GIFは512 KiB以下のファイルを選んでください。';
  if(msg.includes('Invalid label'))return '名前はUTF-8で63バイトまで、通常キーは重複なしで1〜6個にしてください。';
  if(msg.includes('timing'))return '押下時間は10〜1000ms、実行間隔は0〜2000msにしてください。';
  return /[ぁ-龯]/.test(msg)?msg:'処理を完了できませんでした。接続状態と入力内容を確認してください。';
}
export function storageModel(info,diag){
 if(!info)return {tone:'neutral',title:'本体を接続して確認',description:'USBでM5 Dialをつないで、「デバイスを接続」を押してください。'};
 if(!info.nvsOK)return {tone:'error',title:'設定保存領域を開けません',description:'本体を再起動してください。続く場合はファームウェアとパーティション設定を確認してください。'};
 if(info.fsOK)return {tone:'success',title:'画像を保存できます',description:info.gifValid?'本体にアイドル画像が保存されています。':'セットアップ済みです。アイドル画像を追加できます。'};
 if(diag?.reason===1)return {tone:'error',title:'画像保存用パーティションがありません',description:'同梱のpartitions.csvをスケッチと同じフォルダに置き、Partition SchemeをCustomにしてファームウェアを書き直してください。'};
 return {tone:'warning',title:'画像保存領域のセットアップが必要です',description:'USB接続とマクロの保存は動いていますが、画像を保存する領域を開けていません。初期化前、またはパーティション変更などで読み取れない状態です。'};
}
export function inspectGif(bytes){
 const a=new Uint8Array(bytes),v=new DataView(a.buffer,a.byteOffset,a.byteLength);let p=13,frames=0;
 const fail=msg=>{throw Error(msg);};
 if(a.length<14||a.length>524288)fail('GIFは14バイト以上・512 KiB以下にしてください。');
 const sig=String.fromCharCode(...a.subarray(0,6));if(!['GIF87a','GIF89a'].includes(sig))fail('GIFファイルを選んでください。拡張子の変更だけでは変換できません。');
 const w=v.getUint16(6,true),h=v.getUint16(8,true);if(!w||!h||w>240||h>240)fail('画像の大きさは240 × 240 px以内にしてください。');
 const take=n=>{if(p+n>a.length)fail('GIFファイルが途中で切れています。');const o=p;p+=n;return o;};
 const blocks=()=>{for(;;){const n=a[take(1)];if(!n)return;take(n);}};
 const global=!!(a[10]&128);if(global)take(3<<(1+(a[10]&7)));
 for(;;){
  const tag=a[take(1)];
  if(tag===59){if(!frames||p!==a.length)fail('GIFの末尾を正しく読み取れません。');return {width:w,height:h,frames,size:a.length};}
  if(tag===33){const label=a[take(1)];if(label===249){const o=take(6);if(a[o]!==4||a[o+5])fail('GIFのフレーム情報が不正です。');if(a[o+1]&1)fail('透過GIFにはまだ対応していません。背景を付けて書き出してください。');if((a[o+1]&0xe2)||((a[o+1]>>2)&7)>1)fail('フレームの背景復元処理には対応していません。全フレームを全面画像で書き出してください。');}
    else if(label===254||label===255)blocks();else fail('このGIFの拡張形式には対応していません。');
  }else if(tag===44){const o=take(9);
    if(v.getUint16(o,true)||v.getUint16(o+2,true)||v.getUint16(o+4,true)!==w||v.getUint16(o+6,true)!==h)fail('差分フレームのGIFです。最適化を無効にし、各フレームを全面画像で書き出してください。');
    if(a[o+8]&0x78)fail('インターレースなどのフレーム形式に対応していません。通常のGIFで書き出してください。');
    if(a[o+8]&128)take(3<<(1+(a[o+8]&7)));else if(!global)fail('GIFのカラーパレットがありません。');
    const code=a[take(1)];if(code<2||code>8)fail('GIFの圧縮形式が不正です。');blocks();if(++frames>600)fail('GIFは600フレーム以下にしてください。');
  }else fail('GIFの構造を読み取れません。別のGIFでお試しください。');
 }
}
