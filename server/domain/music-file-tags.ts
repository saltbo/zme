const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MANAGED_ID3_FRAMES = new Set(['TIT2', 'TPE1', 'TALB', 'TPE2', 'TRCK', 'TPOS', 'TDRC', 'TYER', 'TCMP'])
const MANAGED_VORBIS_FIELDS = new Set([
  'TITLE',
  'ARTIST',
  'ALBUM',
  'ALBUMARTIST',
  'TRACKNUMBER',
  'DISCNUMBER',
  'DATE',
  'COMPILATION',
])

export interface MusicFileTags {
  title: string
  artists: string[]
  album: string
  albumArtists: string[]
  trackNumber: number | null
  discNumber: number | null
  releaseDate: string | null
  compilation: boolean
}

export interface PreparedMusicFile {
  changed: boolean
  body: ReadableStream<Uint8Array> | null
  contentLength: number | null
}

interface MusicTagSource {
  title: string
  artists: string[]
  release: {
    title: string
    artists: string[]
    trackNumber: number | null
    discNumber: number | null
    releaseDate: string | null
  } | null
}

interface MetadataRewrite {
  complete: boolean
  bytes: Uint8Array
}

interface FlacBlock {
  type: number
  data: Uint8Array
}

export function buildMusicFileTags(track: MusicTagSource): MusicFileTags {
  const albumArtists = track.release?.artists.length ? track.release.artists : track.artists
  return {
    title: track.title,
    artists: track.artists,
    album: track.release?.title ?? 'Unknown Release',
    albumArtists,
    trackNumber: track.release?.trackNumber ?? null,
    discNumber: track.release?.discNumber ?? null,
    releaseDate: track.release?.releaseDate ?? null,
    compilation: albumArtists.some((artist) => /^(群星|various artists)$/i.test(artist.trim())),
  }
}

export function parseMusicFileTags(value: unknown): MusicFileTags {
  if (typeof value !== 'object' || value === null) throw new Error('Stored music file tags are invalid.')
  const tags = value as Record<string, unknown>
  if (
    typeof tags.title !== 'string' ||
    !isStringArray(tags.artists) ||
    typeof tags.album !== 'string' ||
    !isStringArray(tags.albumArtists) ||
    !isNullableNumber(tags.trackNumber) ||
    !isNullableNumber(tags.discNumber) ||
    (typeof tags.releaseDate !== 'string' && tags.releaseDate !== null) ||
    typeof tags.compilation !== 'boolean'
  ) {
    throw new Error('Stored music file tags are invalid.')
  }
  return tags as unknown as MusicFileTags
}

export async function prepareMusicFile(
  body: ReadableStream<Uint8Array>,
  extension: string,
  tags: MusicFileTags,
  originalContentLength: number | null,
): Promise<PreparedMusicFile> {
  const format = extension.toLowerCase()
  if (format !== 'mp3' && format !== 'flac') throw new Error(`Unsupported music tag format: ${extension}.`)

  const reader = body.getReader()
  const prefix = await readMetadataPrefix(reader, format)
  const metadataLength = requiredMetadataLength(prefix.bytes, format)
  if (metadataLength === null) throw new Error('Audio metadata header is incomplete.')

  const rewrite =
    format === 'mp3'
      ? rewriteId3(prefix.bytes.subarray(0, metadataLength), tags)
      : rewriteFlac(prefix.bytes.subarray(0, metadataLength), tags)
  if (rewrite.complete) {
    await reader.cancel()
    return { changed: false, body: null, contentLength: originalContentLength }
  }

  const firstChunk = concatBytes([rewrite.bytes, prefix.bytes.subarray(metadataLength)])
  const contentLength =
    originalContentLength === null ? null : originalContentLength - metadataLength + rewrite.bytes.byteLength
  return {
    changed: true,
    body: streamWithPrefix(firstChunk, reader),
    contentLength,
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0)
}

async function readMetadataPrefix(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  format: 'mp3' | 'flac',
): Promise<{ bytes: Uint8Array }> {
  let buffer = new Uint8Array(64 * 1024)
  let length = 0

  while (true) {
    const current = buffer.subarray(0, length)
    const required = requiredMetadataLength(current, format)
    if (required !== null && length >= Math.max(required, format === 'mp3' ? 10 : 4)) {
      return { bytes: current.slice() }
    }
    if (required !== null && required > MAX_METADATA_BYTES) {
      throw new Error(`Audio metadata exceeds ${MAX_METADATA_BYTES} bytes.`)
    }

    const next = await reader.read()
    if (next.done) throw new Error('Audio resource ended before its metadata header was complete.')
    const needed = length + next.value.byteLength
    if (needed > buffer.byteLength) {
      let capacity = buffer.byteLength
      while (capacity < needed) capacity *= 2
      const grown = new Uint8Array(capacity)
      grown.set(buffer.subarray(0, length))
      buffer = grown
    }
    buffer.set(next.value, length)
    length = needed
    if (length > MAX_METADATA_BYTES && requiredMetadataLength(buffer.subarray(0, length), format) === null) {
      throw new Error(`Audio metadata exceeds ${MAX_METADATA_BYTES} bytes.`)
    }
  }
}

function requiredMetadataLength(bytes: Uint8Array, format: 'mp3' | 'flac'): number | null {
  if (format === 'mp3') {
    if (bytes.byteLength < 10) return null
    if (!hasAscii(bytes, 0, 'ID3')) return 0
    return 10 + readSynchsafe(bytes, 6)
  }

  if (bytes.byteLength < 4) return null
  if (!hasAscii(bytes, 0, 'fLaC')) throw new Error('FLAC resource is missing its stream marker.')
  let offset = 4
  while (true) {
    if (bytes.byteLength < offset + 4) return null
    const isLast = (bytes[offset] & 0x80) !== 0
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    offset += 4 + length
    if (offset > MAX_METADATA_BYTES) return offset
    if (bytes.byteLength < offset) return null
    if (isLast) return offset
  }
}

function rewriteId3(metadata: Uint8Array, tags: MusicFileTags): MetadataRewrite {
  let version = 4
  let preservedFrames: Uint8Array[] = []
  const current = new Map<string, string>()

  if (metadata.byteLength > 0) {
    if (metadata.byteLength < 10 || !hasAscii(metadata, 0, 'ID3')) throw new Error('MP3 ID3 header is invalid.')
    version = metadata[3]
    if (version !== 3 && version !== 4) throw new Error(`Unsupported ID3 version: 2.${version}.`)
    if (metadata[5] !== 0) throw new Error('ID3 tags with header flags are not supported.')
    const parsed = parseId3Frames(metadata.subarray(10), version)
    preservedFrames = parsed.preserved
    for (const [key, value] of parsed.values) current.set(key, value)
  }

  const expected = expectedId3Values(tags, version)
  if (metadata.byteLength > 0 && containsExpectedValues(current, expected)) {
    return { complete: true, bytes: metadata }
  }

  const frames = [...preservedFrames, ...[...expected].map(([id, value]) => buildId3TextFrame(id, value, version))]
  const body = concatBytes(frames)
  const header = new Uint8Array(10)
  header.set(new TextEncoder().encode('ID3'))
  header[3] = version
  header.set(writeSynchsafe(body.byteLength), 6)
  return { complete: false, bytes: concatBytes([header, body]) }
}

function parseId3Frames(body: Uint8Array, version: number): { values: Map<string, string>; preserved: Uint8Array[] } {
  const values = new Map<string, string>()
  const preserved: Uint8Array[] = []
  let offset = 0

  while (offset + 10 <= body.byteLength) {
    if (body[offset] === 0) break
    const id = ascii(body.subarray(offset, offset + 4))
    if (!/^[A-Z0-9]{4}$/.test(id)) throw new Error('ID3 frame identifier is invalid.')
    const size = version === 4 ? readSynchsafe(body, offset + 4) : readUint32Be(body, offset + 4)
    const end = offset + 10 + size
    if (end > body.byteLength) throw new Error(`ID3 frame ${id} exceeds the tag boundary.`)
    const frame = body.subarray(offset, end)
    if (MANAGED_ID3_FRAMES.has(id)) {
      values.set(id, decodeId3Text(frame.subarray(10)))
    } else {
      preserved.push(frame.slice())
    }
    offset = end
  }

  return { values, preserved }
}

function expectedId3Values(tags: MusicFileTags, version: number): Map<string, string> {
  const values = new Map<string, string>([
    ['TIT2', tags.title],
    ['TPE1', tags.artists.join('; ')],
    ['TALB', tags.album],
    ['TPE2', tags.albumArtists.join('; ')],
  ])
  if (tags.trackNumber !== null) values.set('TRCK', String(tags.trackNumber))
  if (tags.discNumber !== null) values.set('TPOS', String(tags.discNumber))
  if (tags.releaseDate)
    values.set(version === 3 ? 'TYER' : 'TDRC', version === 3 ? tags.releaseDate.slice(0, 4) : tags.releaseDate)
  if (tags.compilation) values.set('TCMP', '1')
  return values
}

function buildId3TextFrame(id: string, value: string, version: number): Uint8Array {
  const payload = version === 4 ? encodeUtf8Id3(value) : encodeUtf16Id3(value)
  const frame = new Uint8Array(10 + payload.byteLength)
  frame.set(new TextEncoder().encode(id))
  frame.set(version === 4 ? writeSynchsafe(payload.byteLength) : writeUint32Be(payload.byteLength), 4)
  frame.set(payload, 10)
  return frame
}

function encodeUtf8Id3(value: string): Uint8Array {
  const text = new TextEncoder().encode(value)
  const bytes = new Uint8Array(text.byteLength + 1)
  bytes[0] = 3
  bytes.set(text, 1)
  return bytes
}

function encodeUtf16Id3(value: string): Uint8Array {
  const bytes = new Uint8Array(3 + value.length * 2)
  bytes.set([1, 0xff, 0xfe])
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    bytes[3 + index * 2] = code & 0xff
    bytes[4 + index * 2] = code >> 8
  }
  return bytes
}

function decodeId3Text(payload: Uint8Array): string {
  if (payload.byteLength === 0) return ''
  const encoding = payload[0]
  const value = payload.subarray(1)
  if (encoding === 0) return latin1(value)
  if (encoding === 3) return new TextDecoder().decode(value).replaceAll('\0', '; ')
  if (encoding === 1) {
    if (value.byteLength < 2) return ''
    if (value[0] === 0xff && value[1] === 0xfe) return decodeUtf16(value.subarray(2), true)
    if (value[0] === 0xfe && value[1] === 0xff) return decodeUtf16(value.subarray(2), false)
    return decodeUtf16(value, false)
  }
  if (encoding === 2) return decodeUtf16(value, false)
  throw new Error(`Unsupported ID3 text encoding: ${encoding}.`)
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units: number[] = []
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    const code = littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1]
    if (code !== 0) units.push(code)
  }
  return String.fromCharCode(...units)
}

function rewriteFlac(metadata: Uint8Array, tags: MusicFileTags): MetadataRewrite {
  const blocks = parseFlacBlocks(metadata)
  const commentIndex = blocks.findIndex((block) => block.type === 4)
  const comments = commentIndex === -1 ? emptyVorbisComments() : parseVorbisComments(blocks[commentIndex].data)
  const expected = expectedVorbisValues(tags)
  const current = groupVorbisComments(comments.entries)
  if (commentIndex !== -1 && containsExpectedLists(current, expected)) {
    return { complete: true, bytes: metadata }
  }

  const entries = comments.entries.filter((entry) => !MANAGED_VORBIS_FIELDS.has(vorbisKey(entry)))
  for (const [key, values] of expected) {
    for (const value of values) entries.push(`${key}=${value}`)
  }
  const commentBlock = { type: 4, data: buildVorbisComments(comments.vendor, entries) }
  if (commentIndex === -1) blocks.splice(1, 0, commentBlock)
  else blocks[commentIndex] = commentBlock
  return { complete: false, bytes: buildFlacMetadata(blocks) }
}

function parseFlacBlocks(metadata: Uint8Array): FlacBlock[] {
  if (!hasAscii(metadata, 0, 'fLaC')) throw new Error('FLAC resource is missing its stream marker.')
  const blocks: FlacBlock[] = []
  let offset = 4
  let isLast = false
  while (!isLast) {
    if (offset + 4 > metadata.byteLength) throw new Error('FLAC metadata block header is incomplete.')
    isLast = (metadata[offset] & 0x80) !== 0
    const type = metadata[offset] & 0x7f
    const length = (metadata[offset + 1] << 16) | (metadata[offset + 2] << 8) | metadata[offset + 3]
    const end = offset + 4 + length
    if (end > metadata.byteLength) throw new Error('FLAC metadata block exceeds the metadata boundary.')
    blocks.push({ type, data: metadata.slice(offset + 4, end) })
    offset = end
  }
  if (blocks[0]?.type !== 0) throw new Error('FLAC STREAMINFO must be the first metadata block.')
  return blocks
}

function buildFlacMetadata(blocks: FlacBlock[]): Uint8Array {
  const encoded = [new TextEncoder().encode('fLaC')]
  for (const [index, block] of blocks.entries()) {
    if (block.data.byteLength > 0xffffff) throw new Error('FLAC metadata block is too large.')
    const header = new Uint8Array(4)
    header[0] = block.type | (index === blocks.length - 1 ? 0x80 : 0)
    header[1] = block.data.byteLength >> 16
    header[2] = block.data.byteLength >> 8
    header[3] = block.data.byteLength
    encoded.push(header, block.data)
  }
  return concatBytes(encoded)
}

function emptyVorbisComments(): { vendor: string; entries: string[] } {
  return { vendor: 'ZME', entries: [] }
}

function parseVorbisComments(data: Uint8Array): { vendor: string; entries: string[] } {
  let offset = 0
  const vendorLength = readUint32Le(data, offset)
  offset += 4
  if (offset + vendorLength > data.byteLength) throw new Error('FLAC Vorbis vendor exceeds the block boundary.')
  const vendor = new TextDecoder().decode(data.subarray(offset, offset + vendorLength))
  offset += vendorLength
  const count = readUint32Le(data, offset)
  offset += 4
  const entries: string[] = []
  for (let index = 0; index < count; index += 1) {
    const length = readUint32Le(data, offset)
    offset += 4
    if (offset + length > data.byteLength) throw new Error('FLAC Vorbis comment exceeds the block boundary.')
    entries.push(new TextDecoder().decode(data.subarray(offset, offset + length)))
    offset += length
  }
  return { vendor, entries }
}

function buildVorbisComments(vendor: string, entries: string[]): Uint8Array {
  const vendorBytes = new TextEncoder().encode(vendor)
  const entryBytes = entries.map((entry) => new TextEncoder().encode(entry))
  const chunks = [writeUint32Le(vendorBytes.byteLength), vendorBytes, writeUint32Le(entryBytes.length)]
  for (const entry of entryBytes) chunks.push(writeUint32Le(entry.byteLength), entry)
  return concatBytes(chunks)
}

function expectedVorbisValues(tags: MusicFileTags): Map<string, string[]> {
  const values = new Map<string, string[]>([
    ['TITLE', [tags.title]],
    ['ARTIST', tags.artists],
    ['ALBUM', [tags.album]],
    ['ALBUMARTIST', tags.albumArtists],
  ])
  if (tags.trackNumber !== null) values.set('TRACKNUMBER', [String(tags.trackNumber)])
  if (tags.discNumber !== null) values.set('DISCNUMBER', [String(tags.discNumber)])
  if (tags.releaseDate) values.set('DATE', [tags.releaseDate])
  if (tags.compilation) values.set('COMPILATION', ['1'])
  return values
}

function groupVorbisComments(entries: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const entry of entries) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = entry.slice(0, separator).toUpperCase()
    const values = grouped.get(key) ?? []
    values.push(entry.slice(separator + 1))
    grouped.set(key, values)
  }
  return grouped
}

function vorbisKey(entry: string): string {
  const separator = entry.indexOf('=')
  return separator <= 0 ? '' : entry.slice(0, separator).toUpperCase()
}

function containsExpectedValues(current: Map<string, string>, expected: Map<string, string>): boolean {
  for (const [key, value] of expected) {
    if (normalizeTagValue(current.get(key) ?? '') !== normalizeTagValue(value)) return false
  }
  return true
}

function containsExpectedLists(current: Map<string, string[]>, expected: Map<string, string[]>): boolean {
  for (const [key, values] of expected) {
    const actual = (current.get(key) ?? []).map(normalizeTagValue)
    if (actual.length !== values.length) return false
    if (actual.some((value, index) => value !== normalizeTagValue(values[index]))) return false
  }
  return true
}

function normalizeTagValue(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ')
}

function streamWithPrefix(
  prefix: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  let sentPrefix = false
  return new ReadableStream({
    async pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true
        if (prefix.byteLength > 0) {
          controller.enqueue(prefix)
          return
        }
      }
      const next = await reader.read()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset + expected.length > bytes.byteLength) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false
  }
  return true
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes).replaceAll('\0', '')
}

function readSynchsafe(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) throw new Error('Synchsafe integer is incomplete.')
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  )
}

function writeSynchsafe(value: number): Uint8Array {
  return new Uint8Array([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f])
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) throw new Error('Big-endian integer is incomplete.')
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

function writeUint32Be(value: number): Uint8Array {
  return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value])
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) throw new Error('Little-endian integer is incomplete.')
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000
}

function writeUint32Le(value: number): Uint8Array {
  return new Uint8Array([value, value >>> 8, value >>> 16, value >>> 24])
}
