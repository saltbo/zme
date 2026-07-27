import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyProwlarrBaseUrl, isProwlarrProxyDownloadUrl, resolveProwlarrProxyDownloadUrl } from './download-source'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('download source helpers', () => {
  it('detects sanitized Prowlarr proxy download urls', () => {
    expect(isProwlarrProxyDownloadUrl('https://prowlarr.local/11/download?link=encoded&file=release.torrent')).toBe(
      true,
    )
  })

  it('replaces local Prowlarr origins with the configured indexer origin', () => {
    expect(applyProwlarrBaseUrl('http://127.0.0.1:9696/1/download?link=encoded', 'https://prowlarr.example.com')).toBe(
      'https://prowlarr.example.com/1/download?link=encoded',
    )
  })

  it('reports the Prowlarr response status and body when resolution fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Invalid API key' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    await expect(resolveProwlarrProxyDownloadUrl('https://prowlarr.local/1/download?link=encoded')).rejects.toThrow(
      'Prowlarr download URL returned HTTP 401 Unauthorized: application/json {"message":"Invalid API key"}; expected a redirect.',
    )
  })

  it('reports a redirect response without a location header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 })),
    )

    await expect(resolveProwlarrProxyDownloadUrl('https://prowlarr.local/1/download?link=encoded')).rejects.toThrow(
      'Prowlarr download URL returned HTTP 302 without a Location header.',
    )
  })

  it('reports the configured timeout clearly', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            )
          }),
      ),
    )

    const resolution = expect(
      resolveProwlarrProxyDownloadUrl('https://prowlarr.local/1/download?link=encoded'),
    ).rejects.toThrow('Prowlarr download URL timed out after 30 seconds.')

    await vi.advanceTimersByTimeAsync(30_000)
    await resolution
  })
})
