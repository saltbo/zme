import { env } from 'cloudflare:test'
import { createIdentityRepo } from '@server/adapters/repos/identity'
import { app } from '@server/app'
import { createDb } from '@server/db/client'
import { hashSecret } from '@server/usecases/identity'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { calculatePKCECodeChallenge } from 'oauth4webapi'
import { expect, it, vi } from 'vitest'

it('completes browser OIDC login, establishes a secure local session, and logs out', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'issuer-key-1', alg: 'ES256', use: 'sig' }
  let expectedNonce = ''
  let expectedChallenge = ''
  let issuedIdToken = ''
  let tokenRequests = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer: 'https://issuer.zme.test',
          authorization_endpoint: 'https://issuer.zme.test/authorize',
          token_endpoint: 'https://issuer.zme.test/token',
          jwks_uri: 'https://issuer.zme.test/jwks',
          end_session_endpoint: 'https://issuer.zme.test/logout',
          code_challenge_methods_supported: ['S256'],
          id_token_signing_alg_values_supported: ['ES256'],
        })
      }
      if (url.pathname === '/jwks') return json({ keys: [publicJwk] })
      if (url.pathname === '/token') {
        tokenRequests += 1
        const form = new URLSearchParams(await request.text())
        expect(await calculatePKCECodeChallenge(form.get('code_verifier') ?? '')).toBe(expectedChallenge)
        const now = Math.floor(Date.now() / 1000)
        issuedIdToken = await new SignJWT({ nonce: expectedNonce, name: 'Admin from IdP', email: 'admin@idp.test' })
          .setProtectedHeader({ alg: 'ES256', kid: 'issuer-key-1', typ: 'JWT' })
          .setIssuer('https://issuer.zme.test')
          .setAudience('zme-test-client')
          .setSubject('admin-subject')
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey)
        return json(
          { access_token: 'opaque-access-token', token_type: 'Bearer', expires_in: 300, id_token: issuedIdToken },
          { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
        )
      }
      return new Response(null, { status: 404 })
    }),
  )

  const login = await request('/auth/login?returnTo=%2Flibrary')
  expect(login.status).toBe(302)
  const authorization = new URL(login.headers.get('location') ?? '')
  expectedNonce = authorization.searchParams.get('nonce') ?? ''
  expectedChallenge = authorization.searchParams.get('code_challenge') ?? ''
  expect(expectedNonce).not.toBe('')
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  const state = authorization.searchParams.get('state') ?? ''
  const stateCookie = cookiePair(login.headers.get('set-cookie'))

  const callback = await request(`/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: stateCookie },
  })
  expect(callback.status).toBe(302)
  expect(callback.headers.get('location')).toBe('/library')
  expect(tokenRequests).toBe(1)
  const sessionCookie = cookiePair(callback.headers.get('set-cookie'), '__Host-zme_session')
  expect(callback.headers.get('set-cookie')).toContain('HttpOnly')
  expect(callback.headers.get('set-cookie')).toContain('Secure')
  expect(callback.headers.get('set-cookie')).toContain('SameSite=Lax')

  const session = await request('/auth/session', { headers: { cookie: sessionCookie } })
  expect(await session.json()).toMatchObject({
    user: {
      issuer: 'https://issuer.zme.test',
      subject: 'admin-subject',
      name: 'Admin from IdP',
      email: 'admin@idp.test',
      role: 'admin',
    },
  })

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { cookie: sessionCookie, origin: 'https://zme.test' },
  })
  const logoutBody = (await logout.json()) as { redirectTo: string }
  const providerLogout = new URL(logoutBody.redirectTo)
  expect(providerLogout.origin + providerLogout.pathname).toBe('https://issuer.zme.test/logout')
  expect(providerLogout.searchParams.get('id_token_hint')).toBe(issuedIdToken)
  expect(providerLogout.searchParams.get('client_id')).toBe('zme-test-client')
  expect(providerLogout.searchParams.get('post_logout_redirect_uri')).toBe('https://zme.test/login')
  expect(await (await request('/auth/session', { headers: { cookie: sessionCookie } })).json()).toEqual({ user: null })
})

it('keeps equal email addresses as separate issuer/subject projections [spec: auth/no-email-linking]', async () => {
  const repo = createIdentityRepo(createDb(env))
  const now = new Date().toISOString()
  const first = await repo.resolveUser(
    {
      issuer: 'https://issuer.zme.test',
      subject: 'subject-one',
      name: 'First',
      email: 'same@example.test',
      image: null,
    },
    undefined,
    false,
    true,
    now,
  )
  const second = await repo.resolveUser(
    {
      issuer: 'https://issuer.zme.test',
      subject: 'subject-two',
      name: 'Second',
      email: 'same@example.test',
      image: null,
    },
    undefined,
    false,
    true,
    now,
  )

  expect(second.id).not.toBe(first.id)
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE oidc_email = 'same@example.test'").first(),
  ).toEqual({ total: 2 })
})

it('locally revokes a session created before ID tokens were retained', async () => {
  const repo = createIdentityRepo(createDb(env))
  const now = new Date().toISOString()
  const user = await repo.resolveUser(
    {
      issuer: 'https://issuer.zme.test',
      subject: 'legacy-session-subject',
      name: 'Existing User',
      email: null,
      image: null,
    },
    undefined,
    false,
    true,
    now,
  )
  const sessionToken = 'session-created-before-id-token-storage'
  await env.DB.prepare(
    `INSERT INTO application_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind('legacy-session', await hashSecret(sessionToken), user.id, '2027-01-01T00:00:00.000Z', now, now)
    .run()

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { cookie: `__Host-zme_session=${sessionToken}`, origin: 'https://zme.test' },
  })

  expect(await logout.json()).toEqual({ redirectTo: 'https://zme.test/login' })
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS total FROM application_sessions WHERE id = 'legacy-session'").first(),
  ).toEqual({
    total: 0,
  })
})

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(`https://zme.test${path}`, init), env)
}

function cookiePair(header: string | null, name?: string) {
  const cookies = (header ?? '').split(/,(?=\s*__Host-)/).map((value) => value.trim().split(';')[0])
  const selected = name ? cookies.find((cookie) => cookie.startsWith(`${name}=`)) : cookies[0]
  if (!selected) throw new Error(`Missing ${name ?? 'OIDC state'} cookie.`)
  return selected
}

function json(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}
