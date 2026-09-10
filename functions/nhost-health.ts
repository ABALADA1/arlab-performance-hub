import type { Request, Response } from 'express'

export default async (_req: Request, res: Response) => {
  const graphqlUrl = process.env.NHOST_GRAPHQL_URL || ''
  const storageUrl = process.env.NHOST_STORAGE_URL || ''

  let graphql = false
  try {
    if (graphqlUrl) {
      const r = await fetch(graphqlUrl.replace(/\/v1\/?$/, '') + '/healthz')
      graphql = r.ok
    }
  } catch {}

  res.status(200).json({
    ok: true,
    service: 'arlab-nhost',
    provider: 'nhost',
    subdomain: process.env.NHOST_SUBDOMAIN || null,
    region: process.env.NHOST_REGION || null,
    graphql,
    storageConfigured: Boolean(storageUrl),
    retention: 'current+last-good+previous-1+previous-2'
  })
}
