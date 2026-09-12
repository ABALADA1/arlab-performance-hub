import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand,
  HeadObjectCommand, ListObjectsV2Command
} from '@aws-sdk/client-s3';

const app = express();
app.use(cors({ origin: true, credentials: false, exposedHeaders: ['X-ARLAB-Revision','X-ARLAB-Import-Token','Content-Length'] }));
app.use(express.raw({ type: '*/*', limit: '600mb' }));

const PORT = Number(process.env.PORT || 3000);
const BUCKET = process.env.BUCKET || process.env.AWS_S3_BUCKET_NAME || '';
const ENDPOINT = process.env.ENDPOINT || process.env.AWS_ENDPOINT_URL || '';
const REGION = process.env.REGION || process.env.AWS_DEFAULT_REGION || 'auto';
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
const STATIC_PREFIX = String(process.env.ARLAB_STATIC_PREFIX || 'app/current').replace(/^\/+|\/+$/g, '');
const STATE_PREFIX = String(process.env.ARLAB_STATE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');
const GPS_PREFIX = String(process.env.ARLAB_GPS_PREFIX || 'gps').replace(/^\/+|\/+$/g, '');
const MAX_IMPORT = Number(process.env.ARLAB_MAX_IMPORT_BYTES || 200 * 1024 * 1024);

if (!BUCKET || !ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.warn('[ARLAB Railway] Missing bucket credentials. Configure BUCKET, ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY.');
}

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: String(process.env.AWS_S3_URL_STYLE || '').toLowerCase() === 'path',
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
});

const keyState = name => `${STATE_PREFIX}/${name}`;
const keyGps = name => `${GPS_PREFIX}/${name}`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safe = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(x => x && x !== '.' && x !== '..').join('/');
const json = (res, body, status=200) => res.status(status).type('application/json').send(JSON.stringify(body));

function mime(path='') {
  const ext = path.toLowerCase().split('.').pop();
  return ({html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',mjs:'application/javascript; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',pdf:'application/pdf',csv:'text/csv; charset=utf-8',txt:'text/plain; charset=utf-8',wasm:'application/wasm'})[ext] || 'application/octet-stream';
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks=[];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getObject(key) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return { body: await bodyToBuffer(out.Body), contentType: out.ContentType, length: out.ContentLength, etag: out.ETag };
  } catch (e) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}
async function putObject(key, body, contentType='application/octet-stream') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: data, ContentType: contentType }));
  return data.length;
}
async function removeObject(key) { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
async function headObject(key) {
  try { return await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); }
  catch (e) { if (e?.$metadata?.httpStatusCode === 404) return null; throw e; }
}
async function readJson(key) {
  const x = await getObject(key); if (!x) return null;
  try { return JSON.parse(x.body.toString('utf8')); } catch { return null; }
}

function stateMeta(text) {
  let o={}; try { o=JSON.parse(text); } catch {}
  const p=o?.__arlabPersistence || {};
  return {
    revision: Number(p.revision || 0),
    updatedAt: String(p.updatedAt || new Date().toISOString()),
    importToken: String(p.importToken || ''),
    bytes: Buffer.byteLength(text),
    sha256: sha256(text)
  };
}

async function rotateState(oldText) {
  const p1 = await getObject(keyState('previous-1.json'));
  if (p1) await putObject(keyState('previous-2.json'), p1.body, 'application/json');
  if (oldText) {
    await putObject(keyState('previous-1.json'), oldText, 'application/json');
    await putObject(keyState('last-good.json'), oldText, 'application/json');
  }
}

async function saveState(text, isImport=false) {
  let parsed;
  try { parsed=JSON.parse(text); } catch { return { status:400, body:{ error:'state JSON inválido' } }; }
  if (isImport && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const incoming = parsed.format === 'ARLAB_BBDD_JSON' && parsed.state && typeof parsed.state === 'object'
      ? parsed.state
      : (parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state) ? parsed.state : parsed);
    if (incoming !== parsed) { parsed=incoming; text=JSON.stringify(incoming); }
  }
  const incoming=stateMeta(text);
  const oldMeta=await readJson(keyState('meta.json'));
  const protection=await readJson(keyState('protection.json'));
  if (!isImport) {
    const protectedBytes=Number(protection?.referenceBytes || 0), minBytes=Number(protection?.minBytes || 0);
    if (protectedBytes >= 5_000_000 && minBytes > 0 && incoming.bytes < minBytes)
      return {status:409,body:{error:'Protección BBDD: guardado parcial rechazado',guard:'railway-v1',incomingBytes:incoming.bytes,minBytes,protectedBytes}};
    if (oldMeta) {
      const oldRev=Number(oldMeta.revision||0);
      if (incoming.revision && oldRev && incoming.revision < oldRev) return {status:409,body:{error:'Revisión antigua rechazada',revision:oldRev}};
      if (incoming.revision === oldRev && oldMeta.sha256 === incoming.sha256) return {status:200,body:{saved:true,unchanged:true,...oldMeta}};
    }
  }
  const old=await getObject(keyState('current.json'));
  await rotateState(old?.body || null);
  await putObject(keyState('current.json'), text, 'application/json');
  const meta={...incoming,exists:true,savedAt:new Date().toISOString(),import:!!isImport};
  await putObject(keyState('meta.json'), JSON.stringify(meta), 'application/json');
  if (isImport) {
    const minBytes=incoming.bytes >= 5_000_000 ? Math.max(2_000_000,Math.floor(incoming.bytes*.35)) : 0;
    await putObject(keyState('protection.json'), JSON.stringify({version:1,referenceBytes:incoming.bytes,minBytes,updatedAt:new Date().toISOString()}), 'application/json');
  }
  return {status:200,body:{saved:true,revision:meta.revision,updatedAt:meta.updatedAt,bytes:meta.bytes,import:!!isImport,importToken:meta.importToken,guard:'railway-v1'}};
}

app.get('/health', async (_req,res) => {
  try {
    const state=await headObject(keyState('current.json'));
    return json(res,{ok:true,service:'arlab-railway-backend',storage:'railway-bucket',stateBytes:Number(state?.ContentLength||0),retention:'current+last-good+previous-1+previous-2'});
  } catch(e) { return json(res,{ok:false,error:e.message},500); }
});

app.get(['/api/state','/__state'], async (_req,res) => {
  try {
    const obj=await getObject(keyState('current.json'));
    if(!obj) return json(res,{error:'state/current.json no disponible'},404);
    const meta=await readJson(keyState('meta.json')) || {};
    res.set('X-ARLAB-Import-Token',String(meta.importToken||''));
    res.set('X-ARLAB-Revision',String(meta.revision||0));
    res.set('Cache-Control','no-store');
    return res.status(200).type('application/json').send(obj.body);
  } catch(e){ return json(res,{error:e.message},500); }
});
app.head(['/api/state','/__state'], async (_req,res) => {
  try { const h=await headObject(keyState('current.json')); if(!h)return res.sendStatus(404); res.set('Content-Length',String(h.ContentLength||0)); return res.sendStatus(200); }
  catch { return res.sendStatus(500); }
});
app.put('/api/state', async (req,res) => { const out=await saveState(Buffer.from(req.body||[]).toString('utf8'),req.get('x-arlab-import')!=null); return json(res,out.body,out.status); });
app.post('/api/state', async (req,res) => { const out=await saveState(Buffer.from(req.body||[]).toString('utf8'),req.get('x-arlab-import')!=null); return json(res,out.body,out.status); });
app.get('/api/state/meta', async (_req,res)=>json(res,{exists:!!(await headObject(keyState('current.json'))),...(await readJson(keyState('meta.json'))||{}),protection:await readJson(keyState('protection.json'))}));

app.get('/api/gps/manifest', async (_req,res)=>{ const m=await getObject(keyGps('manifest.json')); if(!m)return json(res,{version:1,gpsState:{gpsRawLogs:[],gpsCutSessions:[]},rawFiles:[]}); return res.type('application/json').send(m.body); });
app.put('/api/gps/manifest', async (req,res)=>{ const t=Buffer.from(req.body||[]).toString('utf8'); try{JSON.parse(t)}catch{return json(res,{error:'GPS manifest inválido'},400)} await putObject(keyGps('manifest.json'),t,'application/json'); return json(res,{ok:true,saved:true}); });
app.get('/api/gps/raw/:id', async (req,res)=>{ const o=await getObject(keyGps(`raw/${safe(req.params.id).replace(/\//g,'_')}.bin`)); if(!o)return json(res,{error:'not found'},404); return res.type('application/octet-stream').send(o.body); });
app.put('/api/gps/raw/:id', async (req,res)=>{ const id=safe(req.params.id).replace(/\//g,'_'), b=Buffer.from(req.body||[]); await putObject(keyGps(`raw/${id}.bin`),b); return json(res,{ok:true,id,size:b.length}); });
app.post('/api/gps/raw/:id', async (req,res)=>{ const id=safe(req.params.id).replace(/\//g,'_'), b=Buffer.from(req.body||[]); await putObject(keyGps(`raw/${id}.bin`),b); return json(res,{ok:true,id,size:b.length}); });

app.put('/api/media/chunk/:id', async (req,res)=>{
  const id=safe(req.params.id).replace(/\//g,'_'), off=Math.max(0,Number(req.query.offset||0));
  const metaKey=`imports/${id}/meta.json`, m=await readJson(metaKey)||{received:0,parts:[]};
  if(off!==Number(m.received||0))return json(res,{error:'Offset no esperado',expectedOffset:Number(m.received||0)},409);
  const b=Buffer.from(req.body||[]), part=`imports/${id}/parts/${String(off).padStart(12,'0')}.bin`;
  await putObject(part,b); m.parts.push({path:part,offset:off,size:b.length}); m.received=off+b.length; m.updatedAt=new Date().toISOString();
  await putObject(metaKey,JSON.stringify(m),'application/json'); return json(res,{received:m.received});
});
app.delete('/api/media/chunk/:id', async (req,res)=>{
  const id=safe(req.params.id).replace(/\//g,'_'), prefix=`imports/${id}/`; let token;
  do { const list=await s3.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,ContinuationToken:token})); if(list.Contents?.length) await s3.send(new DeleteObjectsCommand({Bucket:BUCKET,Delete:{Objects:list.Contents.map(x=>({Key:x.Key}))}})); token=list.IsTruncated?list.NextContinuationToken:undefined; } while(token);
  return json(res,{ok:true});
});
app.post('/api/state/import-uploaded-media', async (req,res)=>{
  const id=safe(req.query.id).replace(/\//g,'_'), expected=Number(req.query.bytes||0), meta=await readJson(`imports/${id}/meta.json`);
  if(!meta?.parts) return json(res,{error:'Importación no encontrada'},404);
  if(expected&&Number(meta.received)!==expected)return json(res,{error:'Bytes incompletos',received:meta.received,expected},409);
  if(Number(meta.received)>MAX_IMPORT)return json(res,{error:`El JSON supera el límite de ${MAX_IMPORT} bytes`},413);
  const chunks=[]; for(const p of [...meta.parts].sort((a,b)=>a.offset-b.offset)){const o=await getObject(p.path);if(!o)return json(res,{error:'Falta un fragmento'},409);chunks.push(o.body)}
  const out=await saveState(Buffer.concat(chunks).toString('utf8'),true);
  await s3.send(new DeleteObjectsCommand({Bucket:BUCKET,Delete:{Objects:[...meta.parts.map(p=>({Key:p.path})),{Key:`imports/${id}/meta.json`} ]}}));
  return json(res,out.body,out.status);
});

app.get('/__meta', async (_req,res)=>json(res,{ok:true,service:'arlab-railway-backend',state:await readJson(keyState('meta.json')),staticPrefix:STATIC_PREFIX}));

// Static package: upload current ARLAB webroot into app/current/ in the Railway bucket.
app.get('*', async (req,res)=>{
  try {
    let rel=safe(req.path); if(!rel) rel='index-safe.html';
    let obj=await getObject(`${STATIC_PREFIX}/${rel}`);
    if(!obj && !rel.includes('.')) obj=await getObject(`${STATIC_PREFIX}/index-safe.html`);
    if(!obj)return json(res,{error:'not found',path:rel},404);
    res.set('Cache-Control',/\.(?:js|css|png|jpe?g|svg|webp|woff2?)$/i.test(rel)?'public, max-age=3600, s-maxage=86400':'no-store');
    return res.status(200).type(obj.contentType||mime(rel)).send(obj.body);
  } catch(e){return json(res,{error:e.message},500)}
});

app.listen(PORT,'0.0.0.0',()=>console.log(`[ARLAB Railway] listening on ${PORT}`));
