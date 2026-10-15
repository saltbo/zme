import { LocalDownloadUnavailableError } from '@server/usecases/local-downloads'
import type { DownloadSourceContentGateway } from '@server/usecases/ports'

const maximumTorrentBytes = 10 * 1024 * 1024

export const downloadSourceContentGateway: DownloadSourceContentGateway = {
  async torrent(uri) {
    try {
      let current = new URL(uri)
      const signal = AbortSignal.timeout(30_000)
      for (let hop = 0; hop < 5; hop += 1) {
        if (!['http:', 'https:'].includes(current.protocol)) throw new Error('Unsupported source protocol.')
        const response = await fetch(current, { redirect: 'manual', signal })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          const location = response.headers.get('location')
          if (!location) throw new Error('Missing source redirect.')
          current = new URL(location, current)
          continue
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          throw new Error(`Torrent source returned HTTP ${response.status}.`)
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.byteLength
            if (length > maximumTorrentBytes) throw new Error('Torrent file is too large.')
            chunks.push(value)
          }
        } finally {
          await reader.cancel()
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        // Torrent metadata is a bencoded dictionary; never serve an upstream login/error page as a torrent.
        if (bytes[0] !== 100 || bytes[length - 1] !== 101) throw new Error('Invalid torrent file.')
        return bytes
      }
      throw new Error('Too many source redirects.')
    } catch (cause) {
      throw new LocalDownloadUnavailableError('The torrent file could not be downloaded.', { cause })
    }
  },
}
