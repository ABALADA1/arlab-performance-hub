# ARLAB → Nhost

Esta rama prepara Nhost como sustituto de Supabase para ARLAB.

## Arquitectura de corte

- Frontend: Vercel (`arlab-app.vercel.app`).
- Backend: Nhost (Postgres + Hasura GraphQL + Auth + Storage + Functions).
- Estado ARLAB: retención fija `current`, `last-good`, `previous-1`, `previous-2`.
- GPS y archivos pesados: Nhost Storage, buckets `arlab-gps` y `arlab-data`.
- No se migran los `autosave-backups/**` antiguos que llenaron Supabase.

## Conectar el proyecto Nhost a este repositorio

En el proyecto Nhost:

1. `Settings` → `Deployments` → `Connect to GitHub`.
2. Autorizar el repositorio `ABALADA1/arlab-performance-hub`.
3. Base directory: `/`.
4. Deployment branch: `nhost-migration`.
5. Mantener despliegue automático durante la migración.

Al desplegar esta rama Nhost aplicará la migración de `nhost/migrations/default/` y desplegará `functions/nhost-health.ts`.

## Verificación

Tras el primer deploy, comprobar:

- `https://<subdomain>.functions.<region>.nhost.run/v1/nhost-health`
- tablas `public.arlab_state_snapshots` y `public.arlab_gps_manifest`
- buckets `arlab-data` y `arlab-gps`

No hacer el corte de Vercel hasta importar el estado actual y verificar lectura/escritura.
