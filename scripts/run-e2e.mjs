import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPort = await availablePort()
const oidcPort = await availablePort()
const persistPath = mkdtempSync(join(tmpdir(), 'zme-e2e-'))

try {
  const exitCode = await run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    ...process.env,
    E2E_APP_PORT: String(appPort),
    E2E_OIDC_PORT: String(oidcPort),
    E2E_PERSIST: persistPath,
  })
  process.exitCode = exitCode
} finally {
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
