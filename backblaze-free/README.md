# ARLAB · Backblaze B2 gratis

Arquitectura de migración sin R2 ni Railway:

- Frontend: `arlab-app.vercel.app`.
- Backend/API: Cloudflare Workers Free.
- Archivos/estado/GPS: Backblaze B2 (bucket privado).
- Retención del estado: solo `current`, `last-good`, `previous-1`, `previous-2`.

No se migran `state/autosave-backups/**`; en el Supabase anterior llegaron a ocupar aproximadamente 85 GB por guardar copias completas repetidas.

## Backblaze

1. En B2 Cloud Storage crea un bucket privado llamado `arlab-data`.
2. Crea una Application Key limitada a ese bucket con lectura y escritura.
3. En la página del bucket copia el S3 Endpoint, por ejemplo `https://s3.us-west-004.backblazeb2.com`.
4. La región es la parte intermedia del endpoint, por ejemplo `us-west-004`.

No publiques ni escribas las claves en archivos del repositorio.

## GitHub Actions secrets

En `Settings > Secrets and variables > Actions` del repositorio configura:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `B2_KEY_ID`
- `B2_APPLICATION_KEY`
- `B2_ENDPOINT`
- `B2_BUCKET` = `arlab-data`
- `B2_REGION` (opcional si el endpoint sigue el formato estándar)

El workflow `.github/workflows/backblaze-free-deploy.yml` despliega el Worker `arlab-free-backend` y carga las credenciales B2 como secretos de Cloudflare.

## API compatible con ARLAB

- `GET/HEAD/PUT/POST /api/state`
- `GET /api/state/meta`
- `GET/PUT /api/gps/manifest`
- `GET/HEAD/PUT/POST /api/gps/raw/:id`
- `PUT/DELETE /api/media/chunk/:id`
- `POST /api/state/import-uploaded-media`
- `GET /health`

Los objetos de B2 permanecen privados. El navegador de ARLAB no recibe nunca `B2_APPLICATION_KEY`.

## Corte

No cambiar el origen de producción hasta que:

1. `/health` responda `ok: true` y `storage: backblaze-b2`.
2. `state/current.json` esté importado y su tamaño sea coherente con el último estado válido de ARLAB.
3. El manifest y los RAW GPS necesarios estén copiados.
4. Se prueben lectura y escritura en una URL de preview.

La copia desde Supabase solo podrá completarse cuando el proyecto antiguo permita egress de nuevo o cuando se disponga del JSON actual exportado desde un navegador que aún lo tenga localmente.
