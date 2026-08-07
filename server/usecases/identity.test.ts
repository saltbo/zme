import type { AppConfig } from '@server/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginOidcLogin,
  completeOidcLogin,
  endLocalSession,
  getLocalSession,
  hashSecret,
  type IdentityRepo,
  type LocalSession,
  type LoginTransaction,
  type OidcClient,
  safeReturnTo,
} from './identity'

const now = new Date('2026-08-04T12:00:00.000Z')
const profile = {
  issuer: 'https://identity.example',
  subject: 'subject-1',
  name: 'Ada',
  email: 'ada@example.test',
  image: null,
}
const user = { id: 'old-user-1', role: 'admin' as const, ...profile }

describe('external OIDC identity orchestration', () => {
  let transactions: LoginTransaction[]
  let sessions: LocalSession[]
  let sessionHashes: string[]
  let sessionIdTokens: string[]
  let deletedHashes: string[]
  let repo: IdentityRepo
  let oidc: OidcClient

  beforeEach(() => {
    transactions = []
    sessions = []
    sessionHashes = []
    sessionIdTokens = []
    deletedHashes = []
    repo = {
      createLoginTransaction: async (transaction) => {
        transactions.push(transaction)
      },
      consumeLoginTransaction: async (stateHash) => {
        const index = transactions.findIndex((transaction) => transaction.stateHash === stateHash)
        return index < 0 ? null : (transactions.splice(index, 1)[0] ?? null)
      },
      resolveUser: vi.fn(async () => user),
      createSession: async (record) => {
        sessions.push({ id: record.id, expiresAt: record.expiresAt, user })
        sessionHashes.push(record.tokenHash)
        sessionIdTokens.push(record.idToken)
      },
      getSession: async (tokenHash) => (sessionHashes.includes(tokenHash) ? (sessions[0] ?? null) : null),
      deleteSession: async (tokenHash) => {
        deletedHashes.push(tokenHash)
        const index = sessionHashes.indexOf(tokenHash)
        return index < 0 ? null : (sessionIdTokens[index] ?? null)
      },
      recordDpopProof: async () => true,
    }
    oidc = {
      createAuthorizationRequest: vi.fn(async (state, nonce, verifier) => {
        const url = new URL('https://identity.example/authorize')
        url.search = new URLSearchParams({ state, nonce, verifier }).toString()
        return url
      }),
      exchangeCallback: vi.fn(async () => ({ profile, idToken: 'validated-id-token' })),
      createLogoutUrl: async () => null,
    }
  })

  it('creates a ten-minute one-time transaction with state, nonce, and a high-entropy verifier', async () => {
    const result = await beginOidcLogin(repo, oidc, '/movies/550', now)
    const transaction = transactions[0]

    expect(transaction).toMatchObject({
      returnTo: '/movies/550',
      createdAt: now.toISOString(),
      expiresAt: '2026-08-04T12:10:00.000Z',
    })
    expect(transaction?.stateHash).toBe(await hashSecret(result.state))
    expect(transaction?.nonce.length).toBeGreaterThan(30)
    expect(transaction?.codeVerifier.length).toBeGreaterThan(60)
    expect(result.authorizationUrl.searchParams.get('state')).toBe(result.state)
  })

  it('binds only the configured issuer/subject and creates a twelve-hour hashed session [spec: auth/configured-admin]', async () => {
    const login = await beginOidcLogin(repo, oidc, '/library?kind=movie', now)
    const result = await completeOidcLogin(
      repo,
      oidc,
      config({ legacyBindings: new Map([['https://identity.example|subject-1', 'old-user-1']]) }),
      new URL(`https://zme.example/auth/callback?code=code&state=${login.state}`),
      login.state,
      now,
    )

    expect(repo.resolveUser).toHaveBeenCalledWith(profile, 'old-user-1', true, true, now.toISOString())
    expect(result.returnTo).toBe('/library?kind=movie')
    expect(result.session).toMatchObject({ expiresAt: '2026-08-05T00:00:00.000Z', user })
    expect(sessionIdTokens).toEqual(['validated-id-token'])
    expect(await getLocalSession(repo, result.sessionToken, now)).toEqual(result.session)
    expect(sessions).toHaveLength(1)
  })

  it('consumes a login transaction once and refuses a replay', async () => {
    const login = await beginOidcLogin(repo, oidc, '/', now)
    await completeOidcLogin(repo, oidc, config(), new URL('https://zme.example/auth/callback'), login.state, now)
    await expect(
      completeOidcLogin(repo, oidc, config(), new URL('https://zme.example/auth/callback'), login.state, now),
    ).rejects.toThrow(/missing, expired, or already used/)
  })

  it('hashes session revocation and never passes the opaque token to persistence', async () => {
    sessionHashes.push(await hashSecret('session-token'))
    sessionIdTokens.push('validated-id-token')
    await expect(endLocalSession(repo, 'session-token')).resolves.toBe('validated-id-token')
    expect(deletedHashes).toEqual([await hashSecret('session-token')])
    expect(deletedHashes).not.toContain('session-token')
  })

  it.each([
    [null, '/'],
    ['', '/'],
    ['https://attacker.example/path', '/'],
    ['//attacker.example/path', '/'],
    ['/auth/callback', '/'],
    ['/movies/550?tab=cast#person-1', '/movies/550?tab=cast#person-1'],
  ])('normalizes return target %s to %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })
})

function config(oidcOverride: Partial<AppConfig['oidc']> = {}): AppConfig {
  return {
    appOrigin: 'https://zme.example',
    resourceUrl: 'https://zme.example/api',
    oidc: {
      issuer: profile.issuer,
      clientId: 'zme',
      tokenEndpointAuthMethod: 'none',
      redirectUri: 'https://zme.example/auth/callback',
      postLogoutRedirectUri: 'https://zme.example/login',
      allowedAlgorithms: ['ES256'],
      adminSubjects: new Set(['https://identity.example|subject-1']),
      legacyBindings: new Map(),
      ...oidcOverride,
    },
  }
}
