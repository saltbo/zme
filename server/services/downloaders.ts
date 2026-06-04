import type {
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
} from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Downloader, downloaders } from '../db/schema'

type Db = ReturnType<typeof createDb>

interface QbittorrentCredentials {
  username?: string
  password?: string
}

interface QbittorrentOptions {
  category?: string
  savePath?: string
}

interface TransmissionCredentials {
  username?: string
  password?: string
}

interface TransmissionOptions {
  downloadDir?: string
}

interface Aria2Credentials {
  secret?: string
}

interface Aria2Options {
  dir?: string
}

interface ZpanCredentials {
  apiKey?: string
}

interface ZpanOptions {
  targetFolder?: string
}

export async function listDownloaders(db: Db): Promise<DownloaderSummary[]> {
  const rows = await db.select().from(downloaders).orderBy(downloaders.createdAt)
  return rows.map(toSummary)
}

export async function getDownloader(db: Db, id: string): Promise<DownloaderDetails | null> {
  const rows = await db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
  return rows[0] ? toDetails(rows[0]) : null
}

export async function createDownloader(db: Db, input: DownloaderInput): Promise<DownloaderSummary> {
  const now = new Date().toISOString()
  const row: Downloader = {
    id: crypto.randomUUID(),
    description: input.description || null,
    kind: input.kind,
    endpoint: input.endpoint,
    credentialsJson: JSON.stringify(input.credentials),
    optionsJson: JSON.stringify(input.options),
    enabled: input.enabled,
    healthStatus: 'unknown',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(downloaders).values(row)
  return toSummary(row)
}

export async function updateDownloader(db: Db, id: string, input: DownloaderInput): Promise<DownloaderSummary | null> {
  const updatedAt = new Date().toISOString()
  const rows = await db
    .update(downloaders)
    .set({
      description: input.description || null,
      kind: input.kind,
      endpoint: input.endpoint,
      credentialsJson: JSON.stringify(input.credentials),
      optionsJson: JSON.stringify(input.options),
      enabled: input.enabled,
      updatedAt,
    })
    .where(eq(downloaders.id, id))
    .returning()

  return rows[0] ? toSummary(rows[0]) : null
}

export async function deleteDownloader(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(downloaders).where(eq(downloaders.id, id)).returning({ id: downloaders.id })
  return rows.length > 0
}

export async function submitDownload(db: Db, input: CreateDownloadInput): Promise<CreateDownloadResult> {
  const rows = await db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.id, input.downloaderId), eq(downloaders.enabled, true)))
    .limit(1)
  const downloader = rows[0]
  if (!downloader) throw new Error('Downloader is not available.')

  if (downloader.kind === 'zpan') {
    await submitToZpan(downloader, input)
  } else if (downloader.kind === 'qbittorrent') {
    await submitToQbittorrent(downloader, input)
  } else if (downloader.kind === 'transmission') {
    await submitToTransmission(downloader, input)
  } else {
    await submitToAria2(downloader, input)
  }

  return {
    downloaderId: downloader.id,
    status: 'submitted',
  }
}

export async function checkDownloaderHealth(db: Db, id: string): Promise<DownloaderHealth | null> {
  const rows = await db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
  const downloader = rows[0]
  if (!downloader) return null

  const checkedAt = new Date().toISOString()
  const result = await probeDownloader(downloader)
  const rowsAfterUpdate = await db
    .update(downloaders)
    .set({
      healthStatus: result.status,
      healthMessage: result.message,
      healthCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(eq(downloaders.id, id))
    .returning()

  const updated = rowsAfterUpdate[0]
  if (!updated) return null
  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

function toSummary(row: Downloader): DownloaderSummary {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    endpoint: row.endpoint,
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDetails(row: Downloader): DownloaderDetails {
  return {
    ...toSummary(row),
    credentials: readJson<Record<string, string>>(row.credentialsJson),
    options: readJson<Record<string, string>>(row.optionsJson),
  }
}

async function probeDownloader(downloader: Downloader): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    if (downloader.kind === 'zpan') {
      await probeZpan(downloader)
    } else if (downloader.kind === 'qbittorrent') {
      await probeQbittorrent(downloader)
    } else if (downloader.kind === 'transmission') {
      await probeTransmission(downloader)
    } else {
      await probeAria2(downloader)
    }
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}

async function probeZpan(downloader: Downloader) {
  const response = await fetch(new URL('/api/health', normalizeBaseUrl(downloader.endpoint)))
  await assertOk(response, 'ZPan')
}

async function probeQbittorrent(downloader: Downloader) {
  const credentials = readJson<QbittorrentCredentials>(downloader.credentialsJson)
  await qbittorrentLogin(normalizeBaseUrl(downloader.endpoint), credentials)
}

async function probeTransmission(downloader: Downloader) {
  const credentials = readJson<TransmissionCredentials>(downloader.credentialsJson)
  let response = await transmissionRequest(
    new URL('/transmission/rpc', normalizeBaseUrl(downloader.endpoint)),
    credentials,
    {
      method: 'session-get',
    },
  )
  if (response.status === 409) {
    const session = response.headers.get('x-transmission-session-id')
    if (!session) throw new Error('Transmission did not return a session id.')
    response = await transmissionRequest(
      new URL('/transmission/rpc', normalizeBaseUrl(downloader.endpoint)),
      credentials,
      { method: 'session-get' },
      session,
    )
  }
  await assertOk(response, 'Transmission')
}

async function probeAria2(downloader: Downloader) {
  const credentials = readJson<Aria2Credentials>(downloader.credentialsJson)
  const params: unknown[] = []
  if (credentials.secret) params.push(`token:${credentials.secret}`)
  const response = await fetch(downloader.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'aria2.getVersion',
      params,
    }),
  })
  await assertOk(response, 'aria2')
}

async function submitToZpan(downloader: Downloader, input: CreateDownloadInput) {
  const credentials = readJson<ZpanCredentials>(downloader.credentialsJson)
  const options = readJson<ZpanOptions>(downloader.optionsJson)
  const url = new URL('/api/download-tasks', normalizeBaseUrl(downloader.endpoint))
  const sourceType = input.uri.startsWith('magnet:') ? 'magnet' : 'torrent_url'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {}),
    },
    body: JSON.stringify({
      source: { type: sourceType, uri: input.uri },
      targetFolder: options.targetFolder || '',
      name: input.title,
    }),
  })

  await assertOk(response, 'ZPan')
}

async function submitToQbittorrent(downloader: Downloader, input: CreateDownloadInput) {
  const credentials = readJson<QbittorrentCredentials>(downloader.credentialsJson)
  const options = readJson<QbittorrentOptions>(downloader.optionsJson)
  const baseUrl = normalizeBaseUrl(downloader.endpoint)
  const cookie = await qbittorrentLogin(baseUrl, credentials)
  const form = new FormData()
  form.set('urls', input.uri)
  if (options.category) form.set('category', options.category)
  if (options.savePath) form.set('savepath', options.savePath)

  const response = await fetch(new URL('/api/v2/torrents/add', baseUrl), {
    method: 'POST',
    headers: { cookie },
    body: form,
  })

  await assertOk(response, 'qBittorrent')
}

async function qbittorrentLogin(baseUrl: string, credentials: QbittorrentCredentials) {
  const form = new URLSearchParams()
  form.set('username', credentials.username || '')
  form.set('password', credentials.password || '')
  const response = await fetch(new URL('/api/v2/auth/login', baseUrl), {
    method: 'POST',
    body: form,
  })

  await assertOk(response, 'qBittorrent')
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('qBittorrent did not return a session cookie.')
  return cookie
}

async function submitToTransmission(downloader: Downloader, input: CreateDownloadInput) {
  const credentials = readJson<TransmissionCredentials>(downloader.credentialsJson)
  const options = readJson<TransmissionOptions>(downloader.optionsJson)
  const endpoint = new URL('/transmission/rpc', normalizeBaseUrl(downloader.endpoint))
  const body = {
    method: 'torrent-add',
    arguments: {
      filename: input.uri,
      ...(options.downloadDir ? { 'download-dir': options.downloadDir } : {}),
    },
  }

  let response = await transmissionRequest(endpoint, credentials, body)
  if (response.status === 409) {
    const session = response.headers.get('x-transmission-session-id')
    if (!session) throw new Error('Transmission did not return a session id.')
    response = await transmissionRequest(endpoint, credentials, body, session)
  }

  await assertOk(response, 'Transmission')
  const payload = (await response.json()) as { result?: string }
  if (payload.result && payload.result !== 'success') {
    throw new Error(`Transmission rejected download: ${payload.result}`)
  }
}

function transmissionRequest(endpoint: URL, credentials: TransmissionCredentials, body: unknown, session?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (session) headers.set('x-transmission-session-id', session)
  const authorization = basicAuthHeader(credentials.username, credentials.password)
  if (authorization) headers.set('authorization', authorization)

  return fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function submitToAria2(downloader: Downloader, input: CreateDownloadInput) {
  const credentials = readJson<Aria2Credentials>(downloader.credentialsJson)
  const options = readJson<Aria2Options>(downloader.optionsJson)
  const params: unknown[] = [[input.uri]]
  if (credentials.secret) params.unshift(`token:${credentials.secret}`)
  if (options.dir) params.push({ dir: options.dir })

  const response = await fetch(downloader.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'aria2.addUri',
      params,
    }),
  })

  await assertOk(response, 'aria2')
  const payload = (await response.json()) as { error?: { message?: string } }
  if (payload.error) throw new Error(`aria2 rejected download: ${payload.error.message || 'unknown error'}`)
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function basicAuthHeader(username?: string, password?: string) {
  if (!username && !password) return null
  return `Basic ${btoa(`${username || ''}:${password || ''}`)}`
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

async function assertOk(response: Response, target: string) {
  if (response.ok) return
  const text = await response.text()
  throw new Error(`${target} request failed: ${response.status}${text ? ` ${text}` : ''}`)
}
