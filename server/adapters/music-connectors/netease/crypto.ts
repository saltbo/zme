import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { XeapiPublicKey } from './types'

const WEAPI_IV = '0102030405060708'
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud'
const EAPI_KEY = 'e82ckenh8dichen8'
const XEAPI_STATIC_KEY = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex')
const XEAPI_SIGN_KEY = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g=='
const ANONYMOUS_ID_XOR_KEY = '3go8&$8*3*3h0k(2)2'
const WEAPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
const SECRET_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function encryptEapi(path: string, data: Record<string, unknown>): string {
  const text = JSON.stringify(data)
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
  const plaintext = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, new Uint8Array(0))
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase()
}

export async function encryptWeapi(data: Record<string, unknown>): Promise<{ params: string; encSecKey: string }> {
  const secretKey = randomSecret()
  const firstPass = await aesCbcEncrypt(JSON.stringify(data), WEAPI_PRESET_KEY)
  const params = await aesCbcEncrypt(firstPass, secretKey)
  const reversed = new TextEncoder().encode([...secretKey].reverse().join(''))
  const padded = new Uint8Array(128)
  padded.set(reversed, padded.length - reversed.length)
  const encSecKey = publicEncrypt({ key: WEAPI_PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex')
  return { params, encSecKey }
}

export async function encryptXeapi(data: Record<string, string>, publicKey: XeapiPublicKey) {
  const body = new URLSearchParams(data).toString()
  const plaintext = Buffer.from(JSON.stringify({ body: Buffer.from(body).toString('base64'), queryString: 'e_r=true' }))
  const dynamicKey = randomBytes(16)
  const firstPass = aesEcbEncrypt(XEAPI_STATIC_KEY, plaintext)
  const transformed = transformXeapiCiphertext(firstPass)
  return {
    B: aesEcbEncrypt(dynamicKey, transformed).toString('base64'),
    S: (await encryptXeapiSessionKey(dynamicKey, publicKey)).toString('base64'),
    R: aesEcbEncrypt(XEAPI_STATIC_KEY, Buffer.from(`${publicKey.version}|`)).toString('base64'),
  }
}

export function decryptXeapiResponse(value: ArrayBuffer): string {
  const decrypted = aesEcbDecrypt(EAPI_KEY, Buffer.from(value))
  const payload = decrypted[0] === 0x1f && decrypted[1] === 0x8b ? gunzipSync(decrypted) : decrypted
  return payload.toString()
}

export function decryptXeapiPublicKey(value: string): string {
  return aesEcbDecrypt(XEAPI_STATIC_KEY, Buffer.from(value, 'base64')).toString()
}

export function encodeAnonymousUsername(deviceId: string): string {
  let xored = ''
  for (let index = 0; index < deviceId.length; index += 1) {
    xored += String.fromCharCode(
      deviceId.charCodeAt(index) ^ ANONYMOUS_ID_XOR_KEY.charCodeAt(index % ANONYMOUS_ID_XOR_KEY.length),
    )
  }
  const digest = createHash('md5').update(xored).digest('base64')
  return Buffer.from(`${deviceId} ${digest}`).toString('base64')
}

export function signXeapi(timestamp: string, nonce: string): string {
  return createHmac('sha256', XEAPI_SIGN_KEY)
    .update(timestamp + nonce)
    .digest('base64')
}

export function randomHex(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomDeviceId(): string {
  return randomHex(26).toUpperCase()
}

export function randomDigits(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((value) => String(value % 10)).join('')
}

async function encryptXeapiSessionKey(dynamicKey: Buffer, publicKey: XeapiPublicKey): Promise<Buffer> {
  const peerKey = await crypto.subtle.importKey(
    'raw',
    Buffer.from(publicKey.publicKey, 'base64'),
    { name: 'X25519' },
    false,
    [],
  )
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
  const ephemeralRaw = Buffer.from(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const sharedSecret = Buffer.from(
    await crypto.subtle.deriveBits({ name: 'X25519', public: peerKey }, ephemeral.privateKey, 256),
  )
  const prk = createHmac('sha256', Buffer.alloc(32)).update(sharedSecret).digest()
  const aesKey = createHmac('sha256', prk)
    .update(Buffer.concat([ephemeralRaw, Buffer.from([1])]))
    .digest()
    .subarray(0, 16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv)
  const plaintext = Buffer.from(`${dynamicKey.toString('base64')}|android|${publicKey.sk}`)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([ephemeralRaw, iv, encrypted, cipher.getAuthTag()])
}

function transformXeapiCiphertext(ciphertext: Buffer): Buffer {
  const random = randomBytes(16)
  const xored = Buffer.alloc(ciphertext.length)
  for (let index = 0; index < ciphertext.length; index += 1) xored[index] = ciphertext[index] ^ random[index & 0x0f]
  const encoded = Buffer.from(xored.toString('base64'))
  const rotation = encoded.length ? (random[0] & 0x0f) % encoded.length : 0
  return Buffer.concat([random, encoded.subarray(rotation), encoded.subarray(0, rotation)])
}

function aesEcbEncrypt(key: string | Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv(`aes-${Buffer.byteLength(key) * 8}-ecb`, key, new Uint8Array(0))
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function aesEcbDecrypt(key: string | Buffer, ciphertext: Buffer): Buffer {
  const decipher = createDecipheriv(`aes-${Buffer.byteLength(key) * 8}-ecb`, key, new Uint8Array(0))
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

async function aesCbcEncrypt(value: string, keyValue: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyValue), 'AES-CBC', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(WEAPI_IV) },
    key,
    new TextEncoder().encode(value),
  )
  return toBase64(new Uint8Array(encrypted))
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => SECRET_CHARACTERS[byte % SECRET_CHARACTERS.length]).join('')
}

function toBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}
