import type { MusicTrackRecord } from '@server/usecases/ports'
import { parseBuffer } from 'music-metadata'
import { describe, expect, it } from 'vitest'
import { buildMusicFileTags, prepareMusicFile, supportsMusicFileTagging } from '.'

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
    coverUrl: 'https://p3.music.126.net/album-cover.jpg',
    discNumber: 1,
    trackNumber: 3,
  },
  coverUrl: 'https://p3.music.126.net/track-cover.jpg',
  durationMs: 180_000,
  isrcs: [],
}

const tags = buildMusicFileTags(track)
const cover = {
  mimeType: 'image/jpeg' as const,
  bytes: Uint8Array.from(
    atob(
      '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    ),
    (character) => character.charCodeAt(0),
  ),
}
const oversizedCover = {
  ...cover,
  bytes: concat([cover.bytes, new Uint8Array(70 * 1024)]),
}
const alternateCovers = [
  {
    mimeType: 'image/png' as const,
    bytes: Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAIAAAArjXluAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAFElEQVR4nGNkYPjLwMDAwgAGqBQAGZUBC0Q3XicAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    ),
  },
  {
    mimeType: 'image/webp' as const,
    bytes: Uint8Array.from(
      atob('UklGRjoAAABXRUJQVlA4IC4AAACwAQCdASoCAAQAAgA0JaACdLoABDAAAP75k2//kB//kB//kB//ID/iF3sYUAAA'),
      (character) => character.charCodeAt(0),
    ),
  },
]

describe('music file tags', () => {
  it('adds ID3 tags without changing MP3 audio bytes and then recognizes them as complete', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    const first = await prepareMusicFile(stream(audio), 'mp3', tags, audio.byteLength, async () => cover)

    expect(first.changed).toBe(true)
    expect(first.contentLength).toBeGreaterThan(audio.byteLength)
    const tagged = await readAll(first.body)
    expect(tagged.slice(-audio.byteLength)).toEqual(audio)
    expect(contains(tagged, cover.bytes)).toBe(true)
    const metadata = await parseBuffer(tagged, { mimeType: 'audio/mpeg', size: tagged.byteLength })
    expect(metadata.common).toMatchObject({
      title: tags.title,
      album: tags.album,
      albumartist: tags.albumArtists.join('; '),
      track: { no: tags.trackNumber },
      disk: { no: tags.discNumber },
    })
    expect(metadata.common.picture?.[0]?.data).toEqual(cover.bytes)

    const second = await prepareMusicFile(stream(tagged), 'mp3', tags, tagged.byteLength)
    expect(second).toEqual({ changed: false, body: null, contentLength: tagged.byteLength })
  })

  it('replaces an oversized MP3 cover with WebDAV-compatible artwork', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    const original = await prepareMusicFile(stream(audio), 'mp3', tags, audio.byteLength, async () => oversizedCover)
    const originalBytes = await readAll(original.body)

    const repaired = await prepareMusicFile(
      stream(originalBytes),
      'mp3',
      tags,
      originalBytes.byteLength,
      async () => cover,
    )
    const repairedBytes = await readAll(repaired.body)
    const metadata = await parseBuffer(repairedBytes, { mimeType: 'audio/mpeg', size: repairedBytes.byteLength })

    expect(repaired.changed).toBe(true)
    expect(metadata.common.picture).toHaveLength(1)
    expect(metadata.common.picture?.[0]?.data).toEqual(cover.bytes)
    expect(id3Length(repairedBytes)).toBeLessThanOrEqual(128 * 1024)
    expect(repairedBytes.slice(-audio.byteLength)).toEqual(audio)
  })

  it('adds FLAC Vorbis comments without changing audio frames and then recognizes them as complete', async () => {
    const audio = new Uint8Array([0xff, 0xf8, 0x69, 0x00, 1, 2, 3, 4])
    const source = concat([
      new TextEncoder().encode('fLaC'),
      new Uint8Array([0x80, 0, 0, 34]),
      new Uint8Array(34),
      audio,
    ])
    const first = await prepareMusicFile(stream(source), 'flac', tags, source.byteLength, async () => cover)

    expect(first.changed).toBe(true)
    expect(first.contentLength).toBeGreaterThan(source.byteLength)
    const tagged = await readAll(first.body)
    expect(tagged.slice(-audio.byteLength)).toEqual(audio)
    expect(contains(tagged, cover.bytes)).toBe(true)
    expect(readFlacPicture(tagged)).toEqual({
      width: 2,
      height: 2,
      depth: 24,
      colors: 0,
      imageLength: cover.bytes.byteLength,
    })
    const metadata = await parseBuffer(tagged, { mimeType: 'audio/flac', size: tagged.byteLength })
    expect(metadata.common).toMatchObject({
      title: tags.title,
      album: tags.album,
      albumartist: tags.albumArtists.join('; '),
      track: { no: tags.trackNumber },
      disk: { no: tags.discNumber },
    })
    expect(metadata.common.picture?.[0]?.data).toEqual(cover.bytes)

    const second = await prepareMusicFile(stream(tagged), 'flac', tags, tagged.byteLength)
    expect(second).toEqual({ changed: false, body: null, contentLength: tagged.byteLength })

    const corrupted = removeFlacPictureLength(tagged)
    const repaired = await prepareMusicFile(stream(corrupted), 'flac', tags, corrupted.byteLength, async () => cover)
    expect(repaired.changed).toBe(true)
    const repairedBytes = await readAll(repaired.body)
    const repairedMetadata = await parseBuffer(repairedBytes, {
      mimeType: 'audio/flac',
      size: repairedBytes.byteLength,
    })
    expect(repairedMetadata.common.picture?.[0]?.data).toEqual(cover.bytes)
    expect(repairedBytes.slice(-audio.byteLength)).toEqual(audio)
  })

  it('replaces an oversized FLAC cover with WebDAV-compatible artwork', async () => {
    const audio = new Uint8Array([0xff, 0xf8, 0x69, 0x00, 1, 2, 3, 4])
    const source = concat([
      new TextEncoder().encode('fLaC'),
      new Uint8Array([0x80, 0, 0, 34]),
      new Uint8Array(34),
      audio,
    ])
    const original = await prepareMusicFile(stream(source), 'flac', tags, source.byteLength, async () => oversizedCover)
    const originalBytes = await readAll(original.body)

    const repaired = await prepareMusicFile(
      stream(originalBytes),
      'flac',
      tags,
      originalBytes.byteLength,
      async () => cover,
    )
    const repairedBytes = await readAll(repaired.body)
    const metadata = await parseBuffer(repairedBytes, { mimeType: 'audio/flac', size: repairedBytes.byteLength })

    expect(repaired.changed).toBe(true)
    expect(metadata.common.picture).toHaveLength(1)
    expect(metadata.common.picture?.[0]?.data).toEqual(cover.bytes)
    expect(flacMetadataLength(repairedBytes)).toBeLessThanOrEqual(128 * 1024)
    expect(repairedBytes.slice(-audio.byteLength)).toEqual(audio)
  })

  it.each(alternateCovers)('writes $mimeType dimensions into FLAC artwork metadata', async (alternateCover) => {
    const source = concat([
      new TextEncoder().encode('fLaC'),
      new Uint8Array([0x80, 0, 0, 34]),
      new Uint8Array(34),
      new Uint8Array([0xff, 0xf8, 0x69, 0x00]),
    ])
    const prepared = await prepareMusicFile(stream(source), 'flac', tags, source.byteLength, async () => alternateCover)
    const tagged = await readAll(prepared.body)

    expect(readFlacPicture(tagged)).toMatchObject({
      width: 2,
      height: 4,
      depth: 24,
      colors: 0,
      imageLength: alternateCover.bytes.byteLength,
    })
  })

  it('uses a stable unknown album for tracks without release metadata', () => {
    expect(buildMusicFileTags({ ...track, release: null })).toMatchObject({
      album: 'Unknown Release',
      albumArtists: ['歌手甲', '歌手乙'],
      trackNumber: null,
      discNumber: null,
      releaseDate: null,
      coverUrl: 'https://p3.music.126.net/track-cover.jpg',
    })
  })

  it('declares only formats with tested text and artwork writers as supported', () => {
    expect(['mp3', 'flac', 'aac', 'm4a', 'm4b', 'mp4', 'ogg', 'oga'].every(supportsMusicFileTagging)).toBe(true)
    expect(['opus', 'wav', 'aiff', 'ape', 'wma'].some(supportsMusicFileTagging)).toBe(false)
  })

  it('rejects M4A containers with non-audio tracks before loading the tag engine', async () => {
    const source = concat([
      mp4Box('ftyp', new TextEncoder().encode('M4A \0\0\0\0M4A ')),
      mp4Box('moov', concat([mp4Track('soun'), mp4Track('vide')])),
    ])

    await expect(prepareMusicFile(stream(source), 'm4a', tags, source.byteLength)).rejects.toThrow(
      'exactly one audio track and no video tracks',
    )
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

function contains(value: Uint8Array, expected: Uint8Array): boolean {
  return value.some((_, offset) => expected.every((byte, index) => value[offset + index] === byte))
}

function readFlacPicture(bytes: Uint8Array) {
  let offset = 4
  while (offset + 4 <= bytes.byteLength) {
    const type = bytes[offset] & 0x7f
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    const data = bytes.subarray(offset + 4, offset + 4 + length)
    if (type === 6) {
      let pictureOffset = 4
      const mimeLength = readUint32Be(data, pictureOffset)
      pictureOffset += 4 + mimeLength
      const descriptionLength = readUint32Be(data, pictureOffset)
      pictureOffset += 4 + descriptionLength
      const width = readUint32Be(data, pictureOffset)
      pictureOffset += 4
      const height = readUint32Be(data, pictureOffset)
      pictureOffset += 4
      const depth = readUint32Be(data, pictureOffset)
      pictureOffset += 4
      const colors = readUint32Be(data, pictureOffset)
      pictureOffset += 4
      const pictureLength = readUint32Be(data, pictureOffset)
      expect(pictureOffset + 4 + pictureLength).toBe(data.byteLength)
      return { width, height, depth, colors, imageLength: pictureLength }
    }
    offset += 4 + length
  }
  throw new Error('Expected a FLAC PICTURE block.')
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

function id3Length(bytes: Uint8Array): number {
  return 10 + (bytes[6] << 21) + (bytes[7] << 14) + (bytes[8] << 7) + bytes[9]
}

function flacMetadataLength(bytes: Uint8Array): number {
  let offset = 4
  while (offset + 4 <= bytes.byteLength) {
    const isLast = (bytes[offset] & 0x80) !== 0
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    offset += 4 + length
    if (isLast) return offset
  }
  throw new Error('Expected complete FLAC metadata.')
}

function removeFlacPictureLength(bytes: Uint8Array): Uint8Array {
  let offset = 4
  while (offset + 4 <= bytes.byteLength) {
    const type = bytes[offset] & 0x7f
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (type === 6) {
      const dataOffset = offset + 4
      let pictureOffset = dataOffset + 4
      pictureOffset += 4 + readUint32Be(bytes, pictureOffset)
      pictureOffset += 4 + readUint32Be(bytes, pictureOffset)
      pictureOffset += 16
      const output = concat([bytes.subarray(0, pictureOffset), bytes.subarray(pictureOffset + 4)])
      const corruptLength = length - 4
      output[offset + 1] = corruptLength >>> 16
      output[offset + 2] = corruptLength >>> 8
      output[offset + 3] = corruptLength
      return output
    }
    offset += 4 + length
  }
  throw new Error('Expected a FLAC PICTURE block.')
}

function mp4Track(handler: 'soun' | 'vide'): Uint8Array {
  const handlerData = concat([new Uint8Array(8), new TextEncoder().encode(handler)])
  return mp4Box('trak', mp4Box('mdia', mp4Box('hdlr', handlerData)))
}

function mp4Box(type: string, data: Uint8Array): Uint8Array {
  const size = data.byteLength + 8
  return concat([new Uint8Array([size >>> 24, size >>> 16, size >>> 8, size]), new TextEncoder().encode(type), data])
}
