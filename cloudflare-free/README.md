# ARLAB · migración gratuita a Cloudflare

Objetivo: sacar ARLAB del Supabase Free saturado sin pagar un servidor mensual.

## Arquitectura

- Frontend: mantener temporalmente Vercel (`arlab-app.vercel.app`) mientras se copia la versión web actual.
- Backend: Cloudflare Workers Free.
- Estado, GPS y archivos: Cloudflare R2 Standard.
- Base de datos pequeña del portal: Cloudflare D1 en una segunda fase.

El backend incluido mantiene las rutas que ARLAB ya usa:

- `GET/PUT/POST /api/state`
- `GET /api/state/meta`
- `GET/PUT /api/gps/manifest`
- `GET/PUT/POST /api/gps/raw/:id`
- `PUT/DELETE /api/media/chunk/:id`
- `POST /api/state/import-uploaded-media`
- `GET /health`

## Retención

No se crean autosaves ilimitados. Solo se conservan:

- `state/current.json`
- `state/last-good.json`
- `state/previous-1.json`
- `state/previous-2.json`

Esto evita repetir el problema que llenó Supabase con miles de copias completas del estado.

## Despliegue gratuito

1. Crear una cuenta Cloudflare Free.
2. Crear un bucket R2 Standard llamado `arlab-data`.
3. Desde esta carpeta ejecutar `npm install` y `npx wrangler deploy`, o conectar el repositorio a Cloudflare.
4. El Worker usará el binding `ARLAB_DATA` definido en `wrangler.jsonc`.
5. Probar `/health`.
6. Importar el JSON actual de ARLAB mediante `PUT /api/state` con cabecera `X-ARLAB-Import: 1`, o mediante el importador por chunks existente.
7. Cambiar el origen API de ARLAB/Vercel al dominio del Worker.

## Datos que NO deben migrarse

No copiar `state/autosave-backups/**`. En el proyecto Supabase actual esas copias ocupan aproximadamente 85 GB y son la causa principal del exceso de Storage.

Sí migrar cuando Supabase vuelva a permitir lectura:

- `state/current.json`
- `state/last-good.json`
- `state/previous-1.json`
- `state/previous-2.json`
- `gps/**`
- la versión web actual necesaria para independizar el frontend

## Nota de seguridad

El Worker permite CORS para facilitar el corte desde Vercel. Antes de abrirlo a producción multiusuario se añadirá autenticación a las rutas de escritura. Las lecturas del estado también pueden protegerse si ARLAB deja de ser de acceso privado/controlado.
