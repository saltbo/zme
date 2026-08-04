import type { Env } from './env'

export const API_VERSION = '2026-08-04'
const ASYMMETRIC_JWT_ALGORITHMS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
])

export interface IdentityBinding {
  issuer: string
  subject: string
  legacyUserId: string
}

export interface AppConfig {
  appOrigin: string
  resourceUrl: string
  realmrootEnabled: boolean
  oidc: {
    issuer: string
    clientId: string
    clientSecret?: string
    tokenEndpointAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
    redirectUri: string
    postLogoutRedirectUri: string
    allowedAlgorithms: string[]
    adminSubjects: Set<string>
    legacyBindings: Map<string, string>
  }
}

export function readConfig(env: Env): AppConfig {
  const appOrigin = parseOrigin(required(env.PUBLIC_APP_ORIGIN, 'PUBLIC_APP_ORIGIN'), 'PUBLIC_APP_ORIGIN')
  const issuer = parseIssuer(required(env.OIDC_ISSUER, 'OIDC_ISSUER'))
  const clientId = required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')
  const redirectUri = parseExactUrl(required(env.OIDC_REDIRECT_URI, 'OIDC_REDIRECT_URI'), 'OIDC_REDIRECT_URI')
  const postLogoutRedirectUri = parseExactUrl(
    required(env.OIDC_POST_LOGOUT_REDIRECT_URI, 'OIDC_POST_LOGOUT_REDIRECT_URI'),
    'OIDC_POST_LOGOUT_REDIRECT_URI',
  )
  if (new URL(redirectUri).pathname !== '/auth/callback') {
    throw new Error('OIDC_REDIRECT_URI must use the /auth/callback route.')
  }
  if (new URL(postLogoutRedirectUri).pathname !== '/login') {
    throw new Error('OIDC_POST_LOGOUT_REDIRECT_URI must use the /login route.')
  }
  for (const [name, value] of [
    ['OIDC_REDIRECT_URI', redirectUri],
    ['OIDC_POST_LOGOUT_REDIRECT_URI', postLogoutRedirectUri],
  ] as const) {
    if (new URL(value).origin !== appOrigin) throw new Error(`${name} must use PUBLIC_APP_ORIGIN.`)
  }

  const tokenEndpointAuthMethod = required(env.OIDC_TOKEN_ENDPOINT_AUTH_METHOD, 'OIDC_TOKEN_ENDPOINT_AUTH_METHOD')
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(tokenEndpointAuthMethod)) {
    throw new Error('OIDC_TOKEN_ENDPOINT_AUTH_METHOD is unsupported.')
  }
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() || undefined
  if (tokenEndpointAuthMethod === 'none' && clientSecret) {
    throw new Error('OIDC_CLIENT_SECRET must be omitted when token endpoint authentication is none.')
  }
  if (tokenEndpointAuthMethod !== 'none' && !clientSecret) {
    throw new Error('OIDC_CLIENT_SECRET is required for the configured token endpoint authentication method.')
  }

  const allowedAlgorithms = parseAlgorithms(required(env.OIDC_ALLOWED_ALGS, 'OIDC_ALLOWED_ALGS'))
  const adminSubjects = new Set(
    required(env.OIDC_ADMIN_SUBJECTS, 'OIDC_ADMIN_SUBJECTS')
      .split(',')
      .map((value) => parsePrincipal(value, issuer, 'OIDC_ADMIN_SUBJECTS')),
  )
  const legacyBindings = parseLegacyBindings(env.OIDC_LEGACY_BINDINGS_JSON, issuer)
  const resourceUrl = parseExactUrl(
    required(env.REALMROOT_RESOURCE_URL, 'REALMROOT_RESOURCE_URL'),
    'REALMROOT_RESOURCE_URL',
  )
  if (resourceUrl !== `${appOrigin}/api`) throw new Error('REALMROOT_RESOURCE_URL must be PUBLIC_APP_ORIGIN plus /api.')
  const realmrootIssuer = env.REALMROOT_ISSUER?.trim()
  if (realmrootIssuer && realmrootIssuer !== issuer) {
    throw new Error('REALMROOT_ISSUER must exactly match OIDC_ISSUER when Realmroot Native access is enabled.')
  }

  return {
    appOrigin,
    resourceUrl,
    realmrootEnabled: Boolean(realmrootIssuer),
    oidc: {
      issuer,
      clientId,
      clientSecret,
      tokenEndpointAuthMethod: tokenEndpointAuthMethod as AppConfig['oidc']['tokenEndpointAuthMethod'],
      redirectUri,
      postLogoutRedirectUri,
      allowedAlgorithms,
      adminSubjects,
      legacyBindings,
    },
  }
}

export function principalKey(issuer: string, subject: string): string {
  return `${issuer}|${subject}`
}

function required(value: string | undefined, name: string): string {
  const result = value?.trim()
  if (!result) throw new Error(`${name} is required.`)
  return result
}

function parseOrigin(value: string, name: string): string {
  const url = new URL(value)
  if (url.href !== `${url.origin}/`) throw new Error(`${name} must be an origin without a path, query, or fragment.`)
  requireSecureUrl(url, name)
  return url.origin
}

function parseIssuer(value: string): string {
  const url = new URL(value)
  requireSecureUrl(url, 'OIDC_ISSUER')
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('OIDC_ISSUER must not contain credentials, a query, or a fragment.')
  }
  return value
}

function parseExactUrl(value: string, name: string): string {
  const url = new URL(value)
  requireSecureUrl(url, name)
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment.`)
  }
  return value
}

function requireSecureUrl(url: URL, name: string) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localtest.me')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must use HTTPS except in an explicit local environment.`)
  }
}

function parseAlgorithms(value: string): string[] {
  const algorithms = [
    ...new Set(
      value
        .split(',')
        .map((algorithm) => algorithm.trim())
        .filter(Boolean),
    ),
  ]
  if (algorithms.length === 0) throw new Error('OIDC_ALLOWED_ALGS must contain at least one algorithm.')
  if (algorithms.some((algorithm) => !ASYMMETRIC_JWT_ALGORITHMS.has(algorithm))) {
    throw new Error('OIDC_ALLOWED_ALGS contains an unsupported asymmetric signature algorithm.')
  }
  return algorithms
}

function parsePrincipal(value: string, issuer: string, name: string): string {
  const separator = value.lastIndexOf('|')
  if (separator <= 0 || separator === value.length - 1) throw new Error(`${name} entries must be issuer|subject.`)
  const entryIssuer = value.slice(0, separator)
  const subject = value.slice(separator + 1)
  if (entryIssuer !== issuer) throw new Error(`${name} may contain only the configured OIDC issuer.`)
  return principalKey(entryIssuer, subject)
}

function parseLegacyBindings(value: string | undefined, issuer: string): Map<string, string> {
  if (!value?.trim()) return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (cause) {
    throw new Error('OIDC_LEGACY_BINDINGS_JSON must be valid JSON.', { cause })
  }
  if (!Array.isArray(parsed)) throw new Error('OIDC_LEGACY_BINDINGS_JSON must be an array.')
  const bindings = new Map<string, string>()
  const legacyIds = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') throw new Error('OIDC_LEGACY_BINDINGS_JSON entries must be objects.')
    const record = item as Record<string, unknown>
    if (record.issuer !== issuer || typeof record.subject !== 'string' || typeof record.legacyUserId !== 'string') {
      throw new Error('OIDC_LEGACY_BINDINGS_JSON entries require the configured issuer, subject, and legacyUserId.')
    }
    const key = principalKey(record.issuer, record.subject)
    if (bindings.has(key) || legacyIds.has(record.legacyUserId)) {
      throw new Error('OIDC_LEGACY_BINDINGS_JSON identities and legacyUserIds must be unique.')
    }
    bindings.set(key, record.legacyUserId)
    legacyIds.add(record.legacyUserId)
  }
  return bindings
}
