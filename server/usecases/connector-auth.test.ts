import { decryptConnectorPayload, encryptConnectorPayload } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import { describe, expect, it, vi } from 'vitest'
import { continueConnectorLogin, listConnectorProviders, startConnectorLogin } from './connector-auth'
import type { Deps } from './deps'
import type { ConnectorLoginAttemptRecord, ConnectorRecord, MusicConnectorModule } from './ports'

const secret = 'test-connector-secret-with-32-chars!'
const env = { CONNECTOR_CREDENTIALS_SECRET: secret } as Env

function fakeModule(auth: MusicConnectorModule['auth']): MusicConnectorModule {
  return {
    definition: {
      kind: 'fake-music',
      authModes: ['device', 'sms'],
      capabilities: ['music.playlists.read', 'music.tracks.download'],
      dispatchIntervalSeconds: 3,
    },
    auth,
    open: () => {
      throw new Error('Not used by connector auth tests.')
    },
  }
}

describe('connector authentication state machine', () => {
  it('lists provider authentication capabilities without provider-specific routes', () => {
    const module = fakeModule({
      start: async () => ({ status: 'expired' }),
      continue: async () => ({ status: 'expired' }),
    })
    const deps = { musicConnectors: new Map([['fake-music', module]]) } as never as Deps

    expect(listConnectorProviders(deps)).toEqual([
      {
        kind: 'fake-music',
        authModes: ['device', 'sms'],
        capabilities: ['music.playlists.read', 'music.tracks.download'],
      },
    ])
  })

  it('encrypts all provider state created by a login attempt', async () => {
    const created: { record: ConnectorLoginAttemptRecord | null } = { record: null }
    const start = vi.fn(async () => ({
      status: 'pending' as const,
      state: { deviceSecret: 'provider-private-state', phone: '13800138000' },
      challenge: {
        type: 'form' as const,
        action: 'submit_code',
        fields: [{ name: 'code', type: 'text' as const, required: true }],
        expiresAt: '2099-07-20T01:00:00.000Z',
      },
    }))
    const deps = {
      musicConnectors: new Map([['fake-music', fakeModule({ start, continue: async () => ({ status: 'expired' }) })]]),
      connectorLoginAttemptsRepo: {
        create: async (record: ConnectorLoginAttemptRecord) => {
          created.record = record
        },
      },
    } as never as Deps

    const result = await startConnectorLogin(deps, env, 'user-1', {
      kind: 'fake-music',
      method: 'sms',
      input: { phone: '13800138000' },
    })

    expect(start).toHaveBeenCalledWith({ method: 'sms', input: { phone: '13800138000' } })
    expect(result).toMatchObject({
      connector: null,
      attempt: { kind: 'fake-music', method: 'sms', status: 'pending' },
    })
    if (!created.record?.stateEncrypted) throw new Error('Encrypted provider state was not stored.')
    expect(JSON.stringify(created.record)).not.toContain('provider-private-state')
    expect(JSON.stringify(created.record)).not.toContain('13800138000')
    await expect(decryptConnectorPayload(secret, created.record.stateEncrypted)).resolves.toEqual({
      deviceSecret: 'provider-private-state',
      phone: '13800138000',
    })
  })

  it('continues through the owning provider and saves opaque connected credentials', async () => {
    let attempt: ConnectorLoginAttemptRecord = {
      id: 'attempt-1',
      userId: 'user-1',
      kind: 'fake-music',
      method: 'device',
      stateEncrypted: await encryptConnectorPayload(secret, { deviceCode: 'device-1' }),
      challenge: {
        type: 'form',
        action: 'confirm',
        fields: [],
        expiresAt: '2099-07-20T01:00:00.000Z',
      },
      status: 'pending',
      expiresAt: '2099-07-20T01:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    type SaveInput = Parameters<Deps['connectorsRepo']['save']>[2]
    const saved: { input: SaveInput | null } = { input: null }
    const enqueue = vi.fn(async () => undefined)
    const continueAuth = vi.fn(async () => ({
      status: 'connected' as const,
      credentials: { accessToken: 'opaque-provider-token' },
      account: { externalAccountId: 'account-1', displayName: 'Listener', avatarUrl: null },
    }))
    const module = fakeModule({ start: async () => ({ status: 'expired' }), continue: continueAuth })
    const deps = {
      musicConnectors: new Map([['fake-music', module]]),
      connectorLoginAttemptsRepo: {
        get: async () => attempt,
        update: async (_userId: string, _id: string, patch: Partial<ConnectorLoginAttemptRecord>) => {
          attempt = { ...attempt, ...patch }
          return attempt
        },
      },
      connectorsRepo: {
        save: async (userId: string, kind: string, input: SaveInput): Promise<ConnectorRecord> => {
          saved.input = input
          return {
            id: 'connector-1',
            userId,
            kind,
            ...input,
            lastSyncedAt: null,
            lastError: null,
            lastResult: null,
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          }
        },
      },
      connectorSyncQueue: { enqueue },
    } as never as Deps

    const result = await continueConnectorLogin(deps, env, 'user-1', 'attempt-1', {
      action: 'confirm',
      input: { confirmation: 'yes' },
    })

    expect(continueAuth).toHaveBeenCalledWith(
      { deviceCode: 'device-1' },
      { action: 'confirm', input: { confirmation: 'yes' } },
    )
    expect(result).toMatchObject({
      attempt: { status: 'connected', challenge: null },
      connector: { id: 'connector-1', kind: 'fake-music', displayName: 'Listener' },
    })
    expect(attempt.stateEncrypted).toBeNull()
    if (!saved.input?.credentialsEncrypted) throw new Error('Connected credentials were not stored.')
    await expect(decryptConnectorPayload(secret, saved.input.credentialsEncrypted)).resolves.toEqual({
      accessToken: 'opaque-provider-token',
    })
    expect(enqueue).toHaveBeenCalledWith({ userId: 'user-1', connectorId: 'connector-1' })
  })
})
