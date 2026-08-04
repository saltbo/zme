import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { AppConfig } from '../server/config'
import { openapiDocument } from '../server/http/openapi'

const config: AppConfig = {
  appOrigin: 'https://zme.example.test',
  resourceUrl: 'https://zme.example.test/api',
  realmrootEnabled: true,
  oidc: {
    issuer: 'https://id.realmroot.example.test',
    clientId: 'zme-openapi-lint',
    tokenEndpointAuthMethod: 'none',
    redirectUri: 'https://zme.example.test/auth/callback',
    postLogoutRedirectUri: 'https://zme.example.test/login',
    allowedAlgorithms: ['ES256'],
    adminSubjects: new Set(),
    legacyBindings: new Map(),
  },
}

const directory = mkdtempSync(join(tmpdir(), 'zme-openapi-'))
const documentPath = join(directory, 'openapi.json')
try {
  writeFileSync(documentPath, JSON.stringify(openapiDocument(config)))
  const result = spawnSync('redocly', ['lint', documentPath, '--extends', 'recommended-strict'], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true })
}
