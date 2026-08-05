import type { Env } from '@server/env'
import { describe, expect, it } from 'vitest'
import { principalKey, readConfig } from './config'

const validEnv = {
  PUBLIC_APP_ORIGIN: 'https://zme.example',
  OIDC_ISSUER: 'https://identity.example/tenant',
  OIDC_CLIENT_ID: 'zme-client',
  OIDC_ADMIN_SUBJECTS: 'admin-1',
  OIDC_LEGACY_BINDINGS_JSON:
    '[{"issuer":"https://identity.example/tenant","subject":"migrated-1","legacyUserId":"old-user-1"}]',
} as unknown as Env

describe('readConfig', () => {
  it('parses an exact external OIDC deployment and explicit identity bindings', () => {
    const config = readConfig(validEnv)

    expect(config.oidc.adminSubjects).toEqual(new Set([principalKey('https://identity.example/tenant', 'admin-1')]))
    expect(config.oidc.legacyBindings.get(principalKey(config.oidc.issuer, 'migrated-1'))).toBe('old-user-1')
    expect(config.resourceUrl).toBe('https://zme.example/api')
    expect(config.oidc.redirectUri).toBe('https://zme.example/auth/callback')
    expect(config.oidc.postLogoutRedirectUri).toBe('https://zme.example/login')
    expect(config.oidc.tokenEndpointAuthMethod).toBe('none')
    expect(config.oidc.allowedAlgorithms).not.toContain('HS256')
  })

  it.each([
    ['missing administrator allowlist', { OIDC_ADMIN_SUBJECTS: '' }],
    ['insecure non-local issuer', { OIDC_ISSUER: 'http://identity.example' }],
    ['secret on a public client', { OIDC_CLIENT_SECRET: 'secret', OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none' }],
    ['missing confidential-client secret', { OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic' }],
    ['unsupported client authentication', { OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'private_key_jwt' }],
    ['issuer query', { OIDC_ISSUER: 'https://identity.example/tenant?unexpected=true' }],
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

  it('defaults confidential clients to client_secret_basic and accepts an explicit post method', () => {
    const config = readConfig({
      ...validEnv,
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_LEGACY_BINDINGS_JSON: '',
    } as Env)
    expect(config.oidc.tokenEndpointAuthMethod).toBe('client_secret_basic')
    expect(config.oidc.clientSecret).toBe('client-secret')
    expect(config.oidc.legacyBindings.size).toBe(0)

    expect(
      readConfig({
        ...validEnv,
        OIDC_CLIENT_SECRET: 'client-secret',
        OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post',
      } as Env).oidc.tokenEndpointAuthMethod,
    ).toBe('client_secret_post')
  })

  it('preserves an issuer with a significant trailing slash', () => {
    const issuer = 'https://identity.example/tenant/'
    const config = readConfig({
      ...validEnv,
      OIDC_ISSUER: issuer,
      OIDC_ADMIN_SUBJECTS: 'admin-1',
      OIDC_LEGACY_BINDINGS_JSON: '[]',
    } as Env)
    expect(config.oidc.issuer).toBe(issuer)
  })
})
