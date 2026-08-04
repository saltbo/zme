import type { Env } from '@server/env'
import { describe, expect, it } from 'vitest'
import { principalKey, readConfig } from './config'

const validEnv = {
  PUBLIC_APP_ORIGIN: 'https://zme.example',
  OIDC_ISSUER: 'https://identity.example/tenant',
  OIDC_CLIENT_ID: 'zme-client',
  OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none',
  OIDC_REDIRECT_URI: 'https://zme.example/auth/callback',
  OIDC_POST_LOGOUT_REDIRECT_URI: 'https://zme.example/login',
  OIDC_ALLOWED_ALGS: 'ES256,RS256',
  OIDC_ADMIN_SUBJECTS: 'https://identity.example/tenant|admin-1',
  OIDC_LEGACY_BINDINGS_JSON:
    '[{"issuer":"https://identity.example/tenant","subject":"migrated-1","legacyUserId":"old-user-1"}]',
  REALMROOT_RESOURCE_URL: 'https://zme.example/api',
} as unknown as Env

describe('readConfig', () => {
  it('parses an exact external OIDC deployment and explicit identity bindings', () => {
    const config = readConfig(validEnv)

    expect(config.oidc.adminSubjects).toEqual(new Set([principalKey('https://identity.example/tenant', 'admin-1')]))
    expect(config.oidc.legacyBindings.get(principalKey(config.oidc.issuer, 'migrated-1'))).toBe('old-user-1')
    expect(config.realmrootEnabled).toBe(false)
  })

  it.each([
    ['missing administrator allowlist', { OIDC_ADMIN_SUBJECTS: '' }],
    ['insecure non-local issuer', { OIDC_ISSUER: 'http://identity.example' }],
    ['origin-mismatched redirect', { OIDC_REDIRECT_URI: 'https://attacker.example/callback' }],
    ['symmetric ID token algorithm', { OIDC_ALLOWED_ALGS: 'HS256' }],
    ['unknown ID token algorithm', { OIDC_ALLOWED_ALGS: 'not-a-jose-algorithm' }],
    ['secret on a public client', { OIDC_CLIENT_SECRET: 'secret', OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none' }],
    ['missing confidential-client secret', { OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic' }],
    ['unsupported client authentication', { OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'private_key_jwt' }],
    ['issuer query', { OIDC_ISSUER: 'https://identity.example/tenant?unexpected=true' }],
    ['redirect query', { OIDC_REDIRECT_URI: 'https://zme.example/auth/callback?unexpected=true' }],
    ['wrong callback path', { OIDC_REDIRECT_URI: 'https://zme.example/oidc/callback' }],
    ['wrong logout path', { OIDC_POST_LOGOUT_REDIRECT_URI: 'https://zme.example/signed-out' }],
    ['resource URL with the wrong path', { REALMROOT_RESOURCE_URL: 'https://zme.example/resources' }],
    ['Realmroot issuer mismatch', { REALMROOT_ISSUER: 'https://other.example' }],
    ['invalid legacy binding JSON', { OIDC_LEGACY_BINDINGS_JSON: '{' }],
    ['non-array legacy bindings', { OIDC_LEGACY_BINDINGS_JSON: '{}' }],
    ['malformed legacy binding', { OIDC_LEGACY_BINDINGS_JSON: '[{"subject":"subject-1"}]' }],
  ])('fails fast for %s', (_name, override) => {
    expect(() => readConfig({ ...validEnv, ...override } as Env)).toThrow()
  })

  it('rejects duplicate legacy targets so migration cannot merge identities', () => {
    expect(() =>
      readConfig({
        ...validEnv,
        OIDC_LEGACY_BINDINGS_JSON: JSON.stringify([
          { issuer: validEnv.OIDC_ISSUER, subject: 'subject-1', legacyUserId: 'old-user-1' },
          { issuer: validEnv.OIDC_ISSUER, subject: 'subject-2', legacyUserId: 'old-user-1' },
        ]),
      } as Env),
    ).toThrow(/unique/)
  })

  it('enables Realmroot only for the exact configured issuer and accepts confidential client authentication', () => {
    const config = readConfig({
      ...validEnv,
      OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic',
      OIDC_CLIENT_SECRET: 'client-secret',
      REALMROOT_ISSUER: validEnv.OIDC_ISSUER,
      OIDC_LEGACY_BINDINGS_JSON: '',
    } as Env)
    expect(config.realmrootEnabled).toBe(true)
    expect(config.oidc.clientSecret).toBe('client-secret')
    expect(config.oidc.legacyBindings.size).toBe(0)
  })

  it('preserves an issuer with a significant trailing slash', () => {
    const issuer = 'https://identity.example/tenant/'
    const config = readConfig({
      ...validEnv,
      OIDC_ISSUER: issuer,
      OIDC_ADMIN_SUBJECTS: `${issuer}|admin-1`,
      OIDC_LEGACY_BINDINGS_JSON: '[]',
    } as Env)
    expect(config.oidc.issuer).toBe(issuer)
  })
})
