const VERSION = 'v1'

export function validateConnectorCredentialsSecret(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('CONNECTOR_CREDENTIALS_SECRET must be at least 32 characters.')
  }
}

export async function encryptConnectorCredentials(secret: string, value: string[]): Promise<string> {
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptConnectorCredentials(secret: string, envelope: string): Promise<string[]> {
  const [version, ivValue, ciphertextValue, extra] = envelope.split('.')
  if (version !== VERSION || !ivValue || !ciphertextValue || extra !== undefined) {
    throw new Error('Connector credentials have an unsupported format.')
  }
  const key = await importKey(secret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivValue) },
    key,
    fromBase64(ciphertextValue),
  )
  const value = JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Connector credentials are invalid.')
  }
  return value
}

async function importKey(secret: string) {
  validateConnectorCredentialsSecret(secret)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer
}
