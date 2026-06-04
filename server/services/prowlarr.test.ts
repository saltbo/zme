import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchProwlarr } from './prowlarr'

describe('searchProwlarr', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves Prowlarr proxy download urls before returning results', async () => {
    const proxyUrl = 'https://prowlarr.local/11/download?apikey=secret&link=encoded&file=release.torrent'
    const magnetUrl = 'magnet:?xt=urn:btih:abc'
    const fetch = vi.fn().mockImplementation((url: URL | string) => {
      const value = url.toString()
      if (value.includes('/api/v1/search')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                title: 'Release',
                downloadUrl: proxyUrl,
              },
            ]),
            { status: 200 },
          ),
        )
      }

      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: magnetUrl },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })

    expect(results).toHaveLength(1)
    expect(results[0].downloadUrl).toBeNull()
    expect(results[0].magnetUrl).toBe(magnetUrl)
    expect(results[0].id).toBe(magnetUrl)
    expect(JSON.stringify(results)).not.toContain('apikey=secret')
  })

  it('resolves Prowlarr proxy urls returned in the magnet field', async () => {
    const proxyUrl = 'https://prowlarr.local/1/download?apikey=secret&link=encoded&file=release.torrent'
    const magnetUrl = 'magnet:?xt=urn:btih:def'
    const fetch = vi.fn().mockImplementation((url: URL | string) => {
      const value = url.toString()
      if (value.includes('/api/v1/search')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                title: 'Release',
                magnetUrl: proxyUrl,
              },
            ]),
            { status: 200 },
          ),
        )
      }

      return Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { location: magnetUrl },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })

    expect(results[0].downloadUrl).toBeNull()
    expect(results[0].magnetUrl).toBe(magnetUrl)
    expect(JSON.stringify(results)).not.toContain('apikey=secret')
    expect(JSON.stringify(results)).not.toContain('/download?')
  })
})
