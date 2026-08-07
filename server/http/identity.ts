import { readConfig } from '@server/config'
import {
  beginOidcLogin,
  completeOidcLogin,
  endLocalSession,
  getLocalSession,
  OidcCallbackError,
  safeReturnTo,
} from '@server/usecases/identity'
import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from './context'

export const SESSION_COOKIE = '__Host-zme_session'
export const OIDC_STATE_COOKIE = '__Host-zme_oidc_state'
// Remove after Realmroot end-session expires both Better Auth session cookies.
export const FORCE_PROVIDER_LOGIN_COOKIE = '__Host-zme_force_provider_login'

export function registerIdentityRoutes(app: Hono<AppEnv>) {
  app.get('/auth/login', async (c) => {
    const forceProviderLogin = getCookie(c, FORCE_PROVIDER_LOGIN_COOKIE) === '1'
    const result = await beginOidcLogin(
      c.get('deps').identityRepo,
      c.get('deps').oidcClient,
      safeReturnTo(c.req.query('returnTo') ?? null),
      forceProviderLogin,
    )
    if (forceProviderLogin) deleteCookie(c, FORCE_PROVIDER_LOGIN_COOKIE, clearCookie())
    setCookie(c, OIDC_STATE_COOKIE, result.state, transactionCookie())
    return c.redirect(result.authorizationUrl.toString(), 302)
  })

  app.get('/auth/callback', async (c) => {
    const config = readConfig(c.env)
    const callback = new URL(c.req.url)
    const state = callback.searchParams.get('state')
    const cookieState = getCookie(c, OIDC_STATE_COOKIE)
    deleteCookie(c, OIDC_STATE_COOKIE, clearCookie())
    if (!state || !cookieState || state !== cookieState) return callbackFailure(c, 'state_mismatch')
    try {
      const result = await completeOidcLogin(
        c.get('deps').identityRepo,
        c.get('deps').oidcClient,
        config,
        callback,
        state,
      )
      setCookie(c, SESSION_COOKIE, result.sessionToken, sessionCookie(result.session.expiresAt))
      return c.redirect(result.returnTo, 302)
    } catch (error) {
      if (!(error instanceof OidcCallbackError)) throw error
      console.error(
        JSON.stringify({
          event: 'identity.oidc_callback.failed',
          errorClass: error instanceof Error ? error.name : 'UnknownError',
          causeClass: error.cause instanceof Error ? error.cause.name : undefined,
        }),
      )
      setCookie(c, FORCE_PROVIDER_LOGIN_COOKIE, '1', transactionCookie())
      return callbackFailure(c, 'oidc_callback_failed')
    }
  })

  app.get('/auth/session', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const token = getCookie(c, SESSION_COOKIE)
    if (!token) return c.json({ user: null })
    const session = await getLocalSession(c.get('deps').identityRepo, token)
    if (!session) {
      deleteCookie(c, SESSION_COOKIE, clearCookie())
      return c.json({ user: null })
    }
    return c.json({ user: session.user, expiresAt: session.expiresAt })
  })

  app.post('/auth/logout', async (c) => {
    const config = readConfig(c.env)
    if (c.req.header('Origin') !== config.appOrigin) return c.body(null, 403)
    const token = getCookie(c, SESSION_COOKIE)
    const idTokenHint = token ? await endLocalSession(c.get('deps').identityRepo, token) : null
    deleteCookie(c, SESSION_COOKIE, clearCookie())
    setCookie(c, FORCE_PROVIDER_LOGIN_COOKIE, '1', transactionCookie())
    const providerLogout = idTokenHint ? await c.get('deps').oidcClient.createLogoutUrl(idTokenHint) : null
    return c.json({ redirectTo: providerLogout?.toString() ?? config.oidc.postLogoutRedirectUri })
  })
}

function callbackFailure(c: Context<AppEnv>, code: string) {
  return c.redirect(`/login?error=${encodeURIComponent(code)}`, 302)
}

function transactionCookie() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 600,
  }
}

function sessionCookie(expiresAt: string) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    path: '/',
    expires: new Date(expiresAt),
  }
}

function clearCookie() {
  return { ...transactionCookie(), maxAge: 0 }
}
