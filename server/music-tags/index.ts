import { type BufferedTagValues, inspectBufferedFile, writeBufferedFile } from './taglib-engine.ts'

const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_BUFFERED_FILE_BYTES = 24 * 1024 * 1024
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
  coverUrl: string | null
}

export interface MusicFileCover {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: Uint8Array
}

export interface PreparedMusicFile {
  changed: boolean
  body: ReadableStream<Uint8Array> | null
  contentLength: number | null
}

interface MusicTagSource {
  title: string
  artists: string[]
  coverUrl: string | null
  release: {
    title: string
    artists: string[]
    trackNumber: number | null
    discNumber: number | null
    releaseDate: string | null
    coverUrl: string | null
  } | null
}

interface MetadataRewrite {
  complete: boolean
  bytes: Uint8Array
  needsCover: boolean
}

interface FlacBlock {
  type: number
  data: Uint8Array
}

const STREAMING_FORMATS = new Set(['mp3', 'flac'])
const BUFFERED_FORMATS = new Set(['aac', 'm4a', 'm4b', 'mp4', 'ogg', 'oga'])

export function supportsMusicFileTagging(extension: string): boolean {
  const format = extension.toLowerCase()
  return STREAMING_FORMATS.has(format) || BUFFERED_FORMATS.has(format)
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
    coverUrl: track.release?.coverUrl ?? track.coverUrl,
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
    typeof tags.compilation !== 'boolean' ||
    (tags.coverUrl !== undefined && typeof tags.coverUrl !== 'string' && tags.coverUrl !== null)
  ) {
    throw new Error('Stored music file tags are invalid.')
  }
  return {
    title: tags.title,
    artists: tags.artists,
    album: tags.album,
    albumArtists: tags.albumArtists,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    releaseDate: tags.releaseDate,
    compilation: tags.compilation,
    coverUrl: typeof tags.coverUrl === 'string' ? tags.coverUrl : null,
  }
}

export async function prepareMusicFile(
  body: ReadableStream<Uint8Array>,
  extension: string,
  tags: MusicFileTags,
  originalContentLength: number | null,
  loadCover?: (url: string) => Promise<MusicFileCover>,
): Promise<PreparedMusicFile> {
  const format = extension.toLowerCase()
  if (BUFFERED_FORMATS.has(format)) {
    return prepareBufferedMusicFile(body, format, tags, originalContentLength, loadCover)
  }
  if (!STREAMING_FORMATS.has(format)) throw new Error(`Unsupported music tag format: ${extension}.`)

  const reader = body.getReader()
  const streamingFormat = format as 'mp3' | 'flac'
  const prefix = await readMetadataPrefix(reader, streamingFormat)
  const metadataLength = requiredMetadataLength(prefix.bytes, streamingFormat)
  if (metadataLength === null) throw new Error('Audio metadata header is incomplete.')

  let rewrite =
    streamingFormat === 'mp3'
      ? rewriteId3(prefix.bytes.subarray(0, metadataLength), tags, null)
      : rewriteFlac(prefix.bytes.subarray(0, metadataLength), tags, null)
  if (rewrite.needsCover && tags.coverUrl) {
    if (!loadCover) throw new Error('Music cover loader is required.')
    const cover = await loadCover(tags.coverUrl)
    rewrite =
      streamingFormat === 'mp3'
        ? rewriteId3(prefix.bytes.subarray(0, metadataLength), tags, cover)
        : rewriteFlac(prefix.bytes.subarray(0, metadataLength), tags, cover)
  }
  if (rewrite.complete) {
    await reader.cancel()
    return { changed: false, body: null, contentLength: originalContentLength }
  }
  validateStreamingMetadata(rewrite.bytes, streamingFormat)

  const firstChunk = concatBytes([rewrite.bytes, prefix.bytes.subarray(metadataLength)])
  const contentLength =
    originalContentLength === null ? null : originalContentLength - metadataLength + rewrite.bytes.byteLength
  return {
    changed: true,
    body: streamWithPrefix(firstChunk, reader),
    contentLength,
  }
}

function validateStreamingMetadata(metadata: Uint8Array, format: 'mp3' | 'flac'): void {
  if (format === 'mp3') {
    if (metadata.byteLength < 10 || !hasAscii(metadata, 0, 'ID3')) throw new Error('Generated ID3 tag is invalid.')
    const size = readSynchsafe(metadata, 6)
    if (size + 10 !== metadata.byteLength) throw new Error('Generated ID3 tag size is invalid.')
    parseId3Frames(metadata.subarray(10), metadata[3])
    return
  }
  parseFlacBlocks(metadata)
}

async function prepareBufferedMusicFile(
  body: ReadableStream<Uint8Array>,
  extension: string,
  tags: MusicFileTags,
  originalContentLength: number | null,
  loadCover?: (url: string) => Promise<MusicFileCover>,
): Promise<PreparedMusicFile> {
  if (originalContentLength !== null && originalContentLength > MAX_BUFFERED_FILE_BYTES) {
    throw new Error(`The ${extension.toUpperCase()} file exceeds the ${MAX_BUFFERED_FILE_BYTES}-byte tagging limit.`)
  }
  const bytes = await readStream(body, MAX_BUFFERED_FILE_BYTES)
  if (extension === 'm4a' || extension === 'm4b' || extension === 'mp4') {
    validateAudioOnlyMp4(bytes)
  }
  const current = await inspectBufferedFile(bytes, extension)
  const needsCover = Boolean(tags.coverUrl && current.pictures.length === 0)
  if (containsExpectedBufferedTags(current, tags) && !needsCover) {
    return { changed: false, body: null, contentLength: originalContentLength }
  }

  let cover: MusicFileCover | null = null
  if (needsCover) {
    if (!loadCover || !tags.coverUrl) throw new Error('Music cover loader is required.')
    cover = await loadCover(tags.coverUrl)
  }
  const output = await writeBufferedFile(bytes, extension, bufferedTagValues(tags), coverPicture(cover))
  await validateBufferedMusicFile(output, extension, tags, Boolean(tags.coverUrl))
  return {
    changed: true,
    body: streamBytes(output),
    contentLength: output.byteLength,
  }
}

function validateAudioOnlyMp4(bytes: Uint8Array): void {
  const topLevel = readMp4Boxes(bytes, 0, bytes.byteLength)
  if (!topLevel.some((box) => box.type === 'ftyp')) throw new Error('MP4 resource is missing its file type box.')
  const moov = topLevel.find((box) => box.type === 'moov')
  if (!moov) throw new Error('MP4 resource is missing its movie box.')

  const handlers = readMp4Boxes(bytes, moov.dataOffset, moov.end)
    .filter((box) => box.type === 'trak')
    .map((track) => readMp4TrackHandler(bytes, track))
  if (handlers.length !== 1 || handlers[0] !== 'soun') {
    throw new Error('MP4 music tagging requires exactly one audio track and no video tracks.')
  }
}

interface Mp4Box {
  type: string
  dataOffset: number
  end: number
}

function readMp4Boxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = []
  let offset = start
  while (offset < end) {
    if (offset + 8 > end) throw new Error('MP4 box header is incomplete.')
    const size32 = readUint32Be(bytes, offset)
    const type = ascii(bytes.subarray(offset + 4, offset + 8))
    let headerSize = 8
    let size = size32
    if (size32 === 1) {
      if (offset + 16 > end) throw new Error('MP4 extended box header is incomplete.')
      const high = readUint32Be(bytes, offset + 8)
      const low = readUint32Be(bytes, offset + 12)
      size = high * 0x100000000 + low
      headerSize = 16
    } else if (size32 === 0) {
      size = end - offset
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) {
      throw new Error(`MP4 ${type} box has an invalid size.`)
    }
    boxes.push({ type, dataOffset: offset + headerSize, end: offset + size })
    offset += size
  }
  return boxes
}

function readMp4TrackHandler(bytes: Uint8Array, track: Mp4Box): string {
  const mdia = readMp4Boxes(bytes, track.dataOffset, track.end).find((box) => box.type === 'mdia')
  if (!mdia) throw new Error('MP4 track is missing its media box.')
  const handler = readMp4Boxes(bytes, mdia.dataOffset, mdia.end).find((box) => box.type === 'hdlr')
  if (!handler || handler.dataOffset + 12 > handler.end) throw new Error('MP4 track is missing its handler.')
  return ascii(bytes.subarray(handler.dataOffset + 8, handler.dataOffset + 12))
}

function bufferedTagValues(tags: MusicFileTags): BufferedTagValues {
  return {
    title: tags.title,
    artist: tags.artists.join('; '),
    album: tags.album,
    albumArtist: tags.albumArtists.join('; '),
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    releaseDate: tags.releaseDate,
    compilation: tags.compilation,
  }
}

function coverPicture(cover: MusicFileCover | null) {
  return cover ? { type: 'FrontCover' as const, mimeType: cover.mimeType, data: cover.bytes } : null
}

async function readStream(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const next = await reader.read()
    if (next.done) return concatBytes(chunks)
    length += next.value.byteLength
    if (length > limit) {
      await reader.cancel()
      throw new Error(`Music file exceeds the ${limit}-byte tagging limit.`)
    }
    chunks.push(next.value)
  }
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function containsExpectedBufferedTags(current: BufferedTagValues, tags: MusicFileTags): boolean {
  return (
    normalizeTagValue(current.title) === normalizeTagValue(tags.title) &&
    normalizeTagValue(current.artist) === normalizeTagValue(tags.artists.join('; ')) &&
    normalizeTagValue(current.album) === normalizeTagValue(tags.album) &&
    normalizeTagValue(current.albumArtist) === normalizeTagValue(tags.albumArtists.join('; ')) &&
    (tags.trackNumber === null || current.trackNumber === tags.trackNumber) &&
    (tags.discNumber === null || current.discNumber === tags.discNumber) &&
    (tags.releaseDate === null ||
      normalizeTagValue(current.releaseDate ?? '') === normalizeTagValue(tags.releaseDate)) &&
    Boolean(current.compilation) === tags.compilation
  )
}

async function validateBufferedMusicFile(
  bytes: Uint8Array,
  extension: string,
  tags: MusicFileTags,
  expectsCover: boolean,
): Promise<void> {
  const current = await inspectBufferedFile(bytes, extension)
  if (current.format === 'unknown') throw new Error(`Tagged ${extension.toUpperCase()} file is invalid.`)
  if (!containsExpectedBufferedTags(current, tags)) {
    throw new Error(`Tagged ${extension.toUpperCase()} file did not retain the requested metadata.`)
  }
  if (expectsCover && current.pictures.length === 0) {
    throw new Error(`Tagged ${extension.toUpperCase()} file did not retain its cover artwork.`)
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

function rewriteId3(metadata: Uint8Array, tags: MusicFileTags, cover: MusicFileCover | null): MetadataRewrite {
  let version = 4
  let preservedFrames: Uint8Array[] = []
  let hasCover = false
  let hadInvalidCover = false
  const current = new Map<string, string>()

  if (metadata.byteLength > 0) {
    if (metadata.byteLength < 10 || !hasAscii(metadata, 0, 'ID3')) throw new Error('MP3 ID3 header is invalid.')
    version = metadata[3]
    if (version !== 3 && version !== 4) throw new Error(`Unsupported ID3 version: 2.${version}.`)
    if (metadata[5] !== 0) throw new Error('ID3 tags with header flags are not supported.')
    const parsed = parseId3Frames(metadata.subarray(10), version)
    preservedFrames = parsed.preserved
    hasCover = parsed.hasCover
    hadInvalidCover = parsed.hadInvalidCover
    for (const [key, value] of parsed.values) current.set(key, value)
  }

  const expected = expectedId3Values(tags, version)
  const needsCover = Boolean(tags.coverUrl && !hasCover)
  if (metadata.byteLength > 0 && containsExpectedValues(current, expected) && !needsCover && !hadInvalidCover) {
    return { complete: true, bytes: metadata, needsCover: false }
  }

  const frames = [...preservedFrames, ...[...expected].map(([id, value]) => buildId3TextFrame(id, value, version))]
  if (cover && !hasCover) frames.push(buildId3CoverFrame(cover, version))
  const body = concatBytes(frames)
  if (body.byteLength > MAX_METADATA_BYTES) throw new Error(`Audio metadata exceeds ${MAX_METADATA_BYTES} bytes.`)
  const header = new Uint8Array(10)
  header.set(new TextEncoder().encode('ID3'))
  header[3] = version
  header.set(writeSynchsafe(body.byteLength), 6)
  return { complete: false, bytes: concatBytes([header, body]), needsCover }
}

function parseId3Frames(
  body: Uint8Array,
  version: number,
): { values: Map<string, string>; preserved: Uint8Array[]; hasCover: boolean; hadInvalidCover: boolean } {
  const values = new Map<string, string>()
  const preserved: Uint8Array[] = []
  let hasCover = false
  let hadInvalidCover = false
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
    } else if (id === 'APIC') {
      try {
        validateId3Picture(frame.subarray(10))
        preserved.push(frame.slice())
        hasCover = true
      } catch {
        hadInvalidCover = true
      }
    } else {
      preserved.push(frame.slice())
    }
    offset = end
  }

  return { values, preserved, hasCover, hadInvalidCover }
}

function validateId3Picture(payload: Uint8Array): void {
  if (payload.byteLength < 5) throw new Error('ID3 APIC frame is incomplete.')
  const encoding = payload[0]
  const mimeEnd = payload.indexOf(0, 1)
  if (mimeEnd === -1 || mimeEnd + 2 >= payload.byteLength) throw new Error('ID3 APIC MIME type is incomplete.')
  const descriptionStart = mimeEnd + 2
  const descriptionEnd =
    encoding === 0 || encoding === 3
      ? payload.indexOf(0, descriptionStart)
      : findUtf16Terminator(payload, descriptionStart)
  if (descriptionEnd === -1) throw new Error('ID3 APIC description is incomplete.')
  const imageStart = descriptionEnd + (encoding === 0 || encoding === 3 ? 1 : 2)
  if (imageStart >= payload.byteLength) throw new Error('ID3 APIC image is empty.')
}

function findUtf16Terminator(bytes: Uint8Array, offset: number): number {
  for (let index = offset; index + 1 < bytes.byteLength; index += 2) {
    if (bytes[index] === 0 && bytes[index + 1] === 0) return index
  }
  return -1
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
  return buildId3Frame(id, payload, version)
}

function buildId3CoverFrame(cover: MusicFileCover, version: number): Uint8Array {
  const mimeType = new TextEncoder().encode(cover.mimeType)
  const payload = concatBytes([new Uint8Array([0]), mimeType, new Uint8Array([0, 3, 0]), cover.bytes])
  return buildId3Frame('APIC', payload, version)
}

function buildId3Frame(id: string, payload: Uint8Array, version: number): Uint8Array {
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

function rewriteFlac(metadata: Uint8Array, tags: MusicFileTags, cover: MusicFileCover | null): MetadataRewrite {
  let blocks = parseFlacBlocks(metadata)
  let hasCover = false
  let hadInvalidCover = false
  blocks = blocks.filter((block) => {
    if (block.type !== 6) return true
    try {
      validateFlacPicture(block.data)
      hasCover = true
      return true
    } catch {
      hadInvalidCover = true
      return false
    }
  })
  const commentIndex = blocks.findIndex((block) => block.type === 4)
  const comments = commentIndex === -1 ? emptyVorbisComments() : parseVorbisComments(blocks[commentIndex].data)
  const expected = expectedVorbisValues(tags)
  const current = groupVorbisComments(comments.entries)
  const needsCover = Boolean(tags.coverUrl && !hasCover)
  if (commentIndex !== -1 && containsExpectedLists(current, expected) && !needsCover && !hadInvalidCover) {
    return { complete: true, bytes: metadata, needsCover: false }
  }

  const entries = comments.entries.filter((entry) => !MANAGED_VORBIS_FIELDS.has(vorbisKey(entry)))
  for (const [key, values] of expected) {
    for (const value of values) entries.push(`${key}=${value}`)
  }
  const commentBlock = { type: 4, data: buildVorbisComments(comments.vendor, entries) }
  if (commentIndex === -1) blocks.splice(1, 0, commentBlock)
  else blocks[commentIndex] = commentBlock
  if (cover && !hasCover) blocks.splice(commentIndex === -1 ? 2 : commentIndex + 1, 0, buildFlacPictureBlock(cover))
  return { complete: false, bytes: buildFlacMetadata(blocks), needsCover }
}

function buildFlacPictureBlock(cover: MusicFileCover): FlacBlock {
  const mimeType = new TextEncoder().encode(cover.mimeType)
  return {
    type: 6,
    data: concatBytes([
      writeUint32Be(3),
      writeUint32Be(mimeType.byteLength),
      mimeType,
      writeUint32Be(0),
      writeUint32Be(0),
      writeUint32Be(0),
      writeUint32Be(0),
      writeUint32Be(0),
      writeUint32Be(cover.bytes.byteLength),
      cover.bytes,
    ]),
  }
}

function validateFlacPicture(data: Uint8Array): true {
  let offset = 0
  readUint32Be(data, offset)
  offset += 4
  const mimeLength = readUint32Be(data, offset)
  offset += 4
  if (offset + mimeLength > data.byteLength) throw new Error('FLAC picture MIME type exceeds the block boundary.')
  offset += mimeLength
  const descriptionLength = readUint32Be(data, offset)
  offset += 4
  if (offset + descriptionLength > data.byteLength) {
    throw new Error('FLAC picture description exceeds the block boundary.')
  }
  offset += descriptionLength
  for (let index = 0; index < 4; index += 1) {
    readUint32Be(data, offset)
    offset += 4
  }
  const pictureLength = readUint32Be(data, offset)
  offset += 4
  if (pictureLength === 0) throw new Error('FLAC picture image is empty.')
  if (offset + pictureLength !== data.byteLength) {
    throw new Error('FLAC picture image length does not match the block boundary.')
  }
  return true
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
  const encoded: Uint8Array[] = [new TextEncoder().encode('fLaC')]
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
