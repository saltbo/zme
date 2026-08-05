import { principalKey, readConfig } from '@server/config'
import {
  type AuthenticatedUser,
  DpopCredentialError,
  type DpopTokenPrincipal,
  getLocalSession,
  IdentityDisabledError,
} from '@server/usecases/identity'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv, Principal } from './context'
import { SESSION_COOKIE } from './identity'
import { problem } from './protocol'

export const requireAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (authorization) return authenticateAgent(c, next)

  const token = getCookie(c, SESSION_COOKIE)
  const session = token ? await getLocalSession(c.get('deps').identityRepo, token) : null
  if (!session) {
    if (agentScope(c.req.method, apiPath(c.req.path))) {
      c.header('WWW-Authenticate', dpopChallenge(readConfig(c.env)))
    }
    return problem(c, 401, 'authentication-required', 'Authentication required')
  }
  c.set('principal', {
    kind: 'human',
    userId: session.user.id,
    issuer: session.user.issuer,
    subject: session.user.subject,
    role: session.user.role,
    scopes: ['*'],
  })
  c.set('user', session.user)
  await next()
}

export const requireAdminMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const principal = c.get('principal')
  if (principal.kind !== 'human' || principal.role !== 'admin') {
    return problem(c, 403, 'administrator-required', 'Administrator access required')
  }
  await next()
}

async function authenticateAgent(c: Parameters<MiddlewareHandler<AppEnv>>[0], next: () => Promise<unknown>) {
  const config = readConfig(c.env)
  let token: DpopTokenPrincipal
  try {
    token = await c.get('deps').dpopTokenValidator.validate(c.req.raw)
  } catch (error) {
    if (error instanceof DpopCredentialError) {
      c.header('WWW-Authenticate', dpopChallenge(config, error.kind))
      return problem(c, 401, error.kind.replaceAll('_', '-'), 'The DPoP credential is invalid')
    }
    throw error
  }

  const key = principalKey(token.issuer, token.subject)
  const now = new Date().toISOString()
  const accepted = await c
    .get('deps')
    .identityRepo.recordDpopProof(token.issuer, token.proofJti, token.keyThumbprint, token.replayExpiresAt, now)
  if (!accepted) {
    c.header('WWW-Authenticate', dpopChallenge(config, 'invalid_dpop_proof'))
    return problem(c, 401, 'invalid-dpop-proof', 'The DPoP credential is invalid')
  }
  let user: AuthenticatedUser
  try {
    user = await c
      .get('deps')
      .identityRepo.resolveUser(
        { issuer: token.issuer, subject: token.subject, name: token.subject, email: null, image: null },
        config.oidc.legacyBindings.get(key),
        config.oidc.adminSubjects.has(key),
        false,
        now,
      )
  } catch (error) {
    if (error instanceof IdentityDisabledError) {
      return problem(c, 403, 'identity-disabled', 'The local identity projection is disabled')
    }
    throw error
  }
  const principal: Principal = {
    kind: 'agent',
    userId: user.id,
    issuer: token.issuer,
    subject: token.subject,
    role: user.role,
    scopes: token.scopes,
    actor: token.actor,
  }
  c.set('principal', principal)
  c.set('user', user)
  const requiredScope = agentScope(c.req.method, apiPath(c.req.path))
  if (!requiredScope) return problem(c, 403, 'agent-operation-forbidden', 'This operation is not available to Agents')
  if (!principal.scopes.includes(requiredScope)) {
    c.header('WWW-Authenticate', dpopChallenge(config, 'insufficient_scope', requiredScope))
    return problem(c, 403, 'insufficient-scope', 'The access token lacks the required scope')
  }
  await next()
}

function apiPath(path: string): string {
  return path.startsWith('/api/') ? path.slice(4) : path
}

function agentScope(method: string, path: string): string | null {
  if (method === 'GET' && path === '/media') return 'media:read'
  if (method === 'POST' && path === '/release-search-jobs') return 'release-search-jobs:write'
  if (method === 'GET' && /^\/release-search-jobs(?:\/[^/]+(?:\/results)?)?$/.test(path)) {
    return 'release-search-jobs:read'
  }
  if (method === 'GET' && /^\/release-search-results\/[^/]+$/.test(path)) return 'release-search-jobs:read'
  if (method === 'POST' && path === '/download-tasks') return 'download-tasks:write'
  if (method === 'GET' && /^\/download-tasks(?:\/[^/]+)?$/.test(path)) return 'download-tasks:read'
  if (method === 'GET' && path === '/download-destinations') return 'download-destinations:read'
  return null
}

export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal')
    if (principal.kind === 'agent' && !principal.scopes.includes(scope)) {
      c.header('WWW-Authenticate', dpopChallenge(readConfig(c.env), 'insufficient_scope', scope))
      return problem(c, 403, 'insufficient-scope', 'The access token lacks the required scope')
    }
    await next()
  }
}

function dpopChallenge(
  config: ReturnType<typeof readConfig>,
  error?: DpopCredentialError['kind'] | 'insufficient_scope',
  scope?: string,
): string {
  const parameters = [`algs="${config.oidc.allowedAlgorithms.join(' ')}"`]
  if (error) parameters.push(`error="${error}"`)
  if (scope) parameters.push(`scope="${scope}"`)
  return `DPoP ${parameters.join(', ')}`
}
