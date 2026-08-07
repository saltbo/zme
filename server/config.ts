import type { Env } from './env'

export const API_VERSION = '2026-08-05'
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
  downloadResourceRefSecret?: string
  oidc: {
    issuer: string
    clientId: string
    clientSecret?: string
    tokenEndpointAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
    redirectUri: string
    allowedAlgorithms: string[]
    adminSubjects: Set<string>
    legacyBindings: Map<string, string>
  }
}

export function readConfig(env: Env): AppConfig {
  const appOrigin = parseOrigin(required(env.PUBLIC_APP_ORIGIN, 'PUBLIC_APP_ORIGIN'), 'PUBLIC_APP_ORIGIN')
  const issuer = parseIssuer(required(env.OIDC_ISSUER, 'OIDC_ISSUER'))
  const clientId = required(env.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID')
  const redirectUri = new URL('/auth/callback', appOrigin).toString()
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() || undefined
  const tokenEndpointAuthMethod =
    env.OIDC_TOKEN_ENDPOINT_AUTH_METHOD?.trim() || (clientSecret ? 'client_secret_basic' : 'none')
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(tokenEndpointAuthMethod)) {
    throw new Error('OIDC_TOKEN_ENDPOINT_AUTH_METHOD is unsupported.')
  }
  if (tokenEndpointAuthMethod === 'none' && clientSecret) {
    throw new Error('OIDC_CLIENT_SECRET must be omitted when token endpoint authentication is none.')
  }
  if (tokenEndpointAuthMethod !== 'none' && !clientSecret) {
    throw new Error('OIDC_CLIENT_SECRET is required for the configured token endpoint authentication method.')
  }

  const adminSubjects = new Set(
    required(env.OIDC_ADMIN_SUBJECTS, 'OIDC_ADMIN_SUBJECTS')
      .split(',')
      .map((subject) => subject.trim())
      .map((subject) => {
        if (!subject) throw new Error('OIDC_ADMIN_SUBJECTS entries must be nonempty subjects.')
        return principalKey(issuer, subject)
      }),
  )
  const legacyBindings = parseLegacyBindings(env.OIDC_LEGACY_BINDINGS_JSON, issuer)
  const resourceUrl = `${appOrigin}/api`

  return {
    appOrigin,
    resourceUrl,
    downloadResourceRefSecret: env.DOWNLOAD_RESOURCE_REF_SECRET?.trim() || undefined,
    oidc: {
      issuer,
      clientId,
      clientSecret,
      tokenEndpointAuthMethod: tokenEndpointAuthMethod as AppConfig['oidc']['tokenEndpointAuthMethod'],
      redirectUri,
      allowedAlgorithms: [...ASYMMETRIC_JWT_ALGORITHMS],
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

function requireSecureUrl(url: URL, name: string) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localtest.me')
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must use HTTPS except in an explicit local environment.`)
  }
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
