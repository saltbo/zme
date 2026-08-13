import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Env } from '@server/env'
import worker from '@server/worker'
import { describe, expect, it, vi } from 'vitest'

const executionContext = {
  passThroughOnException: vi.fn(),
  waitUntil: vi.fn(),
} as unknown as ExecutionContext

function createEnv() {
  const assetsFetch = vi.fn(async () => new Response('frontend asset'))
  const env = {
    ASSETS: { fetch: assetsFetch },
    PUBLIC_APP_ORIGIN: 'https://zme.test',
    OIDC_ISSUER: 'https://issuer.zme.test',
    OIDC_CLIENT_ID: 'zme-test-client',
    OIDC_ADMIN_SUBJECTS: 'admin-subject',
    OIDC_LEGACY_BINDINGS_JSON: '[]',
  } as unknown as Env

  return { assetsFetch, env }
}

describe('worker fetch routing', () => {
  it('publishes the verifiable ZME Skill archive as a direct static asset [spec: auth/agent-skill-discovery]', () => {
    const directory = path.join(process.cwd(), 'public', '.well-known', 'agent-skills')
    const indexBytes = readFileSync(path.join(directory, 'index.json'))
    const archiveBytes = readFileSync(path.join(directory, 'use-zme.tar.gz'))
    const wranglerConfig = readFileSync(path.join(process.cwd(), 'wrangler.toml'), 'utf8')
    const index = JSON.parse(indexBytes.toString()) as {
      $schema: string
      skills: Array<{ name: string; type: string; url: string; digest: string }>
    }

    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(index.skills).toEqual([
      expect.objectContaining({
        name: 'use-zme',
        type: 'archive',
        url: '/.well-known/agent-skills/use-zme.tar.gz',
        digest: `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`,
      }),
    ])
    expect(gunzipSync(archiveBytes).includes(Buffer.from('SKILL.md'))).toBe(true)
    expect(wranglerConfig).not.toContain('"/.well-known/agent-skills/*"')
  })

  it('routes protected resource metadata through the application', async () => {
    const { assetsFetch, env } = createEnv()

    const response = await worker.fetch(
      new Request('https://zme.test/.well-known/oauth-protected-resource/api'),
      env,
      executionContext,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resource: 'https://zme.test/api',
      authorization_servers: ['https://issuer.zme.test'],
    })
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('routes frontend paths through the asset binding', async () => {
    const { assetsFetch, env } = createEnv()
    const request = new Request('https://zme.test/library')

    const response = await worker.fetch(request, env, executionContext)

    expect(await response.text()).toBe('frontend asset')
    expect(assetsFetch).toHaveBeenCalledOnce()
    expect(assetsFetch).toHaveBeenCalledWith(request)
  })
})
