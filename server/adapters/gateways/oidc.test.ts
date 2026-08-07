import { createOidcClient } from '@server/adapters/gateways/oidc'
import type { AppConfig } from '@server/config'
import { OidcCallbackError } from '@server/usecases/identity'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { calculatePKCECodeChallenge } from 'oauth4webapi'
import { afterEach, describe, expect, it, vi } from 'vitest'

type SigningKey = Awaited<ReturnType<typeof makeSigningKey>>

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OIDC protocol client', () => {
  it('uses discovery and Authorization Code with state, nonce, and PKCE S256', async () => {
    const provider = await fakeProvider({ claims: { nonce: 'expected-nonce' } })
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient(provider.config)

    const authorization = await client.createAuthorizationRequest('expected-state', 'expected-nonce', 'verifier-value')
    expect(authorization.origin + authorization.pathname).toBe(`${provider.issuer}/authorize`)
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      client_id: 'zme-client',
      redirect_uri: 'https://app.test/auth/callback',
      response_type: 'code',
      scope: 'openid profile email',
      state: 'expected-state',
      nonce: 'expected-nonce',
      code_challenge_method: 'S256',
      code_challenge: await calculatePKCECodeChallenge('verifier-value'),
    })

    const login = await client.exchangeCallback(
      new URL('https://app.test/auth/callback?code=valid-code&state=expected-state'),
      'expected-state',
      'expected-nonce',
      'verifier-value',
    )
    expect(login.profile).toEqual({
      issuer: provider.issuer,
      subject: 'human-123',
      name: 'OIDC User',
      email: 'user@example.test',
      image: null,
    })
    expect(provider.tokenRequests()).toBe(1)
  })

  it.each([
    ['issuer', { issuer: 'https://wrong-issuer.test' }],
    ['audience', { audience: 'different-client' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['expiry', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
  ] as const)('rejects an ID token with an invalid %s [spec: auth/reject-invalid-callback]', async (_name, claims) => {
    const provider = await fakeProvider({ claims })
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient(provider.config)
    await expect(
      client.exchangeCallback(
        new URL('https://app.test/auth/callback?code=invalid-claim&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).rejects.toThrow()
  })

  it('rejects an ID token whose signing algorithm is not allowlisted', async () => {
    const disallowedKey = await makeSigningKey('ES384')
    const provider = await fakeProvider({ signingKey: disallowedKey })
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient(provider.config)
    await expect(
      client.exchangeCallback(
        new URL('https://app.test/auth/callback?code=bad-alg&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).rejects.toThrow('unapproved signature algorithm')
  })

  it('refreshes a cached JWKS when the provider rotates to an unknown key id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const provider = await fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient(provider.config)
    const callback = new URL('https://app.test/auth/callback?code=valid&state=state')
    await client.exchangeCallback(callback, 'state', 'nonce', 'verifier')

    await provider.rotate()
    vi.advanceTimersByTime(61_000)
    await client.exchangeCallback(callback, 'state', 'nonce', 'verifier')
    expect(provider.jwksRequests()).toBeGreaterThanOrEqual(2)
  })

  it.each([
    ['authorization endpoint', { authorization_endpoint: undefined }, 'authorization_endpoint'],
    ['PKCE S256 support', { code_challenge_methods_supported: [] }, 'PKCE S256'],
    ['token endpoint', { token_endpoint: undefined }, 'token_endpoint or jwks_uri'],
    ['JWKS endpoint', { jwks_uri: undefined }, 'token_endpoint or jwks_uri'],
  ] as const)('rejects discovery without the required %s', async (_name, metadata, message) => {
    const provider = await fakeProvider({ metadata })
    vi.stubGlobal('fetch', provider.fetch)
    await expect(
      createOidcClient(provider.config).createAuthorizationRequest('state', 'nonce', 'verifier'),
    ).rejects.toThrow(message)
  })

  it('uses UserInfo display claims', async () => {
    const provider = await fakeProvider({
      metadata: {
        userinfo_endpoint: 'USERINFO',
      },
      userInfo: { sub: 'human-123', preferred_username: '  current-user  ', picture: 'https://images.test/user.png' },
    })
    provider.replaceMetadataPlaceholders()
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient(provider.config)

    await expect(
      client.exchangeCallback(
        new URL('https://app.test/auth/callback?code=userinfo&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).resolves.toMatchObject({
      profile: { name: 'current-user', email: null, image: 'https://images.test/user.png' },
    })
  })

  it.each([
    ['client_secret_basic', true],
    ['client_secret_post', false],
  ] as const)('sends %s token endpoint authentication with exact wire semantics', async (method, usesHeader) => {
    const provider = await fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)
    const client = createOidcClient({ ...provider.config, tokenEndpointAuthMethod: method, clientSecret: 'secret' })
    await expect(
      client.exchangeCallback(
        new URL('https://app.test/auth/callback?code=secret-client&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).resolves.toMatchObject({ profile: { subject: 'human-123' } })
    const tokenRequest = provider.lastTokenRequest()
    expect(Boolean(tokenRequest?.authorization?.startsWith('Basic '))).toBe(usesHeader)
    expect(tokenRequest?.body.get('client_secret')).toBe(usesHeader ? null : 'secret')
    expect(tokenRequest?.body.get('client_id')).toBe(usesHeader ? null : 'zme-client')
  })

  it('sends no client secret for a public client', async () => {
    const provider = await fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)
    await createOidcClient(provider.config).exchangeCallback(
      new URL('https://app.test/auth/callback?code=public-client&state=state'),
      'state',
      'nonce',
      'verifier',
    )
    const tokenRequest = provider.lastTokenRequest()
    expect(tokenRequest?.authorization).toBeNull()
    expect(tokenRequest?.body.get('client_secret')).toBeNull()
    expect(tokenRequest?.body.get('client_id')).toBe('zme-client')
  })

  it('supports an HTTP localtest.me issuer consistently with configuration validation', async () => {
    const provider = await fakeProvider({ issuer: 'http://identity.localtest.me' })
    vi.stubGlobal('fetch', provider.fetch)
    await expect(provider.config).toMatchObject({ issuer: 'http://identity.localtest.me' })
    await expect(
      createOidcClient(provider.config).createAuthorizationRequest('state', 'nonce', 'verifier'),
    ).resolves.toBeInstanceOf(URL)
  })

  it('rejects a token response without an ID token', async () => {
    const provider = await fakeProvider({ omitIdToken: true })
    vi.stubGlobal('fetch', provider.fetch)
    await expect(
      createOidcClient(provider.config).exchangeCallback(
        new URL('https://app.test/auth/callback?code=no-id-token&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).rejects.toThrow()
  })

  it('classifies an OAuth token endpoint error as a callback failure', async () => {
    const provider = await fakeProvider({
      tokenError: { error: 'invalid_request', error_description: 'session no longer exists' },
    })
    vi.stubGlobal('fetch', provider.fetch)

    await expect(
      createOidcClient(provider.config).exchangeCallback(
        new URL('https://app.test/auth/callback?code=stale-provider-session&state=state'),
        'state',
        'nonce',
        'verifier',
      ),
    ).rejects.toMatchObject({
      name: OidcCallbackError.name,
      cause: { name: 'ResponseBodyError', error: 'invalid_request', status: 400 },
    })
  })
})

async function fakeProvider(
  options: {
    claims?: { issuer?: string; audience?: string; nonce?: string; expiresAt?: number }
    signingKey?: SigningKey
    metadata?: Record<string, unknown>
    userInfo?: Record<string, unknown>
    omitIdToken?: boolean
    tokenError?: { error: string; error_description: string }
    issuer?: string
  } = {},
) {
  const issuer = options.issuer ?? `https://oidc-${crypto.randomUUID()}.test`
  let key = options.signingKey ?? (await makeSigningKey('ES256'))
  let tokenRequestCount = 0
  let jwksRequestCount = 0
  let lastTokenRequest: { authorization: string | null; body: URLSearchParams } | null = null
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['ES256', 'ES384'],
        ...options.metadata,
      })
    }
    if (url.pathname === '/jwks') {
      jwksRequestCount += 1
      return json({ keys: [key.publicJwk] }, { headers: { 'cache-control': 'public, max-age=3600' } })
    }
    if (url.pathname === '/token') {
      tokenRequestCount += 1
      const body = new URLSearchParams(await request.text())
      lastTokenRequest = { authorization: request.headers.get('authorization'), body }
      if (options.tokenError) return json(options.tokenError, { status: 400 })
      if (body.get('redirect_uri') !== 'https://app.test/auth/callback')
        return json({ error: 'invalid_request' }, { status: 400 })
      return json(
        {
          access_token: 'opaque-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          ...(options.omitIdToken
            ? {}
            : {
                id_token: await issueIdToken(key, {
                  issuer: options.claims?.issuer ?? issuer,
                  audience: options.claims?.audience ?? 'zme-client',
                  nonce: options.claims?.nonce ?? 'nonce',
                  expiresAt: options.claims?.expiresAt,
                }),
              }),
        },
        { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
      )
    }
    if (url.pathname === '/userinfo') return json(options.userInfo ?? { sub: 'human-123' })
    return new Response(null, { status: 404 })
  })
  return {
    issuer,
    config: {
      issuer,
      clientId: 'zme-client',
      tokenEndpointAuthMethod: 'none',
      redirectUri: 'https://app.test/auth/callback',
      allowedAlgorithms: ['ES256'],
      adminSubjects: new Set<string>(),
      legacyBindings: new Map<string, string>(),
    } satisfies AppConfig['oidc'],
    fetch,
    tokenRequests: () => tokenRequestCount,
    lastTokenRequest: () => lastTokenRequest,
    jwksRequests: () => jwksRequestCount,
    async rotate() {
      key = await makeSigningKey('ES256')
    },
    replaceMetadataPlaceholders() {
      if (options.metadata?.userinfo_endpoint === 'USERINFO') options.metadata.userinfo_endpoint = `${issuer}/userinfo`
      if (options.metadata?.end_session_endpoint === 'LOGOUT')
        options.metadata.end_session_endpoint = `${issuer}/logout`
    },
  }
}

async function makeSigningKey(algorithm: 'ES256' | 'ES384') {
  const { privateKey, publicKey } = await generateKeyPair(algorithm, { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const kid = crypto.randomUUID()
  return { algorithm, privateKey, publicJwk: { ...publicJwk, kid, alg: algorithm, use: 'sig' }, kid }
}

async function issueIdToken(
  key: SigningKey,
  claims: { issuer: string; audience: string; nonce: string; expiresAt?: number },
) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ nonce: claims.nonce, name: 'OIDC User', email: 'user@example.test' })
    .setProtectedHeader({ alg: key.algorithm, kid: key.kid, typ: 'JWT' })
    .setIssuer(claims.issuer)
    .setAudience(claims.audience)
    .setSubject('human-123')
    .setIssuedAt(now)
    .setExpirationTime(claims.expiresAt ?? now + 300)
    .sign(key.privateKey)
}

function json(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}
