import type { Env } from '@server/env'
import type { TraceContext } from '@server/observability/trace'
import type { Deps } from '@server/usecases/deps'
import type { AuthenticatedUser } from '@server/usecases/identity'

export type Principal = {
  kind: 'human' | 'agent'
  userId: string
  issuer: string
  subject: string
  role: 'admin' | 'user'
  scopes: string[]
  actor?: { sub: string }
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthenticatedUser
    principal: Principal
    requestId: string
    trace: TraceContext
    deps: Deps
  }
}
