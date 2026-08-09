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
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, problem, requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const indexerSearchQuerySchema = z.object({
  mediaKey: z.string().trim().min(1).max(300),
  query: z.string().trim().min(1).max(300),
  searchType: z.enum(['search', 'audiosearch', 'booksearch']).optional(),
  categories: z.string().trim().optional(),
  target: z.enum(['music', 'ebook', 'audiobook']).optional(),
  view: z.enum(['compact', 'full']).default('compact'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
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
    const { mediaKey, query, searchType, categories, target, view, page, pageSize } = c.req.valid('query')
    try {
      const deps = c.get('deps')
      const results = await searchIndexers(deps, {
        query,
        searchType,
        categories: parseNumberList(categories),
      })
      const configured = readConfig(c.env)
      const principal = c.get('principal')
      const downloadable = results.filter((item) => item.magnetUrl || item.downloadUrl)
      const withRefs = await Promise.all(
        downloadable.map((item) =>
          serializeReleaseCandidate(
            requiredResourceRefSecret(configured.downloadResourceRefSecret),
            principal.userId,
            mediaKey,
            item,
            target,
            view,
          ),
        ),
      )
      const start = (page - 1) * pageSize
      return c.json({
        items: withRefs.slice(start, start + pageSize),
        pagination: {
          page,
          pageSize,
          totalItems: withRefs.length,
          totalPages: Math.ceil(withRefs.length / pageSize),
        },
      })
    } catch (error) {
      if (error instanceof IndexerNotConfiguredError) {
        return c.json({ code: 'INDEXER_NOT_CONFIGURED', error: error.message }, 503)
      }
      if (error instanceof IndexerSearchError) {
        return c.json({ code: 'INDEXER_SEARCH_FAILED', error: error.message }, 502)
      }
      throw error
    }
  })

  routes.get('/indexers', async (c) => {
    const items = await listIndexers(c.get('deps'))
    return c.json({ items })
  })

  routes.get('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getIndexer(c.get('deps'), id)
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    c.header('ETag', entityTag(item.updatedAt))
    return c.json({ item })
  })

  routes.post('/indexers', zValidator('json', indexerSchema), async (c) => {
    const item = await createIndexer(c.get('deps'), c.req.valid('json'))
    c.header('Location', `/api/indexers/${item.id}`)
    c.header('ETag', entityTag(item.updatedAt))
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
      const expectedUpdatedAt = ifMatchRevision(c)
      if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
      const item = await updateIndexer(c.get('deps'), id, c.req.valid('json'), expectedUpdatedAt)
      if (!item) return c.json({ error: 'Indexer not found.' }, 404)
      c.header('ETag', entityTag(item.updatedAt))
      return c.json({ item })
    },
  )

  routes.delete('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const expectedUpdatedAt = ifMatchRevision(c)
    if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
    const deleted = await deleteIndexer(c.get('deps'), id, expectedUpdatedAt)
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

export async function serializeReleaseCandidate(
  secret: string,
  userId: string,
  mediaKey: string,
  item: IndexerSearchItem,
  target: DownloadSearchTarget | undefined,
  view: 'compact' | 'full',
): Promise<ReleaseCandidate | ReleaseCandidateFull> {
  const normalized = target ? { ...item, downloadTarget: target } : item
  const issued = await issueReleaseResourceRef(secret, userId, mediaKey, normalized)
  const analysis = analyzeIndexerRelease(item)
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
    resourceRef: issued.resourceRef,
    resourceRefExpiresAt: issued.resourceRefExpiresAt,
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
