import { zValidator } from '@hono/zod-validator'
import { readConfig } from '@server/config'
import { issueReleaseResourceRef } from '@server/security/download-resource-ref'
import {
  checkIndexerHealth,
  createIndexer,
  deleteIndexer,
  getIndexer,
  getIndexerHealth,
  listIndexers,
  searchIndexers,
  updateIndexer,
} from '@server/usecases/indexers'
import { IndexerNotConfiguredError, IndexerSearchError } from '@server/usecases/ports'
import { analyzeIndexerRelease, getReleaseAvailabilityTier } from '@shared/release-analysis'
import type { DownloadSearchTarget, IndexerSearchItem, ReleaseCandidate, ReleaseCandidateFull } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const releaseCandidateQuerySchema = z.object({
  mediaKey: z.string().trim().min(1).max(300),
  query: z.string().trim().min(1).max(300),
  searchType: z.enum(['search', 'audiosearch', 'booksearch']).optional(),
  categories: z.string().trim().optional(),
  target: z.enum(['music', 'ebook', 'audiobook']).optional(),
  view: z.enum(['compact', 'full']).default('compact'),
})
const indexerSearchQuerySchema = releaseCandidateQuerySchema.extend({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
})
const releaseCandidateParamsSchema = z.object({
  id: z.string().regex(/^release-candidate:[0-9a-f]{64}$/),
})

const indexerSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['prowlarr']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})
const indexerPatchSchema = indexerSchema.partial().refine((value) => Object.keys(value).length > 0)
export function registerIndexerRoutes(routes: Hono<AppEnv>) {
  routes.get('/release-candidates', zValidator('query', indexerSearchQuerySchema), async (c) => {
    const { page, pageSize, ...input } = c.req.valid('query')
    try {
      const candidates = await releaseCandidates(c, input, { includeResourceRef: false })
      const start = (page - 1) * pageSize
      return c.json({
        items: candidates.slice(start, start + pageSize),
        pagination: {
          page,
          pageSize,
          totalItems: candidates.length,
          totalPages: Math.ceil(candidates.length / pageSize),
        },
      })
    } catch (error) {
      return indexerSearchError(error)
    }
  })

  routes.get(
    '/release-candidates/:id',
    zValidator('param', releaseCandidateParamsSchema),
    zValidator('query', releaseCandidateQuerySchema),
    async (c) => {
      try {
        const candidates = await releaseCandidates(c, c.req.valid('query'), { includeResourceRef: true })
        const item = candidates.find((candidate) => candidate.id === c.req.valid('param').id)
        if (!item) return c.json({ code: 'RELEASE_CANDIDATE_NOT_FOUND', error: 'Release candidate not found.' }, 404)
        return c.json(item)
      } catch (error) {
        return indexerSearchError(error)
      }
    },
  )

  routes.get('/indexers', async (c) => {
    const items = await listIndexers(c.get('deps'))
    return c.json({ items })
  })

  routes.get('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getIndexer(c.get('deps'), id)
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ item })
  })

  routes.post('/indexers', zValidator('json', indexerSchema), async (c) => {
    const item = await createIndexer(c.get('deps'), c.req.valid('json'))
    c.header('Location', `/api/indexers/${item.id}`)
    return c.json({ item }, 201)
  })

  routes.patch(
    '/indexers/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', indexerPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const { id } = c.req.valid('param')
      const item = await updateIndexer(c.get('deps'), id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Indexer not found.' }, 404)
      return c.json({ item })
    },
  )

  routes.delete('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteIndexer(c.get('deps'), id)
    if (!deleted) return c.json({ error: 'Indexer not found.' }, 404)
    return c.body(null, 204)
  })

  routes.post('/indexers/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkIndexerHealth(c.get('deps'), id)
    if (!health) return c.json({ error: 'Indexer not found.' }, 404)
    c.header('Location', `/api/indexers/${id}/health-observations/${encodeURIComponent(health.checkedAt as string)}`)
    return c.json({ item: health }, 201)
  })

  routes.get('/indexers/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const health = await getIndexerHealth(c.get('deps'), c.req.valid('param').id)
    if (!health) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ items: health.checkedAt ? [health] : [] })
  })

  routes.get('/indexers/:id/health-observations/:checkedAt', zValidator('param', idParamsSchema), async (c) => {
    const health = await getIndexerHealth(c.get('deps'), c.req.param('id'))
    if (!health || health.checkedAt !== c.req.param('checkedAt'))
      return c.json({ error: 'Health observation not found.' }, 404)
    return c.json({ item: health })
  })
}

async function releaseCandidates(
  c: Context<AppEnv>,
  input: z.infer<typeof releaseCandidateQuerySchema>,
  options: { includeResourceRef: boolean },
): Promise<Array<ReleaseCandidate | ReleaseCandidateFull>> {
  const results = await searchIndexers(c.get('deps'), {
    query: input.query,
    searchType: input.searchType,
    categories: parseNumberList(input.categories),
  })
  const configured = readConfig(c.env)
  const secret = requiredResourceRefSecret(configured.downloadResourceRefSecret)
  const principal = c.get('principal')
  const downloadable = results.filter((item) => item.magnetUrl || item.downloadUrl)
  return Promise.all(
    downloadable.map((item) =>
      serializeReleaseCandidate(secret, principal.userId, input.mediaKey, item, input.target, input.view, {
        includeResourceRef: options.includeResourceRef,
        selfHref: (candidateId) => releaseCandidateHref(c, input, candidateId),
      }),
    ),
  )
}

function releaseCandidateHref(
  c: Context<AppEnv>,
  input: z.infer<typeof releaseCandidateQuerySchema>,
  candidateId: string,
): string {
  const url = new URL(`/api/release-candidates/${encodeURIComponent(candidateId)}`, c.req.url)
  url.searchParams.set('mediaKey', input.mediaKey)
  url.searchParams.set('query', input.query)
  if (input.searchType) url.searchParams.set('searchType', input.searchType)
  if (input.categories) url.searchParams.set('categories', input.categories)
  if (input.target) url.searchParams.set('target', input.target)
  return url.toString()
}

function indexerSearchError(error: unknown): Response {
  if (error instanceof IndexerNotConfiguredError) {
    return Response.json({ code: 'INDEXER_NOT_CONFIGURED', error: error.message }, { status: 503 })
  }
  if (error instanceof IndexerSearchError) {
    return Response.json({ code: 'INDEXER_SEARCH_FAILED', error: error.message }, { status: 502 })
  }
  throw error
}

export async function serializeReleaseCandidate(
  secret: string,
  userId: string,
  mediaKey: string,
  item: IndexerSearchItem,
  target: DownloadSearchTarget | undefined,
  view: 'compact' | 'full',
  options: { includeResourceRef?: boolean; selfHref?: (candidateId: string) => string } = {},
): Promise<ReleaseCandidate | ReleaseCandidateFull> {
  const normalized = target ? { ...item, downloadTarget: target } : item
  const issued = await issueReleaseResourceRef(secret, userId, mediaKey, normalized)
  const analysis = analyzeIndexerRelease(item)
  const resourceRef = options.includeResourceRef
    ? { resourceRef: issued.resourceRef, resourceRefExpiresAt: issued.resourceRefExpiresAt }
    : {}
  const compact: ReleaseCandidate = {
    id: issued.candidateId,
    title: item.title,
    size: item.size,
    publishDate: item.publishDate,
    quality: {
      resolution: analysis.resolution.id,
      source: analysis.source.id,
      codec: analysis.codec,
      hdr: analysis.hdr,
      audio: analysis.audio,
      tier: analysis.source.tier,
      warnings: analysis.warnings,
    },
    availability: { tier: getReleaseAvailabilityTier(item.seeders) },
    links: { self: options.selfHref?.(issued.candidateId) ?? `/api/release-candidates/${issued.candidateId}` },
    ...resourceRef,
  }
  if (view === 'compact') return compact

  return {
    ...compact,
    indexer: item.indexer,
    downloadTarget: normalized.downloadTarget,
    fileName: item.fileName,
    seeders: item.seeders,
    leechers: item.leechers,
    files: item.files,
    sourceType: issued.sourceType,
    infoUrl: item.infoUrl,
    categories: item.categories,
    categoryIds: item.categoryIds,
    indexerFlags: item.indexerFlags,
    imdbId: item.imdbId,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
  }
}

function requiredResourceRefSecret(value: string | undefined): string {
  if (!value) throw new Error('DOWNLOAD_RESOURCE_REF_SECRET is required.')
  return value
}

function parseNumberList(value: string | undefined): number[] {
  if (!value) return []
  return value
    .split(/[|,]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}
