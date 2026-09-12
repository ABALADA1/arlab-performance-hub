# ARLAB · Railway migration

Objetivo: sacar el backend pesado de Supabase Free y mantener Vercel como frontend/dominio.

## Arquitectura objetivo

- Vercel: frontend `arlab-app.vercel.app`.
- Railway service: API compatible con las rutas ARLAB actuales.
- Railway Storage Bucket: `state/`, `gps/` y `app/current/`.
- Retención de estado: `current.json`, `last-good.json`, `previous-1.json`, `previous-2.json`. **No se crean autosave-backups ilimitados.**

Railway Buckets es S3 compatible. Inyectar al servicio estas referencias del bucket:

```env
BUCKET=${{ bucket.BUCKET }}
ACCESS_KEY_ID=${{ bucket.ACCESS_KEY_ID }}
SECRET_ACCESS_KEY=${{ bucket.SECRET_ACCESS_KEY }}
ENDPOINT=${{ bucket.ENDPOINT }}
REGION=${{ bucket.REGION }}
```

También se aceptan las variables equivalentes `AWS_*`.

## Deploy

Crear un servicio desde este repo/rama y usar `railway-backend` como Root Directory. El `Dockerfile` y `railway.json` están incluidos. Health check: `/health`.

## Rutas incluidas

- `GET|HEAD /api/state`
- `POST|PUT /api/state`
- `GET /api/state/meta`
- `GET|PUT /api/gps/manifest`
- `GET|POST|PUT /api/gps/raw/:id`
- `PUT|DELETE /api/media/chunk/:id`
- `POST /api/state/import-uploaded-media`
- `GET /health`
- `GET /__meta`
- fallback de estáticos desde `app/current/`

## Migración desde Supabase

El script `migrate-supabase-to-railway.mjs` copia deliberadamente solo:

- el `state/current.json` actual y sus tres copias de seguridad útiles;
- `state/meta.json` / `state/protection.json` si existen;
- `gps/`;
- el webroot de la versión de producción hacia `app/current/`.

**No copia `state/autosave-backups/` ni `hotfix-backups/`.** En el proyecto actual los autosaves son el origen principal del crecimiento de Storage y no deben trasladarse.

Variables adicionales de migración:

```env
SUPABASE_URL=https://wchzahvvujxxajlmxhqa.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SOURCE_BUCKET=arlab-v779-package
ARLAB_CURRENT_VERSION=1788187613856_502a2e1e49994de4
ARLAB_WEBROOT=ARLAB.ValdHub/wwwroot
```

Después:

```bash
npm install
npm run migrate:supabase
```

La migración necesita que Supabase permita temporalmente leer Storage o que se facilite una copia local equivalente. Mientras el proyecto devuelva HTTP 402 por cuotas, el script no podrá descargar los objetos de origen.

## Corte a producción

Cuando el Railway service tenga dominio público y los objetos estén copiados, cambiar el bridge/proxy de Vercel para que `/api/*` y los estáticos apunten al Railway service. Verificar primero `/health`, `/api/state`, Macro, GPS y portal de jugador; luego dejar Supabase fuera del tráfico principal.
