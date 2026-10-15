import { zValidator } from '@hono/zod-validator'
import { readConfig } from '@server/config'
import { issueTorrentResourceRef } from '@server/security/download-resource-ref'
import { searchIndexers } from '@server/usecases/indexers'
import { IndexerNotConfiguredError, IndexerSearchError } from '@server/usecases/ports'
import { ResourceConflictError, ResourceNotFoundError } from '@server/usecases/resource-errors'
import { getMediaKeyLibraryKind } from '@shared/media-key'
import { analyzeIndexerRelease, getReleaseAvailabilityTier } from '@shared/release-analysis'
import type { DownloadSearchTarget, IndexerSearchItem, Torrent, TorrentFull } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { problem, setPageLinks } from './protocol'

const torrentQuerySchema = z.object({
  mediaKey: z.string().trim().min(1).max(300).optional(),
  q: z.string().trim().min(1).max(300),
  target: z.enum(['music', 'ebook', 'audiobook']).optional(),
  view: z.enum(['compact', 'full']).default('compact'),
})
const indexerSearchQuerySchema = torrentQuerySchema
  .extend({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(50),
    snapshotId: z.string().uuid().optional(),
  })
  .strict()
const referenceQuerySchema = torrentQuerySchema.pick({ mediaKey: true, target: true }).strict()
const torrentParamsSchema = z.object({
  id: z.string().regex(/^torrent:[0-9a-f]{64}$/),
})
const torrentSnapshotLifetimeMs = 60 * 60 * 1000

export function registerTorrentRoutes(routes: Hono<AppEnv>) {
  routes.get('/torrents', zValidator('query', indexerSearchQuerySchema), async (c) => {
    const { page, pageSize, snapshotId, ...input } = c.req.valid('query')
    if (page > 1 && !snapshotId)
      return problem(c, 422, 'validation-error', 'Use the snapshotId returned by the first page')
    if (!validAssociation(input.mediaKey, input.target)) {
      return problem(c, 422, 'validation-error', 'The media association and requested target must be compatible')
    }
    try {
      const result = await torrents(c, input, snapshotId)
      c.header('Cache-Control', 'private, no-store')
      const candidates = result.items
      const start = (page - 1) * pageSize
      setPageLinks(c, { page, pageSize }, candidates.length, { snapshotId: result.snapshotId })
      return c.json({
        items: candidates.slice(start, start + pageSize),
        pagination: {
          page,
          pageSize,
          totalItems: candidates.length,
          totalPages: Math.ceil(candidates.length / pageSize),
          snapshotId: result.snapshotId,
          expiresAt: result.expiresAt,
        },
      })
    } catch (error) {
      return indexerSearchError(error)
    }
  })

  routes.get(
    '/torrents/:id',
    zValidator('param', torrentParamsSchema),
    zValidator('query', referenceQuerySchema),
    async (c) => {
      const association = c.req.valid('query')
      if (!validAssociation(association.mediaKey, association.target))
        return problem(c, 422, 'validation-error', 'The media association and requested target must be compatible')
      const snapshot = await c
        .get('deps')
        .torrentSnapshotsRepo.get(c.get('principal').userId, c.req.valid('param').id, new Date().toISOString())
      if (!snapshot) return c.json({ code: 'TORRENT_NOT_FOUND', error: 'Torrent not found.' }, 404)
      c.header('Cache-Control', 'private, no-store')
      return c.json(
        await serializeTorrent(
          requiredResourceRefSecret(readConfig(c.env).downloadResourceRefSecret),
          c.get('principal').userId,
          association.mediaKey ?? '',
          snapshot.item,
          association.target,
          'compact',
          {
            includeResourceRef: true,
            selfHref: (torrentId) => torrentHref(c, torrentId),
            expiresAt: snapshot.expiresAt,
          },
        ),
      )
    },
  )
}

async function torrents(c: Context<AppEnv>, input: z.infer<typeof torrentQuerySchema>, snapshotId?: string) {
  const userId = c.get('principal').userId
  const now = new Date()
  const querySignature = JSON.stringify({ q: input.q, target: input.target })
  const snapshot = snapshotId
    ? await c.get('deps').torrentSnapshotsRepo.getQuery(userId, snapshotId, now.toISOString())
    : null
  if (snapshotId && !snapshot) throw new ResourceNotFoundError('Torrent query snapshot not found or expired')
  if (snapshot && snapshot.querySignature !== querySignature)
    throw new ResourceConflictError('The snapshot belongs to a different query')
  const targets = {
    music: { searchType: 'audiosearch' as const, categories: [3000, 3040] },
    ebook: { searchType: 'booksearch' as const, categories: [7000, 7020] },
    audiobook: { searchType: 'audiosearch' as const, categories: [3030] },
  }
  const search = input.target ? targets[input.target] : { searchType: 'search' as const, categories: undefined }
  let results = snapshot?.items ?? (await searchIndexers(c.get('deps'), { query: input.q, ...search }))
  if (!snapshot && input.target && results.length === 0) {
    results = await searchIndexers(c.get('deps'), { query: input.q, searchType: search.searchType })
  }
  const configured = readConfig(c.env)
  const secret = requiredResourceRefSecret(configured.downloadResourceRefSecret)
  const principal = c.get('principal')
  const expiresAt = snapshot?.expiresAt ?? new Date(now.getTime() + torrentSnapshotLifetimeMs).toISOString()
  const downloadable = results.filter(
    (item) =>
      (item.protocol === null || item.protocol.toLowerCase() === 'torrent') && (item.magnetUrl || item.downloadUrl),
  )
  const candidates = await Promise.all(
    downloadable.map((item) =>
      serializeTorrent(secret, principal.userId, input.mediaKey ?? '', item, input.target, input.view, {
        includeResourceRef: false,
        expiresAt,
        selfHref: (torrentId) => torrentHref(c, torrentId),
      }),
    ),
  )
  const createdAt = now.toISOString()
  if (!snapshot)
    await c.get('deps').torrentSnapshotsRepo.saveMany(
      candidates.map((candidate, index) => ({
        id: candidate.id,
        userId: principal.userId,
        mediaKey: '',
        item: { ...downloadable[index], downloadTarget: null },
        createdAt,
        expiresAt,
      })),
    )
  const id = snapshot?.id ?? crypto.randomUUID()
  if (!snapshot)
    await c.get('deps').torrentSnapshotsRepo.saveQuery({ id, userId, querySignature, items: downloadable, expiresAt })
  return { items: candidates, snapshotId: id, expiresAt }
}

function torrentHref(c: Context<AppEnv>, torrentId: string): string {
  return new URL(`/api/torrents/${encodeURIComponent(torrentId)}`, c.req.url).toString()
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

export async function serializeTorrent(
  secret: string,
  userId: string,
  mediaKey: string,
  item: IndexerSearchItem,
  target: DownloadSearchTarget | undefined,
  view: 'compact' | 'full',
  options: { includeResourceRef?: boolean; selfHref?: (torrentId: string) => string; expiresAt?: string } = {},
): Promise<Torrent | TorrentFull> {
  const normalized = target ? { ...item, downloadTarget: target } : item
  const issued = await issueTorrentResourceRef(secret, userId, mediaKey, normalized)
  const analysis = analyzeIndexerRelease(item)
  const resourceRef = options.includeResourceRef
    ? { resourceRef: issued.resourceRef, resourceRefExpiresAt: issued.resourceRefExpiresAt }
    : {}
  const compact: Torrent = {
    id: issued.torrentId,
    ...(mediaKey ? { mediaKey } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
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
    links: { self: options.selfHref?.(issued.torrentId) ?? `/api/torrents/${issued.torrentId}` },
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

function validAssociation(mediaKey: string | undefined, target: DownloadSearchTarget | undefined) {
  if (!mediaKey) return true
  const kind = getMediaKeyLibraryKind(mediaKey)
  if (kind === 'book') return target === 'ebook' || target === 'audiobook'
  if (kind === 'music') return target === 'music'
  return (kind === 'movie' || kind === 'tv') && target === undefined
}
