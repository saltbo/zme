import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import type { AuthenticatedUser, IdentityRepo } from '@server/usecases/identity'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './context'
import { requireAuthMiddleware } from './middleware'

const env = {
  PUBLIC_APP_ORIGIN: 'https://zme.test',
  OIDC_ISSUER: 'https://issuer.zme.test',
  OIDC_CLIENT_ID: 'zme-client',
  OIDC_ADMIN_SUBJECTS: 'admin-subject',
} as unknown as Env

const user: AuthenticatedUser = {
  id: 'user-1',
  issuer: 'https://issuer.zme.test',
  subject: 'subject-1',
  name: 'User',
  email: null,
  image: null,
  role: 'user',
}

describe('DPoP authentication middleware failures', () => {
  it.each([
    ['validator', () => failingDeps({ validator: new Error('validator unavailable') })],
    ['replay store', () => failingDeps({ replay: new Error('database unavailable') })],
    ['identity projection', () => failingDeps({ identity: new Error('database unavailable') })],
  ] as const)('preserves an unexpected %s failure as a server error', async (_name, createDeps) => {
    const response = await middlewareApp(createDeps()).request('/api/media', {
      headers: { authorization: 'DPoP token', dpop: 'proof' },
    })

    expect(response.status).toBe(500)
    expect(response.headers.has('www-authenticate')).toBe(false)
  })

  it('does not convert a downstream handler failure into an authentication error', async () => {
    const response = await middlewareApp(failingDeps()).request('/api/media', {
      headers: { authorization: 'DPoP token', dpop: 'proof' },
    })

    expect(response.status).toBe(500)
    expect(response.headers.has('www-authenticate')).toBe(false)
  })
})

function middlewareApp(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.use('*', requireAuthMiddleware)
  app.get('/api/media', () => {
    throw new Error('handler failed')
  })
  app.onError(() => new Response(null, { status: 500 }))
  return {
    request(path: string, init: RequestInit) {
      return app.fetch(new Request(`https://zme.test${path}`, init), env)
    },
  }
}

function failingDeps(failures: { validator?: Error; replay?: Error; identity?: Error } = {}): Deps {
  const identityRepo = {
    async recordDpopProof() {
      if (failures.replay) throw failures.replay
      return true
    },
    async resolveUser() {
      if (failures.identity) throw failures.identity
      return user
    },
  } as unknown as IdentityRepo
  return {
    identityRepo,
    dpopTokenValidator: {
      async validate() {
        if (failures.validator) throw failures.validator
        return {
          issuer: user.issuer,
          subject: user.subject,
          scopes: ['media:read'],
          actor: { sub: 'agent-1' },
          proofJti: crypto.randomUUID(),
          keyThumbprint: 'thumbprint',
          replayExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        }
      },
    },
  } as unknown as Deps
}
