import type { AuthSession, AuthUser } from '../auth'
import type { Env } from '../env'

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthUser
    session: NonNullable<AuthSession>['session']
  }
}
