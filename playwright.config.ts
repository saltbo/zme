import { defineConfig, devices } from '@playwright/test'
import { API_VERSION } from './shared/api'

const appPort = requiredPort('E2E_APP_PORT')
const oidcPort = requiredPort('E2E_OIDC_PORT')
const baseURL = `http://localhost:${appPort}`
const persistPath = required('E2E_PERSIST')

// E2E runs against the real stack: vite dev serves the SPA + the Worker against
// an isolated local D1 (E2E_PERSIST) and a protocol-faithful local OIDC issuer.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    extraHTTPHeaders: { 'API-Version': API_VERSION },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `FAKE_OIDC_PORT=${oidcPort} FAKE_OIDC_APP_ORIGIN=${baseURL} pnpm e2e:provider`,
      url: `http://localhost:${oidcPort}/.well-known/openid-configuration`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `E2E_APP_PORT=${appPort} E2E_OIDC_PORT=${oidcPort} E2E_PERSIST=${persistPath} pnpm e2e:server`,
      url: `${baseURL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set by scripts/run-e2e.mjs.`)
  return value
}

function requiredPort(name: string): number {
  const value = Number(required(name))
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} must be a valid port.`)
  return value
}
