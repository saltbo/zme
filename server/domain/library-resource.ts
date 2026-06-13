import { buildTmdbMediaKey, getMediaKeyLibraryKind, parseTmdbMediaKey } from '@shared/media-key'
import type { LibraryKind, LibraryMediaInput, LibraryResourceInput, MediaKind } from '@shared/types'

export interface LibraryResourceIdentity {
  mediaKey: string
  kind: LibraryKind
  tmdbId: number | null
}

/** Normalizes the two accepted library inputs into one identity, validating media keys. */
export function toLibraryResource(input: LibraryMediaInput | LibraryResourceInput): LibraryResourceIdentity {
  if ('mediaKey' in input) {
    const kind = getMediaKeyLibraryKind(input.mediaKey)
    if (!kind) throw new Error(`Invalid library media key: ${input.mediaKey}`)
    if (kind !== input.kind) throw new Error(`Library kind does not match media key: ${input.mediaKey}`)

    const tmdb = parseTmdbMediaKey(input.mediaKey)
    return {
      mediaKey: input.mediaKey,
      kind: input.kind,
      tmdbId: tmdb?.kind === input.kind ? tmdb.tmdbId : null,
    }
  }

  return toTmdbLibraryResource(input)
}

function toTmdbLibraryResource(input: LibraryMediaInput): {
  mediaKey: string
  kind: MediaKind
  tmdbId: number
} {
  return {
    mediaKey: buildTmdbMediaKey(input.kind, input.id),
    kind: input.kind,
    tmdbId: input.id,
  }
}
