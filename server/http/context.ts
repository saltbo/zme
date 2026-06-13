import type { AuthSession, AuthUser } from '../auth'
import type { Env } from '../env'
import type { Deps } from '../usecases/deps'

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthUser
    session: NonNullable<AuthSession>['session']
    deps: Deps
  }
}
