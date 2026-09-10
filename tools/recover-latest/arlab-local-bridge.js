(()=>{'use strict';
const LOCAL='http://127.0.0.1:8765';
const remoteHosts=new Set(['wchzahvvujxxajlmxhqa.supabase.co','xnlkjkrkkehplsbbziil.supabase.co']);
function map(raw){
  try{
    const value=typeof raw==='string'?raw:(raw&&raw.url)||String(raw);
    const u=new URL(value,location.href); const p=u.pathname||'';
    if(u.origin===LOCAL) return null;
    if((u.hostname==='127.0.0.1'||u.hostname==='localhost')&&p.startsWith('/api/')) return LOCAL+p+u.search;
    if(remoteHosts.has(u.hostname)){
      const mark='/functions/v1/arlab-v779-web/'; const i=p.indexOf(mark);
      if(i>=0) return LOCAL+'/'+p.slice(i+mark.length).replace(/^\/+/, '')+u.search;
      if(/\/functions\/v1\/arlab-v784-state-read-shim/.test(p)) return LOCAL+'/arlab-local-shim.js';
      if(/\/functions\/v1\//.test(p)){
        const a=u.searchParams.get('action')||'';
        if(a==='health'||a==='write-health') return LOCAL+'/api/health';
        if(a==='state-meta') return LOCAL+'/api/state/meta';
        if(a==='state'||a==='state-read'||a==='state-write') return LOCAL+'/api/state';
      }
      if(/\/storage\/v1\/object\//.test(p)){
        const base=p.split('/').pop(); if(base) return LOCAL+'/'+base+u.search;
      }
    }
    if(p==='/__state') return LOCAL+'/api/state'+u.search;
    return null;
  }catch{return null}
}
try{
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){const m=map(input);if(!m)return nativeFetch(input,init);try{if(input instanceof Request&&!init)return nativeFetch(new Request(m,input));return nativeFetch(m,init)}catch{return nativeFetch(m,init)}};
}catch{}
try{const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){return xo.call(this,method,map(url)||url,...rest)}}catch{}
try{Object.defineProperty(window,'ARLAB_DATA_STORE_ORIGIN',{configurable:true,get:()=>LOCAL,set:()=>{}});Object.defineProperty(window,'ARLAB_JSON_STORE_ORIGIN',{configurable:true,get:()=>LOCAL,set:()=>{}})}catch{window.ARLAB_DATA_STORE_ORIGIN=LOCAL;window.ARLAB_JSON_STORE_ORIGIN=LOCAL}
window.ARLAB_V779_API_ORIGIN=LOCAL; window.ARLAB_V779_ONLINE_BASE=LOCAL; window.ARLAB_LOCAL_MODE=true;
try{if(navigator.serviceWorker?.register)navigator.serviceWorker.register=async()=>({scope:location.origin+'/',active:null,waiting:null,installing:null,update:async()=>{},unregister:async()=>true})}catch{}
console.info('[ARLAB] modo local de recuperación activo');
})();
