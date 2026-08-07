import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const port = Number(process.env.FAKE_OIDC_PORT ?? 7180)
const issuer = `http://localhost:${port}`
const clientId = 'zme-e2e-client'
const appOrigin = process.env.FAKE_OIDC_APP_ORIGIN ?? 'http://localhost:7171'
const redirectUri = `${appOrigin}/auth/callback`
const codes = new Map()
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'e2e-key-1', alg: 'ES256', use: 'sig' }

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
    return sendJson(response, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      end_session_endpoint: `${issuer}/logout`,
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['ES256'],
    })
  }
  if (request.method === 'GET' && url.pathname === '/jwks') return sendJson(response, { keys: [publicJwk] })
  if (request.method === 'GET' && url.pathname === '/authorize') {
    const valid =
      url.searchParams.get('client_id') === clientId &&
      url.searchParams.get('redirect_uri') === redirectUri &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      url.searchParams.get('scope')?.split(' ').includes('openid')
    const state = url.searchParams.get('state')
    const nonce = url.searchParams.get('nonce')
    const challenge = url.searchParams.get('code_challenge')
    if (!valid || !state || !nonce || !challenge) return sendJson(response, { error: 'invalid_request' }, 400)
    const code = randomUUID()
    codes.set(code, { nonce, challenge })
    response.writeHead(302, {
      location: `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      'set-cookie': 'fake_oidc_session=authenticated; HttpOnly; SameSite=Lax; Path=/',
    })
    return response.end()
  }
  if (request.method === 'POST' && url.pathname === '/token') {
    const form = new URLSearchParams(await readBody(request))
    const code = form.get('code')
    const entry = code ? codes.get(code) : undefined
    const verifier = form.get('code_verifier') ?? ''
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (
      !entry ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('client_id') !== clientId ||
      form.get('redirect_uri') !== redirectUri ||
      challenge !== entry.challenge
    ) {
      return sendJson(response, { error: 'invalid_grant' }, 400)
    }
    codes.delete(code)
    const now = Math.floor(Date.now() / 1000)
    const idToken = await new SignJWT({ nonce: entry.nonce, name: 'E2E OIDC Admin', email: 'e2e-admin@idp.test' })
      .setProtectedHeader({ alg: 'ES256', kid: 'e2e-key-1', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject('e2e-admin')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey)
    return sendJson(
      response,
      { access_token: 'e2e-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken },
      200,
      { 'cache-control': 'no-store', pragma: 'no-cache' },
    )
  }
  if (request.method === 'GET' && url.pathname === '/logout') {
    response.writeHead(302, {
      location: `${appOrigin}/login`,
      'set-cookie': 'fake_oidc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    })
    return response.end()
  }
  sendJson(response, { error: 'not_found' }, 404)
})

server.listen(port, '127.0.0.1', () => process.stdout.write(`Fake OIDC listening on ${issuer}\n`))

function sendJson(response, body, status = 200, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}
