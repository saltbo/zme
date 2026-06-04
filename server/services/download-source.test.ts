import { describe, expect, it } from 'vitest'
import { applyProwlarrBaseUrl, isProwlarrProxyDownloadUrl } from './download-source'

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
})
