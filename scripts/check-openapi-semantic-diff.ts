import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '../server/config'
import { openapiDocument } from '../server/http/openapi'

const baselinePath = join(process.cwd(), 'docs/quality/openapi-operation-baseline.json')
const config: AppConfig = {
  appOrigin: 'https://zme.example.test',
  resourceUrl: 'https://zme.example.test/api',
  oidc: {
    issuer: 'https://identity.example.test',
    clientId: 'zme-contract',
    tokenEndpointAuthMethod: 'none',
    redirectUri: 'https://zme.example.test/auth/callback',
    allowedAlgorithms: ['ES256'],
    adminSubjects: new Set(),
    legacyBindings: new Map(),
  },
}

const document = openapiDocument(config)
const rendered = `${JSON.stringify(document, null, 2)}\n`

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, rendered)
  console.log(`Updated ${baselinePath}`)
} else {
  const baseline = readFileSync(baselinePath, 'utf8')
  if (baseline !== rendered) {
    console.error('OpenAPI semantic signature changed. Review compatibility/release notes, then run pnpm openapi:baseline:update.')
    process.exit(1)
  }
  console.log(`OpenAPI semantic signature matches the complete reviewed contract.`)
}
