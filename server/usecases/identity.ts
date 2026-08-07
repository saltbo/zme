import type { AppConfig } from '@server/config'
import { principalKey } from '@server/config'

export interface OidcProfile {
  issuer: string
  subject: string
  name: string
  email: string | null
  image: string | null
}

export interface AuthenticatedUser extends OidcProfile {
  id: string
  role: 'admin' | 'user'
}

export interface LoginTransaction {
  id: string
  stateHash: string
  nonce: string
  codeVerifier: string
  returnTo: string
  expiresAt: string
  createdAt: string
}

export interface LocalSession {
  id: string
  expiresAt: string
  user: AuthenticatedUser
}

export interface OidcLoginResult {
  profile: OidcProfile
  idToken: string
}

export interface IdentityRepo {
  createLoginTransaction(transaction: LoginTransaction): Promise<void>
  consumeLoginTransaction(stateHash: string, now: string): Promise<LoginTransaction | null>
  resolveUser(
    profile: OidcProfile,
    bindingLegacyUserId: string | undefined,
    configuredAdmin: boolean,
    refreshProfile: boolean,
    now: string,
  ): Promise<AuthenticatedUser>
  createSession(session: {
    id: string
    tokenHash: string
    userId: string
    idToken: string
    expiresAt: string
    createdAt: string
    lastSeenAt: string
  }): Promise<void>
  getSession(tokenHash: string, now: string): Promise<LocalSession | null>
  deleteSession(tokenHash: string): Promise<string | null>
  recordDpopProof(
    issuer: string,
    proofJti: string,
    keyThumbprint: string,
    expiresAt: string,
    now: string,
  ): Promise<boolean>
}

export interface OidcClient {
  createAuthorizationRequest(state: string, nonce: string, codeVerifier: string): Promise<URL>
  exchangeCallback(
    callbackUrl: URL,
    expectedState: string,
    nonce: string,
    codeVerifier: string,
  ): Promise<OidcLoginResult>
  createLogoutUrl(idTokenHint: string): Promise<URL | null>
}

export interface DpopTokenPrincipal {
  issuer: string
  subject: string
  scopes: string[]
  actor: { sub: string }
  proofJti: string
  keyThumbprint: string
  replayExpiresAt: string
}

export interface DpopTokenValidator {
  validate(request: Request): Promise<DpopTokenPrincipal>
}

export class IdentityDisabledError extends Error {
  constructor() {
    super('The local identity projection is disabled.')
    this.name = 'IdentityDisabledError'
  }
}

export class OidcCallbackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OidcCallbackError'
  }
}

export class DpopCredentialError extends Error {
  constructor(
    readonly kind: 'invalid_token' | 'invalid_dpop_proof',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DpopCredentialError'
  }
}

export async function beginOidcLogin(
  repo: IdentityRepo,
  oidc: OidcClient,
  returnTo: string,
  now = new Date(),
): Promise<{ authorizationUrl: URL; state: string }> {
  const state = randomValue()
  const nonce = randomValue()
  const codeVerifier = randomValue(64)
  const createdAt = now.toISOString()
  await repo.createLoginTransaction({
    id: crypto.randomUUID(),
    stateHash: await hashSecret(state),
    nonce,
    codeVerifier,
    returnTo,
    createdAt,
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  })
  return { authorizationUrl: await oidc.createAuthorizationRequest(state, nonce, codeVerifier), state }
}

export async function completeOidcLogin(
  repo: IdentityRepo,
  oidc: OidcClient,
  config: AppConfig,
  callbackUrl: URL,
  state: string,
  now = new Date(),
): Promise<{ sessionToken: string; session: LocalSession; returnTo: string }> {
  const transaction = await repo.consumeLoginTransaction(await hashSecret(state), now.toISOString())
  if (!transaction) throw new OidcCallbackError('The OIDC login transaction is missing, expired, or already used.')
  const { profile, idToken } = await oidc.exchangeCallback(
    callbackUrl,
    state,
    transaction.nonce,
    transaction.codeVerifier,
  )
  const key = principalKey(profile.issuer, profile.subject)
  const user = await repo.resolveUser(
    profile,
    config.oidc.legacyBindings.get(key),
    config.oidc.adminSubjects.has(key),
    true,
    now.toISOString(),
  )
  const sessionToken = randomValue(64)
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60_000).toISOString()
  const session: LocalSession = { id: crypto.randomUUID(), expiresAt, user }
  await repo.createSession({
    id: session.id,
    tokenHash: await hashSecret(sessionToken),
    userId: user.id,
    idToken,
    expiresAt,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  })
  return { sessionToken, session, returnTo: transaction.returnTo }
}

export async function getLocalSession(
  repo: IdentityRepo,
  token: string,
  now = new Date(),
): Promise<LocalSession | null> {
  return repo.getSession(await hashSecret(token), now.toISOString())
}

export async function endLocalSession(repo: IdentityRepo, token: string): Promise<string | null> {
  return repo.deleteSession(await hashSecret(token))
}

export function safeReturnTo(value: string | null): string {
  if (!value) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/auth/')) return '/'
  const url = new URL(value, 'https://zme.invalid')
  return `${url.pathname}${url.search}${url.hash}`
}

export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

function randomValue(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return bytesToBase64Url(value)
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
