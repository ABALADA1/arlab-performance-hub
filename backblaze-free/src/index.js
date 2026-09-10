import { AwsClient } from 'aws4fetch';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-ARLAB-Import,X-ARLAB-Revision,X-ARLAB-Import-Token,X-ARLAB-Key',
  'Access-Control-Expose-Headers': 'Content-Length,X-ARLAB-Revision,X-ARLAB-Import-Token,X-ARLAB-Storage',
  'Cache-Control': 'no-store'
};
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra }
});
const safe = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(x => x && x !== '.' && x !== '..').join('/');
const encodeKey = key => safe(key).split('/').map(encodeURIComponent).join('/');

function regionFromEndpoint(endpoint) {
  const m = String(endpoint || '').match(/s3[.-]([a-z0-9-]+)\.backblazeb2\.com/i);
  return m?.[1] || 'us-west-004';
}

function storage(env) {
  const endpoint = String(env.B2_ENDPOINT || '').replace(/\/+$/, '');
  const bucketName = String(env.B2_BUCKET || 'arlab-data');
  const region = String(env.B2_REGION || regionFromEndpoint(endpoint));
  if (!endpoint || !env.B2_KEY_ID || !env.B2_APPLICATION_KEY) {
    throw new Error('Backblaze B2 no configurado: faltan B2_ENDPOINT/B2_KEY_ID/B2_APPLICATION_KEY');
  }
  const aws = new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APPLICATION_KEY,
    service: 's3',
    region
  });
  const urlFor = key => `${endpoint}/${encodeURIComponent(bucketName)}/${encodeKey(key)}`;
  const signedFetch = async (key, init = {}) => {
    const res = await aws.fetch(urlFor(key), init);
    if (!res.ok && res.status !== 404) {
      const detail = await res.clone().text().catch(() => '');
      throw new Error(`B2 ${init.method || 'GET'} ${key}: HTTP ${res.status}${detail ? ` · ${detail.slice(0,240)}` : ''}`);
    }
    return res;
  };
  return {
    async get(key) {
      const res = await signedFetch(key, { method: 'GET' });
      if (res.status === 404) return null;
      return {
        body: res.body,
        size: Number(res.headers.get('content-length') || 0),
        httpMetadata: { contentType: res.headers.get('content-type') || undefined },
        text: () => res.text()
      };
    },
    async head(key) {
      const res = await signedFetch(key, { method: 'HEAD' });
      if (res.status === 404) return null;
      return {
        size: Number(res.headers.get('content-length') || 0),
        contentType: res.headers.get('content-type') || undefined,
        etag: res.headers.get('etag') || undefined
      };
    },
    async put(key, body, options = {}) {
      const headers = new Headers();
      const ct = options?.httpMetadata?.contentType || options?.contentType || 'application/octet-stream';
      headers.set('content-type', ct);
      // Backblaze S3 accepts SigV4 over HTTPS; UNSIGNED-PAYLOAD keeps large ARLAB JSON/GPS streaming.
      headers.set('x-amz-content-sha256', 'UNSIGNED-PAYLOAD');
      for (const [k,v] of Object.entries(options?.customMetadata || {})) headers.set(`x-amz-meta-${k}`, String(v));
      const res = await signedFetch(key, { method: 'PUT', headers, body });
      return { ok: res.ok, etag: res.headers.get('etag') || '' };
    },
    async delete(key) {
      const res = await signedFetch(key, { method: 'DELETE' });
      return res.ok || res.status === 404;
    },
    async copy(from, to) {
      const headers = new Headers({
        'x-amz-copy-source': `/${bucketName}/${encodeKey(from)}`,
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD'
      });
      const res = await signedFetch(to, { method: 'PUT', headers });
      return res.ok;
    }
  };
}

async function readJson(bucket, key) {
  const o = await bucket.get(key);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch { return null; }
}
async function copyObject(bucket, from, to) {
  const head = await bucket.head(from);
  if (!head) return false;
  return bucket.copy(from, to);
}
async function rotateState(bucket) {
  await copyObject(bucket, 'state/previous-1.json', 'state/previous-2.json');
  await copyObject(bucket, 'state/current.json', 'state/last-good.json');
  await copyObject(bucket, 'state/current.json', 'state/previous-1.json');
}
function stateHeaders(meta = {}, size = 0) {
  return {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(size || meta.bytes || 0),
    'X-ARLAB-Revision': String(meta.revision || 0),
    'X-ARLAB-Import-Token': String(meta.importToken || ''),
    'X-ARLAB-Storage': 'backblaze-b2'
  };
}
function writeAllowed(request, env) {
  const expected = String(env.ARLAB_WRITE_KEY || '');
  if (!expected) return true;
  return request.headers.get('x-arlab-key') === expected;
}

async function saveState(request, env, bucket) {
  const maxBytes = Number(env.ARLAB_MAX_STATE_BYTES || 100000000);
  const minBytes = Number(env.ARLAB_MIN_STATE_BYTES || 2000000);
  const contentLength = Number(request.headers.get('content-length') || 0);
  const isImport = request.headers.has('x-arlab-import');
  const oldMeta = await readJson(bucket, 'state/meta.json') || {};
  if (contentLength > maxBytes) return json({ error: `La BBDD supera el límite de ${maxBytes} bytes` }, 413);
  if (!isImport && Number(oldMeta.bytes || 0) >= 5000000 && contentLength && contentLength < Math.max(minBytes, Number(oldMeta.bytes || 0) * 0.20)) {
    return json({ error:'Protección BBDD: guardado parcial rechazado', guard:'backblaze-v1', incomingBytes:contentLength, previousBytes:Number(oldMeta.bytes || 0) }, 409);
  }
  if (!request.body) return json({ error:'BBDD vacía' }, 400);

  await rotateState(bucket);
  const revisionHeader = Number(request.headers.get('x-arlab-revision') || 0);
  const revision = revisionHeader || Number(oldMeta.revision || 0) + 1;
  const importToken = request.headers.get('x-arlab-import-token') || oldMeta.importToken || '';
  const savedAt = new Date().toISOString();
  await bucket.put('state/current.json', request.body, {
    httpMetadata:{ contentType:'application/json; charset=utf-8' },
    customMetadata:{ revision:String(revision), savedAt }
  });
  const head = await bucket.head('state/current.json');
  const bytes = Number(head?.size || contentLength || 0);
  const meta = { exists:true, revision, bytes, importToken, updatedAt:savedAt, savedAt, import:!!isImport };
  await bucket.put('state/meta.json', JSON.stringify(meta), { httpMetadata:{ contentType:'application/json' } });
  if (isImport) {
    const floor = bytes >= 5000000 ? Math.max(minBytes, Math.floor(bytes * 0.20)) : 0;
    await bucket.put('state/protection.json', JSON.stringify({ referenceBytes:bytes, minBytes:floor, updatedAt:savedAt }), { httpMetadata:{ contentType:'application/json' } });
  }
  return json({ saved:true, revision, bytes, import:!!isImport, guard:'backblaze-v1' });
}

function concatObjects(bucket, keys) {
  let index = 0, reader = null;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (reader) {
          const { value, done } = await reader.read();
          if (!done) { controller.enqueue(value); return; }
          reader = null; index++;
        }
        if (index >= keys.length) { controller.close(); return; }
        const obj = await bucket.get(keys[index]);
        if (!obj) { controller.error(new Error(`Falta fragmento ${keys[index]}`)); return; }
        reader = obj.body.getReader();
      }
    },
    async cancel() { try { await reader?.cancel(); } catch {} }
  });
}
async function importChunks(request, env, url, bucket) {
  const id = safe(url.searchParams.get('id') || '').replace(/\//g, '_');
  const expected = Number(url.searchParams.get('bytes') || 0);
  const meta = await readJson(bucket, `imports/${id}/meta.json`);
  if (!meta?.parts?.length) return json({ error:'Importación no encontrada' }, 404);
  if (expected && Number(meta.received || 0) !== expected) return json({ error:'Bytes incompletos', received:meta.received, expected }, 409);
  const fakeReq = new Request(request.url, {
    method:'PUT',
    headers:{ 'content-type':'application/json', 'content-length':String(meta.received || expected || 0), 'x-arlab-import':'1' },
    body:concatObjects(bucket, [...meta.parts].sort((a,b)=>a.offset-b.offset).map(x=>x.path))
  });
  const out = await saveState(fakeReq, env, bucket);
  for (const p of meta.parts) await bucket.delete(p.path);
  await bucket.delete(`imports/${id}/meta.json`);
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response('ok', { headers:CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let bucket;
    try { bucket = storage(env); }
    catch (error) { return json({ ok:false, error:error.message, storage:'backblaze-b2' }, 503); }
    try {
      if (path === '/health') {
        const state = await bucket.head('state/current.json');
        return json({ ok:true, service:'arlab-free-backend', compute:'cloudflare-workers-free', storage:'backblaze-b2', stateBytes:Number(state?.size || 0), retention:'current+last-good+previous-1+previous-2' });
      }
      if ((path === '/api/state' || path === '/__state') && (request.method === 'GET' || request.method === 'HEAD')) {
        const obj = await bucket.get('state/current.json');
        if (!obj) return json({ error:'state/current.json no disponible' }, 404);
        const meta = await readJson(bucket, 'state/meta.json') || {};
        const headers = stateHeaders(meta, obj.size);
        if (request.method === 'HEAD') return new Response(null, { status:200, headers });
        return new Response(obj.body, { status:200, headers });
      }
      if (path === '/api/state' && (request.method === 'PUT' || request.method === 'POST')) {
        if (!writeAllowed(request, env)) return json({ error:'No autorizado' }, 401);
        return saveState(request, env, bucket);
      }
      if (path === '/api/state/meta' && request.method === 'GET') {
        const head = await bucket.head('state/current.json');
        return json({ exists:!!head, ...(await readJson(bucket,'state/meta.json') || {}), protection:await readJson(bucket,'state/protection.json'), storage:'backblaze-b2' });
      }
      if (path === '/api/gps/manifest' && request.method === 'GET') {
        const obj = await bucket.get('gps/manifest.json');
        if (!obj) return json({ version:1, gpsState:{gpsRawLogs:[],gpsCutSessions:[]}, rawFiles:[] });
        return new Response(obj.body, { status:200, headers:{...CORS,'Content-Type':'application/json; charset=utf-8'} });
      }
      if (path === '/api/gps/manifest' && request.method === 'PUT') {
        if (!writeAllowed(request, env)) return json({ error:'No autorizado' }, 401);
        await bucket.put('gps/manifest.json', request.body, { httpMetadata:{contentType:'application/json'} });
        return json({ ok:true, saved:true });
      }
      const gpsMatch = path.match(/^\/api\/gps\/raw\/(.+)$/);
      if (gpsMatch) {
        const id = safe(decodeURIComponent(gpsMatch[1])).replace(/\//g, '_');
        const key = `gps/raw/${id}.bin`;
        if (request.method === 'GET' || request.method === 'HEAD') {
          const obj = await bucket.get(key);
          if (!obj) return json({ error:'not found' }, 404);
          const headers={...CORS,'Content-Type':'application/octet-stream','Content-Length':String(obj.size),'X-ARLAB-Storage':'backblaze-b2'};
          return new Response(request.method === 'HEAD' ? null : obj.body, { status:200, headers });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          if (!writeAllowed(request, env)) return json({ error:'No autorizado' }, 401);
          await bucket.put(key, request.body, { httpMetadata:{contentType:'application/octet-stream'} });
          const h = await bucket.head(key);
          return json({ ok:true, id, size:Number(h?.size || 0) });
        }
      }
      const chunkMatch = path.match(/^\/api\/media\/chunk\/(.+)$/);
      if (chunkMatch) {
        if (!writeAllowed(request, env)) return json({ error:'No autorizado' }, 401);
        const id=safe(decodeURIComponent(chunkMatch[1])).replace(/\//g,'_'), metaKey=`imports/${id}/meta.json`;
        if (request.method === 'DELETE') {
          const meta=await readJson(bucket,metaKey);
          for (const p of meta?.parts || []) await bucket.delete(p.path);
          await bucket.delete(metaKey);
          return json({ok:true});
        }
        if (request.method === 'PUT') {
          const offset=Math.max(0,Number(url.searchParams.get('offset')||0));
          const meta=await readJson(bucket,metaKey)||{received:0,parts:[]};
          if(offset!==Number(meta.received||0))return json({error:'Offset no esperado',expectedOffset:Number(meta.received||0)},409);
          const key=`imports/${id}/parts/${String(offset).padStart(12,'0')}.bin`;
          await bucket.put(key,request.body,{httpMetadata:{contentType:'application/octet-stream'}});
          const h=await bucket.head(key), size=Number(h?.size||0);
          meta.parts.push({path:key,offset,size}); meta.received=offset+size; meta.updatedAt=new Date().toISOString();
          await bucket.put(metaKey,JSON.stringify(meta),{httpMetadata:{contentType:'application/json'}});
          return json({received:meta.received});
        }
      }
      if (path === '/api/state/import-uploaded-media' && request.method === 'POST') {
        if (!writeAllowed(request, env)) return json({ error:'No autorizado' }, 401);
        return importChunks(request, env, url, bucket);
      }
      if (path === '/__meta') return json({ok:true,service:'arlab-free-backend',storage:'backblaze-b2',state:await readJson(bucket,'state/meta.json')||{}});
      return json({error:'not found',path},404);
    } catch (error) {
      return json({error:error instanceof Error?error.message:String(error),storage:'backblaze-b2'},500);
    }
  }
};
