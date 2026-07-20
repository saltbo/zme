import { encryptEapi, encryptXeapi } from '@server/adapters/providers/netease'
import { describe, expect, it } from 'vitest'

describe('Netease EAPI crypto in workerd', () => {
  it('encrypts an EAPI payload with AES-128-ECB', () => {
    const encrypted = encryptEapi('/api/test', { value: 'workerd' })

    expect(encrypted).toMatch(/^[0-9A-F]+$/)
    expect(encrypted.length).toBeGreaterThan(0)
  })

  it('encrypts an XEAPI anonymous registration payload', async () => {
    const peer = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', peer.publicKey))

    const encrypted = await encryptXeapi(
      { username: 'anonymous-device' },
      { publicKey: publicKey.toString('base64'), sk: 'test-sk', version: '1' },
    )

    expect(encrypted.B).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(encrypted.S).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(encrypted.R).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})
