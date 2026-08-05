import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchProwlarr } from './prowlarr'

describe('searchProwlarr', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('strips Prowlarr API keys from proxy download urls before returning results', async () => {
    const proxyUrl = 'http://127.0.0.1:9696/11/download?apikey=secret&link=encoded&file=release.torrent'
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

      throw new Error(`Unexpected fetch: ${value}`)
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })

    expect(results).toHaveLength(1)
    expect(results[0].downloadUrl).toBe('https://prowlarr.local/11/download?link=encoded&file=release.torrent')
    expect(results[0].magnetUrl).toBeNull()
    expect(JSON.stringify(results)).not.toContain('apikey=secret')
  })

  it('moves Prowlarr proxy urls returned in the magnet field to the download field', async () => {
    const proxyUrl = 'https://prowlarr.local/1/download?apikey=secret&link=encoded&file=release.torrent'
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

      throw new Error(`Unexpected fetch: ${value}`)
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })

    expect(results[0].downloadUrl).toBe('https://prowlarr.local/1/download?link=encoded&file=release.torrent')
    expect(results[0].magnetUrl).toBeNull()
    expect(JSON.stringify(results)).not.toContain('apikey=secret')
  })

  it('classifies network failures as predictable indexer search errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    await expect(searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })).rejects.toThrow(
      'Prowlarr search request failed.',
    )
  })

  it('classifies unsuccessful search responses without parsing them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

    await expect(searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })).rejects.toThrow(
      'Prowlarr search failed: 503',
    )
  })

  it('rejects invalid JSON search responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })).rejects.toThrow(
      'Prowlarr search returned invalid JSON.',
    )
  })

  it('rejects valid JSON that is not a search-result collection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })))

    await expect(searchProwlarr('https://prowlarr.local', 'secret', { query: 'Release' })).rejects.toThrow(
      'Prowlarr search returned an invalid payload.',
    )
  })
})
