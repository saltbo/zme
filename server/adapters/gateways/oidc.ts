import type { AppConfig } from '@server/config'
import type { DpopTokenPrincipal, DpopTokenValidator, OidcClient, OidcProfile } from '@server/usecases/identity'
import { DpopCredentialError } from '@server/usecases/identity'
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose'
import * as oauth from 'oauth4webapi'

const discoveryCache = new Map<string, { metadata: oauth.AuthorizationServer; expiresAt: number }>()
const jwksCaches = new Map<string, oauth.JWKSCacheInput>()
const accessTokenJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function createOidcClient(config: AppConfig['oidc']): OidcClient {
  const client: oauth.Client = { client_id: config.clientId }
  return {
    async createAuthorizationRequest(state, nonce, codeVerifier) {
      const metadata = await discover(config.issuer)
      if (!metadata.authorization_endpoint) throw new Error('OIDC discovery omitted authorization_endpoint.')
      if (!metadata.code_challenge_methods_supported?.includes('S256')) {
        throw new Error('The OIDC provider does not advertise PKCE S256 support.')
      }
      const url = new URL(metadata.authorization_endpoint)
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      }).toString()
      return url
    },

    async exchangeCallback(callbackUrl, expectedState, nonce, codeVerifier) {
      const metadata = await discover(config.issuer)
      const parameters = oauth.validateAuthResponse(metadata, client, callbackUrl, expectedState)
      const response = await oauth.authorizationCodeGrantRequest(
        metadata,
        client,
        clientAuthentication(config),
        parameters,
        config.redirectUri,
        codeVerifier,
        {
          [oauth.customFetch]: timedFetch,
          [oauth.allowInsecureRequests]: isLocalIssuer(config.issuer),
        },
      )
      const tokens = await oauth.processAuthorizationCodeResponse(metadata, client, response, {
        expectedNonce: nonce,
        requireIdToken: true,
      })
      if (!tokens.id_token) throw new Error('The OIDC token response omitted an ID token.')
      const header = decodeProtectedHeader(tokens.id_token)
      if (!header.alg || !config.allowedAlgorithms.includes(header.alg)) {
        throw new Error('The ID token uses an unapproved signature algorithm.')
      }
      const jwksCache = jwksCaches.get(config.issuer) ?? {}
      jwksCaches.set(config.issuer, jwksCache)
      await oauth.validateApplicationLevelSignature(metadata, response, {
        [oauth.jwksCache]: jwksCache,
        [oauth.customFetch]: timedFetch,
        [oauth.allowInsecureRequests]: isLocalIssuer(config.issuer),
      })
      const claims = oauth.getValidatedIdTokenClaims(tokens)
      if (!claims) throw new Error('The validated OIDC response did not contain ID token claims.')

      let source: Record<string, unknown> = claims
      if (metadata.userinfo_endpoint) {
        const userInfoResponse = await oauth.userInfoRequest(metadata, client, tokens.access_token, {
          [oauth.customFetch]: timedFetch,
          [oauth.allowInsecureRequests]: isLocalIssuer(config.issuer),
        })
        source = await oauth.processUserInfoResponse(metadata, client, claims.sub, userInfoResponse)
      }
      return profileFromClaims(config.issuer, claims.sub, source)
    },

    async createLogoutUrl() {
      const metadata = await discover(config.issuer)
      if (!metadata.end_session_endpoint) return null
      const url = new URL(metadata.end_session_endpoint)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirectUri)
      return url
    },
  }
}

export function createDpopTokenValidator(config: AppConfig): DpopTokenValidator {
  return {
    validate(request) {
      return validateDpopRequest(config, request)
    },
  }
}

export async function validateDpopRequest(config: AppConfig, request: Request): Promise<DpopTokenPrincipal> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('DPoP ') || authorization.slice(5).trim().includes(' ')) {
    throw new Error('A DPoP access token is required.')
  }
  const proof = request.headers.get('dpop')
  if (!proof) throw new Error('A DPoP proof is required.')
  const metadata = await discover(config.oidc.issuer)
  const accessToken = authorization.slice(5)
  try {
    const jwks = accessTokenJwks.get(config.oidc.issuer) ?? createAccessTokenJwks(metadata)
    accessTokenJwks.set(config.oidc.issuer, jwks)
    const verified = await jwtVerify(accessToken, jwks, {
      issuer: config.oidc.issuer,
      audience: config.resourceUrl,
      algorithms: config.oidc.allowedAlgorithms,
      typ: 'at+jwt',
      requiredClaims: ['sub', 'iat', 'jti', 'client_id', 'cnf', 'exp'],
    })
    const now = Math.floor(Date.now() / 1000)
    if (!Number.isInteger(verified.payload.iat) || (verified.payload.iat as number) > now + 60) {
      throw new Error('Invalid issued-at claim.')
    }
    if (
      !verified.payload.act ||
      typeof verified.payload.act !== 'object' ||
      typeof (verified.payload.act as Record<string, unknown>).sub !== 'string'
    ) {
      throw new Error('Missing acting Agent subject.')
    }
  } catch (cause) {
    throw new DpopCredentialError('invalid_token', 'The access token is invalid.', { cause })
  }
  const jwksCache = jwksCaches.get(config.oidc.issuer) ?? {}
  jwksCaches.set(config.oidc.issuer, jwksCache)
  let claims: oauth.JWTAccessTokenClaims
  try {
    claims = await oauth.validateJwtAccessToken(metadata, request, config.resourceUrl, {
      requireDPoP: true,
      signingAlgorithms: config.oidc.allowedAlgorithms,
      [oauth.jwksCache]: jwksCache,
      [oauth.customFetch]: timedFetch,
      [oauth.allowInsecureRequests]: isLocalIssuer(config.oidc.issuer),
    })
  } catch (cause) {
    throw new DpopCredentialError('invalid_dpop_proof', 'The DPoP proof is invalid.', { cause })
  }
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(claims.iat) || (claims.iat as number) > now + 60) {
    throw new Error('The DPoP access token has an invalid issued-at claim.')
  }
  if (
    !claims.act ||
    typeof claims.act !== 'object' ||
    typeof (claims.act as Record<string, unknown>).sub !== 'string'
  ) {
    throw new Error('The resource token omitted the acting Agent subject.')
  }
  const proofHeader = decodeProtectedHeader(proof)
  const proofClaims = decodeJwt(proof)
  if (!proofHeader.jwk || typeof proofClaims.jti !== 'string' || !Number.isInteger(proofClaims.iat)) {
    throw new Error('The validated DPoP proof omitted replay protection claims.')
  }
  return {
    issuer: claims.iss,
    subject: claims.sub,
    scopes: typeof claims.scope === 'string' ? [...new Set(claims.scope.split(' ').filter(Boolean))] : [],
    actor: { sub: (claims.act as Record<string, unknown>).sub as string },
    proofJti: proofClaims.jti,
    keyThumbprint: await calculateJwkThumbprint(proofHeader.jwk),
    replayExpiresAt: new Date(((proofClaims.iat as number) + 300) * 1000).toISOString(),
  }
}

function createAccessTokenJwks(metadata: oauth.AuthorizationServer) {
  if (!metadata.jwks_uri) throw new Error('OIDC discovery omitted jwks_uri.')
  return createRemoteJWKSet(new URL(metadata.jwks_uri), { [customFetch]: timedFetch })
}

async function discover(issuer: string): Promise<oauth.AuthorizationServer> {
  const cached = discoveryCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) return cached.metadata
  const response = await oauth.discoveryRequest(new URL(issuer), {
    [oauth.customFetch]: timedFetch,
    [oauth.allowInsecureRequests]: isLocalIssuer(issuer),
  })
  const metadata = await oauth.processDiscoveryResponse(new URL(issuer), response)
  if (!metadata.token_endpoint || !metadata.jwks_uri)
    throw new Error('OIDC discovery omitted token_endpoint or jwks_uri.')
  discoveryCache.set(issuer, { metadata, expiresAt: Date.now() + 5 * 60_000 })
  return metadata
}

function clientAuthentication(config: AppConfig['oidc']): oauth.ClientAuth {
  if (config.tokenEndpointAuthMethod === 'client_secret_basic')
    return oauth.ClientSecretBasic(config.clientSecret as string)
  if (config.tokenEndpointAuthMethod === 'client_secret_post')
    return oauth.ClientSecretPost(config.clientSecret as string)
  return oauth.None()
}

function profileFromClaims(issuer: string, subject: string, claims: Record<string, unknown>): OidcProfile {
  return {
    issuer,
    subject,
    name: stringClaim(claims.name) ?? stringClaim(claims.preferred_username) ?? subject,
    email: stringClaim(claims.email),
    image: stringClaim(claims.picture),
  }
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = AbortSignal.any([init?.signal ?? new AbortController().signal, AbortSignal.timeout(10_000)])
  return fetch(input, { ...init, signal })
}

function isLocalIssuer(issuer: string): boolean {
  const url = new URL(issuer)
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localtest.me'))
  )
}
