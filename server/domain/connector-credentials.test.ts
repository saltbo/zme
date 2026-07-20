import { describe, expect, it } from 'vitest'
import { decryptConnectorCredentials, encryptConnectorCredentials } from './connector-credentials'

const secret = 'test-connector-secret-with-at-least-32-characters'

describe('connector credentials', () => {
  it('round-trips encrypted cookie values without exposing plaintext', async () => {
    const cookies = ['MUSIC_U=session-value', '__csrf=csrf-value']
    const encrypted = await encryptConnectorCredentials(secret, cookies)

    expect(encrypted).toMatch(/^v1\./)
    expect(encrypted).not.toContain('session-value')
    await expect(decryptConnectorCredentials(secret, encrypted)).resolves.toEqual(cookies)
  })

  it('rejects tampered credential envelopes', async () => {
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const tampered = `${encrypted.slice(0, -2)}aa`

    await expect(decryptConnectorCredentials(secret, tampered)).rejects.toThrow()
  })

  it('requires an independent secret with at least 32 characters', async () => {
    await expect(encryptConnectorCredentials('too-short', [])).rejects.toThrow(
      'CONNECTOR_CREDENTIALS_SECRET must be at least 32 characters.',
    )
  })
})
