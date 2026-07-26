import { type AudioFile, type Picture, TagLib } from 'taglib-wasm'

export interface BufferedTagValues {
  title: string
  artist: string
  album: string
  albumArtist: string
  trackNumber: number | null
  discNumber: number | null
  releaseDate: string | null
  compilation: boolean
}

export interface BufferedFileInspection extends BufferedTagValues {
  format: string
  pictures: Picture[]
}

let tagLibPromise: Promise<TagLib> | null = null

export async function inspectBufferedFile(bytes: Uint8Array, extension: string): Promise<BufferedFileInspection> {
  const tagLib = await getTagLib()
  const file = await tagLib.open(namedInput(bytes, extension))
  try {
    if (!file.isValid()) throw new Error(`The ${extension.toUpperCase()} music file is invalid.`)
    return readInspection(file)
  } finally {
    file.dispose()
  }
}

export async function writeBufferedFile(
  bytes: Uint8Array,
  extension: string,
  tags: BufferedTagValues,
  cover: Picture | null,
): Promise<Uint8Array> {
  const tagLib = await getTagLib()
  return tagLib.edit(namedInput(bytes, extension), (file) => {
    const tag = file.tag()
    tag.setTitle(tags.title).setArtist(tags.artist).setAlbum(tags.album)
    if (tags.trackNumber !== null) tag.setTrack(tags.trackNumber)
    if (tags.releaseDate !== null) tag.setDate(tags.releaseDate)
    file.setProperty('ALBUMARTIST', tags.albumArtist)
    if (tags.discNumber !== null) file.setProperty('DISCNUMBER', String(tags.discNumber))
    file.setProperty('COMPILATION', tags.compilation ? '1' : '0')
    if (cover) {
      file.removePictures()
      file.addPicture(cover)
    }
  })
}

function readInspection(file: AudioFile): BufferedFileInspection {
  const tag = file.tag()
  return {
    format: file.getFormat(),
    title: tag.title ?? '',
    artist: tag.artist ?? '',
    album: tag.album ?? '',
    albumArtist: file.getProperty('ALBUMARTIST') ?? '',
    trackNumber: positiveInteger(tag.track),
    discNumber: positiveInteger(file.getProperty('DISCNUMBER')),
    releaseDate: tag.date || null,
    compilation: file.getProperty('COMPILATION') === '1',
    pictures: file.getPictures(),
  }
}

function positiveInteger(value: string | number | undefined): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function namedInput(bytes: Uint8Array, extension: string) {
  return { name: `music.${extension}`, data: bytes }
}

function getTagLib(): Promise<TagLib> {
  tagLibPromise ??= initializeTagLib()
  return tagLibPromise
}

async function initializeTagLib(): Promise<TagLib> {
  if (navigator.userAgent === 'Cloudflare-Workers') {
    const { initializeWorkerTagLib } = await import('./taglib-worker.ts')
    return initializeWorkerTagLib()
  }
  return TagLib.initialize({ forceWasmType: 'emscripten' })
}
