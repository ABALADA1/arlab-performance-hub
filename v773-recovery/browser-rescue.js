(()=>{
'use strict';
if(window.__ARLAB_V773_BROWSER_RESCUE_RUNNING__){console.warn('[ARLAB V773] El rescate ya está en curso.');return;}
window.__ARLAB_V773_BROWSER_RESCUE_RUNNING__=true;

const OLD_BASE='https://xnlkjkrkkehplsbbziil.supabase.co/storage/v1/object/public/arlab-v699-static/';
const INDEX_URL='https://raw.githubusercontent.com/ABALADA1/arlab-performance-hub/main/v773-recovery/index-safe.html';
const RECEIVER='https://wchzahvvujxxajlmxhqa.supabase.co/functions/v1/arlab-v773-cache-rescue';
const CONCURRENCY=5;
const MIN_BYTES=24;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

function getKey(){
  let k='';
  try{k=sessionStorage.getItem('arlabCloudKey')||'';}catch{}
  if(!k){k=(prompt('ARLAB V773 · Introduce la misma clave de acceso de ARLAB para autorizar el rescate:')||'').trim();try{if(k)sessionStorage.setItem('arlabCloudKey',k);}catch{}}
  return k;
}
const key=getKey();
if(!key){window.__ARLAB_V773_BROWSER_RESCUE_RUNNING__=false;alert('Rescate cancelado: falta la clave de ARLAB.');return;}

const box=document.createElement('div');
box.id='arlab-v773-rescue-box';
box.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(430px,calc(100vw - 36px));background:#fff;color:#17324f;border:1px solid #ccd9e8;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.22);padding:16px;font:13px/1.45 Inter,Arial,sans-serif';
box.innerHTML='<div style="font-weight:900;font-size:16px;margin-bottom:6px">Rescate ARLAB V773</div><div id="ar-rescue-status">Preparando…</div><div style="height:7px;background:#e8eef6;border-radius:99px;overflow:hidden;margin:10px 0"><div id="ar-rescue-bar" style="height:100%;width:0;background:#0d5bd7;transition:width .15s"></div></div><div id="ar-rescue-detail" style="color:#60758e;max-height:130px;overflow:auto"></div>';
document.body.appendChild(box);
const status=box.querySelector('#ar-rescue-status'),bar=box.querySelector('#ar-rescue-bar'),detail=box.querySelector('#ar-rescue-detail');
function ui(s,p,d){if(status)status.textContent=s;if(bar&&Number.isFinite(p))bar.style.width=Math.max(0,Math.min(100,p))+'%';if(detail&&d){const x=document.createElement('div');x.textContent=d;detail.prepend(x);}}

function guessType(path,ct){ct=String(ct||'').split(';')[0].trim();if(ct&&ct!=='application/octet-stream')return ct;if(/\.css$/i.test(path))return 'text/css';if(/\.js$/i.test(path))return 'text/javascript';if(/\.svg$/i.test(path))return 'image/svg+xml';if(/\.png$/i.test(path))return 'image/png';if(/\.jpe?g$/i.test(path))return 'image/jpeg';if(/\.webp$/i.test(path))return 'image/webp';if(/\.woff2$/i.test(path))return 'font/woff2';return 'application/octet-stream';}
function assetPath(url){const u=new URL(url);return decodeURIComponent(u.pathname.split('/arlab-v699-static/').pop()||'').replace(/^\/+/, '');}
async function upload(path,blob,ct){
 const r=await fetch(RECEIVER+'?action=asset',{method:'POST',headers:{'x-arlab-key':key,'x-arlab-path':encodeURIComponent(path),'x-arlab-content-type':guessType(path,ct),'content-type':'application/octet-stream'},body:blob,cache:'no-store'});
 if(!r.ok){let t='';try{t=await r.text()}catch{};throw new Error('upload '+r.status+' '+t.slice(0,90));}
 return r.json().catch(()=>({ok:true}));
}
async function uploadIndex(text){
 const r=await fetch(RECEIVER+'?action=index',{method:'POST',headers:{'x-arlab-key':key,'content-type':'text/html; charset=utf-8'},body:text,cache:'no-store'});
 if(!r.ok)throw new Error('No se pudo guardar el índice V773 ('+r.status+')');
}
async function listRemote(){
 const r=await fetch(RECEIVER+'?action=list',{headers:{'x-arlab-key':key},cache:'no-store'});return r.ok?r.json():null;
}
async function rescueOne(item){
 const started=performance.now();
 try{
  // IMPORTANT: exact URL + force-cache. No cache-busting: we want the browser's old V773 bytes.
  const r=await fetch(item.url,{method:'GET',cache:'force-cache',credentials:'omit'});
  if(!r.ok)return {ok:false,path:item.path,reason:'HTTP '+r.status,ms:Math.round(performance.now()-started)};
  const b=await r.blob();
  if(b.size<MIN_BYTES)return {ok:false,path:item.path,reason:'vacío ('+b.size+' B)',ms:Math.round(performance.now()-started)};
  await upload(item.path,b,r.headers.get('content-type')||b.type||'');
  return {ok:true,path:item.path,bytes:b.size,ms:Math.round(performance.now()-started)};
 }catch(e){return {ok:false,path:item.path,reason:String(e&&e.message||e),ms:Math.round(performance.now()-started)};}
}
async function pool(items,n,fn,onResult){let i=0;async function worker(){while(true){const idx=i++;if(idx>=items.length)return;const x=await fn(items[idx],idx);onResult(x,idx);await sleep(12);}}await Promise.all(Array.from({length:Math.min(n,items.length)},worker));}

(async()=>{
 try{
  ui('Leyendo el índice exacto V773…',1);
  const ir=await fetch(INDEX_URL,{cache:'no-store'});if(!ir.ok)throw new Error('No se pudo leer el índice guardado ('+ir.status+')');
  const html=await ir.text();
  if(html.length<10000||!html.includes('arlab-v724'))throw new Error('El índice recuperado no parece ser la V773 esperada.');
  await uploadIndex(html);
  const doc=new DOMParser().parseFromString(html,'text/html');
  const refs=[];
  for(const el of doc.querySelectorAll('script[src],link[href]')){
    const raw=(el.getAttribute('src')||el.getAttribute('href')||'').trim();
    if(!raw||/^(data:|blob:|#|javascript:)/i.test(raw))continue;
    let u;try{u=new URL(raw,OLD_BASE);}catch{continue;}
    if(u.origin!==new URL(OLD_BASE).origin||!u.pathname.includes('/arlab-v699-static/'))continue;
    if(!/\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(u.pathname))continue;
    const path=assetPath(u.href);if(!path)continue;
    refs.push({url:u.href,path});
  }
  const seen=new Set(),items=refs.filter(x=>!seen.has(x.url)&&(seen.add(x.url),true));
  ui('Buscando '+items.length+' recursos V773 en la caché del navegador…',3,'No cierres esta pestaña.');
  let done=0,ok=0,failed=0,bytes=0,fastHits=0;
  const failures=[];
  await pool(items,CONCURRENCY,rescueOne,(r)=>{
    done++;if(r.ok){ok++;bytes+=r.bytes||0;if((r.ms||9999)<250)fastHits++;if(ok<=8||ok%25===0)ui('Recuperando V773 · '+ok+' guardados',3+94*done/items.length,'✓ '+r.path+' · '+Math.round((r.bytes||0)/1024)+' KB');}
    else{failed++;failures.push(r);if(failed<=5)ui('Recuperando V773 · '+ok+' guardados',3+94*done/items.length,'× '+r.path+' · '+r.reason);}
  });
  const remote=await listRemote();
  const report={finishedAt:new Date().toISOString(),total:items.length,recovered:ok,failed,bytes,fastCacheHits:fastHits,remoteCount:remote&&remote.count,failures:failures.slice(0,80)};
  window.ARLAB_V773_RESCUE_REPORT=report;
  console.log('[ARLAB V773] RESCATE FINALIZADO',report);
  if(ok>0){
    ui('Rescate terminado: '+ok+' de '+items.length+' recursos recuperados',100,Math.round(bytes/1024/1024*10)/10+' MB copiados al Supabase nuevo. Puedes dejar esta pestaña abierta.');
    box.style.borderColor=ok>=Math.ceil(items.length*.8)?'#35a46f':'#e0a128';
  }else{
    ui('La caché de este navegador no conservaba los archivos V773',100,'No se ha sobrescrito nada. Escríbeme el resultado que ves aquí.');box.style.borderColor='#c44747';
  }
 }catch(e){console.error('[ARLAB V773] rescate',e);ui('Error de rescate',100,String(e&&e.message||e));box.style.borderColor='#c44747';}
 finally{window.__ARLAB_V773_BROWSER_RESCUE_RUNNING__=false;}
})();
})();
