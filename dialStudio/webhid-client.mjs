import {encodeLayers,decodeLayers,CONFIG_MAX} from './layer-config.mjs';
// Browser ES module, no dependencies. See PROTOCOL.md. No keyboard collection access.
export function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); }
  return (c^0xffffffff)>>>0;
}
const u32=(a,n)=>new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(n,true);
const w32=(a,n,v)=>new DataView(a.buffer,a.byteOffset,a.byteLength).setUint32(n,v,true);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function packet(op,seq,session=0,offset=0,payload=new Uint8Array()) {
  if(payload.length>40) throw Error('Payload exceeds 40 bytes');
  const a=new Uint8Array(63);a.set([77,68,1,op]);w32(a,4,seq);w32(a,8,session);w32(a,12,offset);
  a[16]=payload.length;a.set(payload,19);w32(a,59,crc32(a.subarray(0,59)));return a;
}
export function parsePacket(a) {
  if(a.length!==63||a[0]!==77||a[1]!==68||a[2]!==1||!(a[3]&128)||a[16]>40||a[18]||
      a.subarray(19+a[16],59).some(x=>x!==0)||crc32(a.subarray(0,59))!==u32(a,59))throw Error('Invalid response');
  return {op:a[3]&127,seq:u32(a,4),session:u32(a,8),offset:u32(a,12),status:a[17],data:a.slice(19,19+a[16])};
}
export function encodeConfig(macros) {
  if(macros?.schema===2)return encodeLayers(macros);
  if(!Array.isArray(macros)||macros.length<1||macros.length>16)throw Error('1..16 macros required');
  const a=new Uint8Array(8+80*macros.length),v=new DataView(a.buffer);
  a.set([77,67,1,macros.length,80,0,0,0]);
  macros.forEach((m,i)=>{
    const o=8+80*i,label=new TextEncoder().encode(m.label),keys=m.keys;
    if(typeof m.label!=='string'||!label.length||label.length>63||/[\u0000-\u001f\u007f-\u009f]/u.test(m.label)||
      !Array.isArray(keys)||keys.length<1||keys.length>6||new Set(keys).size!==keys.length||
      keys.some(k=>!Number.isInteger(k)||k<4||k>0xa4)||!Number.isInteger(m.modifiers)||m.modifiers<0||m.modifiers>255)
      throw Error('Invalid label/modifiers/keys');
    const hold=m.holdMs??40,gap=m.gapMs??150;
    if(!Number.isInteger(hold)||hold<10||hold>1000||!Number.isInteger(gap)||gap<0||gap>2000)throw Error('Invalid timing');
    a.set(label,o);a[o+64]=m.modifiers;a[o+65]=keys.length;a.set(keys,o+66);v.setUint16(o+72,hold,true);v.setUint16(o+74,gap,true);
  });return a;
}
export function decodeConfig(a) {
  if(a[2]===2)return decodeLayers(a);
  if(a.length<88||a[0]!==77||a[1]!==67||a[2]!==1||a[3]<1||a[3]>16||a[4]!==80||a[5]||a[6]||a[7]||a.length!==8+80*a[3])throw Error('Unsupported config');
  const v=new DataView(a.buffer,a.byteOffset,a.byteLength),result=[];
  for(let i=0;i<a[3];i++){
    const o=8+80*i,end=a.subarray(o,o+64).indexOf(0);if(end<1)throw Error('Invalid label');
    result.push({label:new TextDecoder('utf-8',{fatal:true}).decode(a.subarray(o,o+end)),modifiers:a[o+64],keys:Array.from(a.subarray(o+66,o+66+a[o+65])),holdMs:v.getUint16(o+72,true),gapMs:v.getUint16(o+74,true)});
  }
  const canonical=encodeConfig(result);if(canonical.some((b,i)=>b!==a[i]))throw Error('Noncanonical config');return result;
}
export class DialClient {
  constructor(device,reportId) {
    this.device=device;this.reportId=reportId;this.seq=crypto.getRandomValues(new Uint32Array(1))[0];this.busy=false;this.pending=null;
    this.onInput=e=>{
      if(e.reportId!==this.reportId||!this.pending)return;
      try {const r=parsePacket(new Uint8Array(e.data.buffer,e.data.byteOffset,e.data.byteLength));
        if(r.seq===this.pending.seq&&r.op===this.pending.op)this.pending.resolve(r);
      } catch {/* Ignore malformed packets; caller retries identical request. */}
    };
    device.addEventListener('inputreport',this.onInput);
  }
  static async connect() {
    // Must be called from a button click in HTTPS or localhost Chrome.
    const devices=await navigator.hid.requestDevice({filters:[{usagePage:0xff00,usage:1}]});
    if(!devices.length)throw Error('No device selected');const d=devices[0];await d.open();
    const c=d.collections.find(c=>c.usagePage===0xff00&&c.usage===1);
    const report=c?.outputReports.find(r=>r.items.reduce((n,i)=>n+i.reportSize*i.reportCount,0)===504);
    const id=report?.reportId;
    if(id===undefined||!c.inputReports.some(r=>r.reportId===id&&r.items.reduce((n,i)=>n+i.reportSize*i.reportCount,0)===504)){
      await d.close();throw Error('Expected 63-byte Vendor IN/OUT reports');
    }
    const client=new DialClient(d,id);
    try {await client.info();return client;}catch(e){await client.close();throw e;}
  }
  async exclusive(fn) {
    if(this.busy)throw Error('Another operation is running');this.busy=true;
    try{return await fn();}finally{this.busy=false;}
  }
  async request(op,session=0,offset=0,data=new Uint8Array()) {
    // Internal API. Do not call concurrently. At most one request outstanding.
    if(this.pending)throw Error('Concurrent request');
    const seq=this.seq=(this.seq+1)>>>0,q=packet(op,seq,session,offset,data);
    try {
      for(let attempt=0;attempt<3;attempt++){
        let timer;
        const reply=new Promise(resolve=>{
          this.pending={seq,op,resolve};timer=setTimeout(()=>resolve(null),10000);
        });
        let r;
        try {await this.device.sendReport(this.reportId,q);r=await reply;}finally{clearTimeout(timer);}
        if(r){if(r.status!==0&&r.status!==11){const e=Error(`Device status ${r.status}`);e.status=r.status;throw e;}return r;}
      }
      throw Error('No response. Reconnect and read INFO/STATUS before retrying a write.');
    }finally{this.pending=null;}
  }
  async _info() {
    const r=await this.request(1),d=r.data;if(d.length!==36||![1,2].includes(d[3]))throw Error('Unsupported firmware');
    return {firmware:`${d[0]}.${d[1]}.${d[2]}`,schema:d[3],configMax:u32(d,4),gifMax:u32(d,8),configLength:u32(d,12),configCRC:u32(d,16),fsTotal:u32(d,20),fsUsed:u32(d,24),fsOK:!!d[28],nvsOK:!!d[29],gifValid:!!d[30],reportId:d[31],gifCRC:u32(d,32)};
  }
  info(){return this.exclusive(()=>this._info());}
  storageDiagnostics(){return this.exclusive(async()=>{
    const {data:d}=await this.request(3);
    if(d.length!==24||d[0]!==1)throw Error('Unsupported diagnostics');
    return {reason:d[1],recovery:d[2],partitionOffset:u32(d,4),partitionSize:u32(d,8),total:u32(d,12),used:u32(d,16),remainingMs:u32(d,20)};
  });}
  armStorageReset(){return this.exclusive(()=>this.request(0x30,0,0,new TextEncoder().encode('ERASEGIF')));}
  cancelStorageReset(){return this.exclusive(()=>this.request(0x31));}
  async _status(session=0) {
    const {data:d}=await this.request(2,session);if(d.length!==24)throw Error('Invalid status');
    return {kind:d[0],result:d[1],token:u32(d,4),offset:u32(d,8),size:u32(d,12),lastToken:u32(d,16),gifSize:u32(d,20)};
  }
  status(session=0){return this.exclusive(()=>this._status(session));}
  readConfig(){return this.exclusive(async()=>{
    const info=await this._info();
    if(info.configLength<12||info.configLength>Math.min(CONFIG_MAX,info.configMax))throw Error('Invalid config size');
    const a=new Uint8Array(info.configLength);
    for(let off=0;off<a.length;){const r=await this.request(0x10,0,off);
      if(r.offset!==off||!r.data.length||off+r.data.length>a.length)throw Error('Invalid config chunk');a.set(r.data,off);off+=r.data.length;}
    if(crc32(a)!==info.configCRC)throw Error('Config changed while reading; read again');return decodeConfig(a);
  });}
  async _upload(base,bytes,onProgress) {
    const meta=new Uint8Array(8);w32(meta,0,bytes.length);w32(meta,4,crc32(bytes));
    const begin=await this.request(base+1,0,0,meta),session=begin.session;
    if(!session)throw Error('Missing transfer token');
    for(let off=0;off<bytes.length;){const part=bytes.subarray(off,off+40),r=await this.request(base+2,session,off,part);
      if(r.status||r.offset!==off+part.length)throw Error('Unexpected transfer offset');off=r.offset;onProgress?.(off,bytes.length);}
    const commit=await this.request(base+3,session);
    if(commit.status===11){
      const deadline=Date.now()+45000;
      for(;;){await wait(100);const s=await this._status(session);
        if(!s.kind&&s.lastToken===session){if(s.result){const e=Error(`Validation failed: ${s.result}`);e.status=s.result;throw e;}break;}
        if(Date.now()>deadline)throw Error('Validation timed out; query status before uploading again');
      }
    }
    // Verify durable object identity after commit (does not substitute for a reboot test).
    const info=await this._info();if((base===0x10?info.configCRC:info.gifCRC)!==crc32(bytes))throw Error('Post-commit CRC mismatch');
    return info;
  }
  writeConfig(macros,onProgress){return this.exclusive(async()=>{
    const bytes=encodeConfig(macros),info=await this._info();
    if(bytes[2]>info.schema)throw Error('レイヤー機能には本体ファームウェア v1.2.0 が必要です。');
    if(bytes.length>info.configMax)throw Error('本体の設定容量を超えています。');return this._upload(0x10,bytes,onProgress);
  });}
  pendingText(){return this.exclusive(async()=>{
    let response=await this.request(0x40),d=response.data;
    if(d.length<8)throw Error('文字列応答が不正です。');const id=u32(d,0);if(!id)return null;
    const length=d[4]|d[5]<<8,flags=d[6];if(!length||length>240||![1,3].includes(flags))throw Error('文字列応答が不正です。');
    const bytes=new Uint8Array(length);let offset=0;
    for(;;){d=response.data;if(d.length<8||u32(d,0)!==id||(d[4]|d[5]<<8)!==length||d[6]!==flags||!d[7]||d[7]>32||d.length!==8+d[7]||offset+d[7]>length)throw Error('文字列の分割応答が不正です。');
      bytes.set(d.subarray(8),offset);offset+=d[7];if(offset===length)break;response=await this.request(0x40,id,offset);
    }
    return {id,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),platform:flags&2?'mac':'windows'};
  });}
  acknowledgeText(id,success){return this.exclusive(()=>this.request(0x41,id,0,new Uint8Array([success?1:0])));}
  uploadGif(bytes,onProgress){return this.exclusive(async()=>{
    bytes=new Uint8Array(bytes);if(bytes.length<14||bytes.length>524288)throw Error('GIF must be 14..524288 bytes');
    return this._upload(0x20,bytes,onProgress);
  });}
  abort(session,kind){return this.exclusive(()=>this.request(kind===1?0x14:0x24,session));}
  async close(){if(this.busy)throw Error('Wait for current operation to finish');this.device.removeEventListener('inputreport',this.onInput);await this.device.close();}
}
