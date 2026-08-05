import { API_VERSION, readConfig } from '@server/config'
import { startTrace } from '@server/observability/trace'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './context'

export const requestBoundaryMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID()
  const trace = startTrace(c.req.raw.headers)
  c.set('requestId', requestId)
  c.set('trace', trace)
  const started = Date.now()
  try {
    await next()
  } finally {
    const principal = c.get('principal')
    const actorFingerprint =
      principal?.kind === 'agent' && principal.actor ? await claimFingerprint(principal.actor.sub) : undefined
    c.header('Request-Id', requestId)
    appendLink(
      c,
      `<${readConfig(c.env).resourceUrl}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
    )
    console.info(
      JSON.stringify({
        event: 'http.request.completed',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - started,
        traceId: trace.traceId,
        spanId: trace.spanId,
        principalKind: principal?.kind,
        principalUserId: principal?.userId,
        actorFingerprint,
      }),
    )
  }
}

async function claimFingerprint(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return btoa(String.fromCharCode(...digest))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export const normalizeProblemMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  if (c.res.status < 400 || c.res.headers.get('Content-Type')?.includes('application/problem+json')) return
  const contentType = c.res.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) return

  let payload: Record<string, unknown>
  try {
    payload = (await c.res.clone().json()) as Record<string, unknown>
  } catch {
    return
  }
  const validationFailure = payload.success === false && 'error' in payload
  const validationIssues = extractValidationIssues(payload)
  const status = validationFailure ? 422 : c.res.status
  const title = problemTitle(status)
  const detail =
    typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : title
  const requestId = c.get('requestId') ?? crypto.randomUUID()
  const headers = new Headers(c.res.headers)
  headers.set('Content-Type', 'application/problem+json')
  headers.set('Request-Id', requestId)
  c.res = new Response(
    JSON.stringify({
      type: `${readConfig(c.env).appOrigin}/problems/${problemSlug(status)}`,
      title,
      status,
      detail,
      instance: `urn:request:${requestId}`,
      ...(validationFailure
        ? {
            errors: validationIssues.length
              ? validationIssues
              : [{ pointer: '#', detail: 'Request validation failed' }],
          }
        : {}),
    }),
    { status, headers },
  )
}

export const apiVersionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const queryVersioned =
    (c.req.method === 'GET' || c.req.method === 'HEAD') && /^\/api\/music\/tracks\/[^/]+\/content$/.test(c.req.path)
  const version = queryVersioned ? c.req.query('apiVersion') : c.req.header('API-Version')
  if (version !== API_VERSION) {
    return problem(c, 400, 'unsupported-api-version', `API-Version must be ${API_VERSION}`)
  }
  await next()
  c.header('API-Version', API_VERSION)
  const vary = c.res.headers.get('Vary')
  c.header('Vary', vary ? `${vary}, API-Version` : 'API-Version')
}

export function problem(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  type: string,
  title: string,
  detail?: string,
) {
  const requestId = c.get('requestId') ?? crypto.randomUUID()
  return c.json(
    {
      type: `${readConfig(c.env).appOrigin}/problems/${type}`,
      title,
      status,
      detail: detail ?? title,
      instance: `urn:request:${requestId}`,
    },
    status,
    { 'Content-Type': 'application/problem+json', 'Request-Id': requestId },
  )
}

export function entityTag(updatedAt: string) {
  return `"${updatedAt}"`
}

export function ifMatchRevision(c: Context<AppEnv>) {
  const value = c.req.header('If-Match')
  const match = value?.match(/^"([^"\\]+)"$/)
  return match?.[1] ?? null
}

export function requireMergePatch(c: Context<AppEnv>) {
  if (c.req.header('Content-Type')?.split(';', 1)[0].trim().toLowerCase() === 'application/merge-patch+json') {
    return null
  }
  return problem(c, 415, 'unsupported-media-type', 'PATCH requires application/merge-patch+json')
}

export function setPageLinks(c: Context<AppEnv>, page: { page: number; pageSize: number }, totalItems: number): void {
  const totalPages = Math.ceil(totalItems / page.pageSize)
  const links: string[] = []
  const add = (targetPage: number, relation: string) => {
    const url = new URL(c.req.url)
    url.searchParams.set('page', String(targetPage))
    url.searchParams.set('pageSize', String(page.pageSize))
    links.push(`<${url.toString()}>; rel="${relation}"`)
  }
  add(1, 'first')
  if (page.page > 1) add(page.page - 1, 'prev')
  if (page.page < totalPages) add(page.page + 1, 'next')
  if (totalPages > 0) add(totalPages, 'last')
  for (const link of links) appendLink(c, link)
}

function appendLink(c: Context<AppEnv>, value: string): void {
  const existing = c.res.headers.get('Link')
  c.header('Link', existing ? `${existing}, ${value}` : value)
}

function extractValidationIssues(payload: Record<string, unknown>) {
  const error = payload.error
  if (!error || typeof error !== 'object') return []
  const record = error as { issues?: unknown; message?: unknown }
  let issues = record.issues
  if (!Array.isArray(issues) && typeof record.message === 'string') {
    try {
      issues = JSON.parse(record.message)
    } catch {
      return []
    }
  }
  if (!Array.isArray(issues)) return []
  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return []
    const record = issue as Record<string, unknown>
    return [
      {
        pointer: Array.isArray(record.path) ? requestPointer(record.path) : '#',
        detail: typeof record.message === 'string' ? record.message : 'Invalid value',
      },
    ]
  })
}

function requestPointer(path: unknown[]): string {
  if (path.length === 0) return '#'
  return `#/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function problemTitle(status: number) {
  if (status === 401) return 'Authentication required'
  if (status === 403) return 'Authorization denied'
  if (status === 404) return 'Resource not found'
  if (status === 409) return 'Resource conflict'
  if (status === 412) return 'Precondition failed'
  if (status === 415) return 'Unsupported media type'
  if (status === 428) return 'Precondition required'
  if (status === 422) return 'Request validation failed'
  if (status >= 500) return 'The request could not be completed'
  return 'Invalid request'
}

function problemSlug(status: number) {
  return status === 422
    ? 'validation-error'
    : status === 412
      ? 'precondition-failed'
      : status === 428
        ? 'precondition-required'
        : `http-${status}`
}
