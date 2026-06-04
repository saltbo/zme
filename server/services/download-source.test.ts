import { describe, expect, it } from 'vitest'
import { isProwlarrProxyDownloadUrl } from './download-source'

describe('download source helpers', () => {
  it('detects sanitized Prowlarr proxy download urls', () => {
    expect(isProwlarrProxyDownloadUrl('https://prowlarr.local/11/download?link=encoded&file=release.torrent')).toBe(
      true,
    )
  })
})
