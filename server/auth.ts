import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth/minimal'
import { admin } from 'better-auth/plugins'
import { createDb } from './db/client'
import * as schema from './db/schema'
import type { Env } from './env'

export function createAuth(env: Env, request: Request) {
  const url = new URL(request.url)
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is not configured.')
  }

  return betterAuth({
    baseURL: url.origin,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(createDb(env), {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>
export type AuthUser = NonNullable<AuthSession>['user']
