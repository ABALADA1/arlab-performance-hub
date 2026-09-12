const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-ARLAB-Import,X-ARLAB-Revision,X-ARLAB-Import-Token',
  'Access-Control-Expose-Headers': 'Content-Length,X-ARLAB-Revision,X-ARLAB-Import-Token',
  'Cache-Control': 'no-store'
};

const enc = new TextEncoder();
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra }
});

const safe = value => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .split('/')
  .filter(x => x && x !== '.' && x !== '..')
  .join('/');

async function readJson(bucket, key) {
  const o = await bucket.get(key);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch { return null; }
}

async function copyObject(bucket, from, to) {
  const src = await bucket.get(from);
  if (!src) return false;
  await bucket.put(to, src.body, {
    httpMetadata: src.httpMetadata,
    customMetadata: src.customMetadata
  });
  return true;
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
    'X-ARLAB-Import-Token': String(meta.importToken || '')
  };
}

async function saveState(request, env) {
  const bucket = env.ARLAB_DATA;
  const maxBytes = Number(env.ARLAB_MAX_STATE_BYTES || 100000000);
  const minBytes = Number(env.ARLAB_MIN_STATE_BYTES || 2000000);
  const contentLength = Number(request.headers.get('content-length') || 0);
  const isImport = request.headers.has('x-arlab-import');
  const oldMeta = await readJson(bucket, 'state/meta.json') || {};

  if (contentLength > maxBytes) {
    return json({ error: `La BBDD supera el límite de ${maxBytes} bytes` }, 413);
  }
  if (!isImport && Number(oldMeta.bytes || 0) >= 5000000 && contentLength && contentLength < Math.max(minBytes, Number(oldMeta.bytes || 0) * 0.20)) {
    return json({
      error: 'Protección BBDD: guardado parcial rechazado',
      guard: 'cloudflare-r2-v1',
      incomingBytes: contentLength,
      previousBytes: Number(oldMeta.bytes || 0)
    }, 409);
  }
  if (!request.body) return json({ error: 'BBDD vacía' }, 400);

  await rotateState(bucket);

  const revisionHeader = Number(request.headers.get('x-arlab-revision') || 0);
  const revision = revisionHeader || Number(oldMeta.revision || 0) + 1;
  const importToken = request.headers.get('x-arlab-import-token') || oldMeta.importToken || '';
  const savedAt = new Date().toISOString();

  await bucket.put('state/current.json', request.body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { revision: String(revision), savedAt }
  });

  const head = await bucket.head('state/current.json');
  const bytes = Number(head?.size || contentLength || 0);
  const meta = { exists: true, revision, bytes, importToken, updatedAt: savedAt, savedAt, import: isImport };
  await bucket.put('state/meta.json', JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });

  if (isImport) {
    const floor = bytes >= 5000000 ? Math.max(minBytes, Math.floor(bytes * 0.20)) : 0;
    await bucket.put('state/protection.json', JSON.stringify({ referenceBytes: bytes, minBytes: floor, updatedAt: savedAt }), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  return json({ saved: true, revision, bytes, import: isImport, guard: 'cloudflare-r2-v1' });
}

function concatObjects(bucket, keys) {
  let index = 0;
  let reader = null;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (reader) {
          const { value, done } = await reader.read();
          if (!done) {
            controller.enqueue(value);
            return;
          }
          reader = null;
          index++;
        }
        if (index >= keys.length) {
          controller.close();
          return;
        }
        const obj = await bucket.get(keys[index]);
        if (!obj) {
          controller.error(new Error(`Falta fragmento ${keys[index]}`));
          return;
        }
        reader = obj.body.getReader();
      }
    },
    async cancel() {
      try { await reader?.cancel(); } catch {}
    }
  });
}

async function importChunks(request, env, url) {
  const bucket = env.ARLAB_DATA;
  const id = safe(url.searchParams.get('id') || '').replace(/\//g, '_');
  const expected = Number(url.searchParams.get('bytes') || 0);
  const meta = await readJson(bucket, `imports/${id}/meta.json`);
  if (!meta?.parts?.length) return json({ error: 'Importación no encontrada' }, 404);
  if (expected && Number(meta.received || 0) !== expected) return json({ error: 'Bytes incompletos', received: meta.received, expected }, 409);

  const fakeReq = new Request(request.url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'content-length': String(meta.received || expected || 0),
      'x-arlab-import': '1'
    },
    body: concatObjects(bucket, [...meta.parts].sort((a,b) => a.offset - b.offset).map(x => x.path)),
    duplex: 'half'
  });
  const out = await saveState(fakeReq, env);
  for (const p of meta.parts) await bucket.delete(p.path);
  await bucket.delete(`imports/${id}/meta.json`);
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const bucket = env.ARLAB_DATA;

    try {
      if (path === '/health') {
        const state = await bucket.head('state/current.json');
        return json({
          ok: true,
          service: 'arlab-free-backend',
          storage: 'cloudflare-r2',
          stateBytes: Number(state?.size || 0),
          retention: 'current+last-good+previous-1+previous-2'
        });
      }

      if ((path === '/api/state' || path === '/__state') && (request.method === 'GET' || request.method === 'HEAD')) {
        const obj = await bucket.get('state/current.json');
        if (!obj) return json({ error: 'state/current.json no disponible' }, 404);
        const meta = await readJson(bucket, 'state/meta.json') || {};
        const headers = stateHeaders(meta, obj.size);
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
        return new Response(obj.body, { status: 200, headers });
      }

      if (path === '/api/state' && (request.method === 'PUT' || request.method === 'POST')) {
        return await saveState(request, env);
      }

      if (path === '/api/state/meta' && request.method === 'GET') {
        const head = await bucket.head('state/current.json');
        const meta = await readJson(bucket, 'state/meta.json') || {};
        const protection = await readJson(bucket, 'state/protection.json');
        return json({ exists: !!head, ...meta, protection });
      }

      if (path === '/api/gps/manifest' && request.method === 'GET') {
        const obj = await bucket.get('gps/manifest.json');
        if (!obj) return json({ version: 1, gpsState: { gpsRawLogs: [], gpsCutSessions: [] }, rawFiles: [] });
        return new Response(obj.body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      if (path === '/api/gps/manifest' && request.method === 'PUT') {
        await bucket.put('gps/manifest.json', request.body, { httpMetadata: { contentType: 'application/json' } });
        return json({ ok: true, saved: true });
      }

      const gpsMatch = path.match(/^\/api\/gps\/raw\/(.+)$/);
      if (gpsMatch) {
        const id = safe(decodeURIComponent(gpsMatch[1])).replace(/\//g, '_');
        const key = `gps/raw/${id}.bin`;
        if (request.method === 'GET' || request.method === 'HEAD') {
          const obj = await bucket.get(key);
          if (!obj) return json({ error: 'not found' }, 404);
          const headers = { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Length': String(obj.size) };
          return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          await bucket.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
          const h = await bucket.head(key);
          return json({ ok: true, id, size: Number(h?.size || 0) });
        }
      }

      const chunkMatch = path.match(/^\/api\/media\/chunk\/(.+)$/);
      if (chunkMatch) {
        const id = safe(decodeURIComponent(chunkMatch[1])).replace(/\//g, '_');
        const metaKey = `imports/${id}/meta.json`;
        if (request.method === 'DELETE') {
          const listed = await bucket.list({ prefix: `imports/${id}/` });
          for (const o of listed.objects) await bucket.delete(o.key);
          return json({ ok: true });
        }
        if (request.method === 'PUT') {
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
          const meta = await readJson(bucket, metaKey) || { received: 0, parts: [] };
          if (offset !== Number(meta.received || 0)) return json({ error: 'Offset no esperado', expectedOffset: Number(meta.received || 0) }, 409);
          const key = `imports/${id}/parts/${String(offset).padStart(12, '0')}.bin`;
          await bucket.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
          const h = await bucket.head(key);
          const size = Number(h?.size || 0);
          meta.parts.push({ path: key, offset, size });
          meta.received = offset + size;
          meta.updatedAt = new Date().toISOString();
          await bucket.put(metaKey, JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
          return json({ received: meta.received });
        }
      }

      if (path === '/api/state/import-uploaded-media' && request.method === 'POST') {
        return await importChunks(request, env, url);
      }

      if (path === '/__meta') {
        return json({ ok: true, service: 'arlab-free-backend', state: await readJson(bucket, 'state/meta.json') || {} });
      }

      return json({ error: 'not found', path }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
};
