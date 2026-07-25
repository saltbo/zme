import type { MusicTrackRecord } from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'
import { buildMusicFileTags, prepareMusicFile } from './music-file-tags'

const track: MusicTrackRecord = {
  id: 'track-1',
  provider: 'netease',
  externalId: '123',
  mediaKey: 'netease:track:123',
  title: '测试歌曲',
  artists: ['歌手甲', '歌手乙'],
  release: {
    id: 'release-1',
    provider: 'netease',
    externalId: 'album-1',
    title: '测试专辑',
    artists: ['群星'],
    releaseDate: '2024-03-02',
    releaseType: 'album',
    providerReleaseType: '专辑',
    coverUrl: null,
    discNumber: 1,
    trackNumber: 3,
  },
  coverUrl: null,
  durationMs: 180_000,
  isrcs: [],
}

const tags = buildMusicFileTags(track)

describe('music file tags', () => {
  it('adds ID3 tags without changing MP3 audio bytes and then recognizes them as complete', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    const first = await prepareMusicFile(stream(audio), 'mp3', tags, audio.byteLength)

    expect(first.changed).toBe(true)
    expect(first.contentLength).toBeGreaterThan(audio.byteLength)
    const tagged = await readAll(first.body)
    expect(tagged.slice(-audio.byteLength)).toEqual(audio)

    const second = await prepareMusicFile(stream(tagged), 'mp3', tags, tagged.byteLength)
    expect(second).toEqual({ changed: false, body: null, contentLength: tagged.byteLength })
  })

  it('adds FLAC Vorbis comments without changing audio frames and then recognizes them as complete', async () => {
    const audio = new Uint8Array([0xff, 0xf8, 0x69, 0x00, 1, 2, 3, 4])
    const source = concat([
      new TextEncoder().encode('fLaC'),
      new Uint8Array([0x80, 0, 0, 34]),
      new Uint8Array(34),
      audio,
    ])
    const first = await prepareMusicFile(stream(source), 'flac', tags, source.byteLength)

    expect(first.changed).toBe(true)
    expect(first.contentLength).toBeGreaterThan(source.byteLength)
    const tagged = await readAll(first.body)
    expect(tagged.slice(-audio.byteLength)).toEqual(audio)

    const second = await prepareMusicFile(stream(tagged), 'flac', tags, tagged.byteLength)
    expect(second).toEqual({ changed: false, body: null, contentLength: tagged.byteLength })
  })

  it('uses a stable unknown album for tracks without release metadata', () => {
    expect(buildMusicFileTags({ ...track, release: null })).toMatchObject({
      album: 'Unknown Release',
      albumArtists: ['歌手甲', '歌手乙'],
      trackNumber: null,
      discNumber: null,
      releaseDate: null,
    })
  })
})

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const split = Math.min(7, bytes.byteLength)
      controller.enqueue(bytes.slice(0, split))
      controller.enqueue(bytes.slice(split))
      controller.close()
    },
  })
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) throw new Error('Expected a response body.')
  const chunks: Uint8Array[] = []
  const reader = body.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) break
    chunks.push(next.value)
  }
  return concat(chunks)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
