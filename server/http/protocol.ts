import { API_VERSION, readConfig } from '@server/config'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './context'

export const requestBoundaryMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  const started = Date.now()
  try {
    await next()
  } finally {
    const principal = c.get('principal')
    c.header('Request-Id', requestId)
    c.header(
      'Link',
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
        principalKind: principal?.kind,
        principalUserId: principal?.userId,
        actorSubject: principal?.kind === 'agent' ? principal.actor?.sub : undefined,
      }),
    )
  }
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
        ? { errors: validationIssues.length ? validationIssues : [{ path: '', message: 'Request validation failed' }] }
        : {}),
    }),
    { status, headers },
  )
}

export const apiVersionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const queryVersioned =
    (c.req.method === 'GET' && c.req.path === '/api/downloads/events') ||
    ((c.req.method === 'GET' || c.req.method === 'HEAD') && /^\/api\/music\/tracks\/[^/]+\/content$/.test(c.req.path))
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
        path: Array.isArray(record.path) ? record.path.map(String).join('.') : '',
        message: typeof record.message === 'string' ? record.message : 'Invalid value',
      },
    ]
  })
}

function problemTitle(status: number) {
  if (status === 401) return 'Authentication required'
  if (status === 403) return 'Authorization denied'
  if (status === 404) return 'Resource not found'
  if (status === 409) return 'Resource conflict'
  if (status === 412) return 'Precondition failed'
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
