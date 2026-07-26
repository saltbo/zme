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
