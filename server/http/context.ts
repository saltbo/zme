import type { AuthSession, AuthUser } from '@server/auth'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthUser
    session: NonNullable<AuthSession>['session']
    deps: Deps
  }
}
