import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPort = await availablePort()
const oidcPort = await availablePort()
const persistPath = mkdtempSync(join(tmpdir(), 'zme-e2e-'))
const appOrigin = `http://localhost:${appPort}`
const oidcIssuer = `http://localhost:${oidcPort}`
const cloudflareEnv = `e2e-${process.pid}-${Date.now()}`
const devVarsPath = join(process.cwd(), `.dev.vars.${cloudflareEnv}`)
const e2eVars = {
  PUBLIC_APP_ORIGIN: appOrigin,
  OIDC_ISSUER: oidcIssuer,
  OIDC_CLIENT_ID: 'zme-e2e-client',
  OIDC_CLIENT_SECRET: '',
  OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none',
  OIDC_REDIRECT_URI: `${appOrigin}/auth/callback`,
  OIDC_POST_LOGOUT_REDIRECT_URI: `${appOrigin}/login`,
  OIDC_ALLOWED_ALGS: 'ES256',
  OIDC_ADMIN_SUBJECTS: `${oidcIssuer}|e2e-admin`,
  OIDC_LEGACY_BINDINGS_JSON: '[]',
  REALMROOT_ISSUER: '',
  REALMROOT_RESOURCE_URL: `${appOrigin}/api`,
  CONNECTOR_CREDENTIALS_SECRET: 'e2e-independent-connector-secret-32-chars',
  MUSIC_AUTO_TAGGING_ENABLED: 'true',
}

try {
  writeFileSync(
    devVarsPath,
    `${Object.entries(e2eVars)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\n`,
    { flag: 'wx', mode: 0o600 },
  )
  const exitCode = await run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    ...process.env,
    E2E_APP_PORT: String(appPort),
    E2E_OIDC_PORT: String(oidcPort),
    E2E_PERSIST: persistPath,
    CLOUDFLARE_ENV: cloudflareEnv,
    ...e2eVars,
  })
  process.exitCode = exitCode
} finally {
  rmSync(devVarsPath, { force: true })
  rmSync(persistPath, { recursive: true, force: true })
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate an E2E port.'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Playwright was terminated by ${signal}.`))
      else resolve(code ?? 1)
    })
  })
}
