import { validateDpopRequest } from '@server/adapters/gateways/oidc'
import type { AppConfig } from '@server/config'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('Standard OIDC DPoP resource token validation', () => {
  it('accepts an at+jwt bound to the proof key and preserves scope and actor', async () => {
    const fixture = await dpopFixture()
    vi.stubGlobal('fetch', fixture.fetch)
    const principal = await validateDpopRequest(fixture.config, fixture.request)
    expect(principal).toMatchObject({
      issuer: fixture.issuer,
      subject: 'human-123',
      scopes: ['media:read', 'release-search-jobs:write'],
      actor: { sub: 'agent-456' },
      proofJti: fixture.proofJti,
      keyThumbprint: fixture.proofThumbprint,
    })
  })

  it('does not permit Bearer fallback', async () => {
    const fixture = await dpopFixture()
    const headers = new Headers(fixture.request.headers)
    headers.set('authorization', `Bearer ${fixture.accessToken}`)
    await expect(validateDpopRequest(fixture.config, new Request(fixture.request, { headers }))).rejects.toThrow(
      'DPoP access token is required',
    )
  })

  it('accepts the case-insensitive DPoP authentication scheme', async () => {
    const fixture = await dpopFixture({ authorizationScheme: 'dpop' })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).resolves.toMatchObject({
      subject: 'human-123',
    })
  })

  it.each([
    ['method', { proofMethod: 'POST' }],
    ['URL', { proofUrl: 'https://zme.test/api/download-tasks' }],
    ['access-token hash', { wrongAth: true }],
  ] as const)('rejects a proof with an invalid %s', async (_name, override) => {
    const fixture = await dpopFixture(override)
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_dpop_proof',
    })
  })

  it('classifies a failed access-token key binding as an invalid token', async () => {
    const fixture = await dpopFixture({ wrongBinding: true })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it.each([
    ['missing jkt', {}],
    ['non-string jkt', { jkt: 42 }],
    ['ambiguous confirmation methods', { jkt: 'thumbprint', other: 'value' }],
  ] as const)('classifies an access token with %s as invalid', async (_name, confirmation) => {
    const fixture = await dpopFixture({ confirmation })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it('rejects a token for a different resource audience', async () => {
    const fixture = await dpopFixture({ audience: 'https://other-resource.test/api' })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it.each([
    ['expired access token', { accessExpiresAt: Math.floor(Date.now() / 1000) - 60 }],
    [
      'access token issued in the future',
      {
        accessIssuedAt: Math.floor(Date.now() / 1000) + 600,
        accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
      },
    ],
    ['wrong access-token type', { accessType: 'JWT' }],
  ] as const)('rejects an %s', async (_name, override) => {
    const fixture = await dpopFixture(override)
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it.each([
    ['identifier', { omitProofJti: true }],
    ['issued-at', { omitProofIat: true }],
  ] as const)('rejects a proof without a replay %s claim', async (_name, override) => {
    const fixture = await dpopFixture(override)
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_dpop_proof',
    })
  })

  it('rejects a resource token without the acting Agent identity', async () => {
    const fixture = await dpopFixture({ omitActor: true })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })

  it('rejects a resource token issued to a different client', async () => {
    const fixture = await dpopFixture({ clientId: 'another-client' })
    vi.stubGlobal('fetch', fixture.fetch)
    await expect(validateDpopRequest(fixture.config, fixture.request)).rejects.toMatchObject({
      kind: 'invalid_token',
    })
  })
})

async function dpopFixture(
  override: {
    proofMethod?: string
    proofUrl?: string
    wrongAth?: boolean
    wrongBinding?: boolean
    audience?: string
    accessIssuedAt?: number
    accessExpiresAt?: number
    accessType?: string
    omitActor?: boolean
    omitProofJti?: boolean
    omitProofIat?: boolean
    clientId?: string
    authorizationScheme?: string
    confirmation?: Record<string, unknown>
  } = {},
) {
  const issuer = `https://dpop-${crypto.randomUUID()}.test`
  const resourceUrl = 'https://zme.test/api'
  const requestUrl = `${resourceUrl}/media?q=dune`
  const issuerKey = await signingKey()
  const proofKey = await signingKey()
  const otherProofKey = override.wrongBinding ? await signingKey() : proofKey
  const proofThumbprint = await calculateJwkThumbprint(proofKey.publicJwk)
  const boundThumbprint = await calculateJwkThumbprint(otherProofKey.publicJwk)
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await new SignJWT({
    scope: 'media:read release-search-jobs:write media:read',
    cnf: override.confirmation ?? { jkt: boundThumbprint },
    ...(override.omitActor ? {} : { act: { iss: issuer, sub: 'agent-456' } }),
    client_id: override.clientId ?? 'realmroot-cli',
  })
    .setProtectedHeader({ alg: 'ES256', kid: issuerKey.kid, typ: override.accessType ?? 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(override.audience ?? resourceUrl)
    .setSubject('human-123')
    .setJti(crypto.randomUUID())
    .setIssuedAt(override.accessIssuedAt ?? now)
    .setExpirationTime(override.accessExpiresAt ?? now + 300)
    .sign(issuerKey.privateKey)
  const proofJti = crypto.randomUUID()
  let proofBuilder = new SignJWT({
    htm: override.proofMethod ?? 'GET',
    htu: override.proofUrl ?? `${resourceUrl}/media`,
    ath: await accessTokenHash(override.wrongAth ? `${accessToken}.wrong` : accessToken),
  }).setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: proofKey.publicJwk })
  if (!override.omitProofJti) proofBuilder = proofBuilder.setJti(proofJti)
  if (!override.omitProofIat) proofBuilder = proofBuilder.setIssuedAt(now)
  const proof = await proofBuilder.sign(proofKey.privateKey)
  const request = new Request(requestUrl, {
    headers: { authorization: `${override.authorizationScheme ?? 'DPoP'} ${accessToken}`, dpop: proof },
  })
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/.well-known/openid-configuration') {
      return json({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` })
    }
    if (path === '/jwks') return json({ keys: [issuerKey.publicJwk] })
    return new Response(null, { status: 404 })
  })
  const oidc = {
    issuer,
    clientId: 'zme-client',
    tokenEndpointAuthMethod: 'none' as const,
    redirectUri: 'https://zme.test/auth/callback',
    allowedAlgorithms: ['ES256'],
    adminSubjects: new Set<string>(),
    legacyBindings: new Map<string, string>(),
  }
  return {
    issuer,
    accessToken,
    proofJti,
    proofThumbprint,
    request,
    fetch,
    config: { appOrigin: 'https://zme.test', resourceUrl, oidc } satisfies AppConfig,
  }
}

async function signingKey() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const kid = crypto.randomUUID()
  return { privateKey, kid, publicJwk: { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' } }
}

async function accessTokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return btoa(String.fromCharCode(...digest))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}
