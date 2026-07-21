import { describe, expect, it } from 'vitest'
import {
  buildMusicDownloadFilename,
  buildMusicDownloadSubdirectory,
  isValidDownloadSubdirectory,
  sanitizeDownloadPathComponent,
} from './download-metadata'

describe('download metadata', () => {
  it('builds an artist and album hierarchy for music downloads', () => {
    expect(
      buildMusicDownloadSubdirectory({
        title: 'Track',
        artists: ['Track Artist'],
        release: {
          title: 'Album',
          artists: ['Album Artist'],
          releaseDate: '2024-03-02',
          discNumber: 1,
          trackNumber: 3,
        },
      }),
    ).toBe('Album Artist/Album (2024)')
  })

  it('falls back when music metadata is missing', () => {
    expect(
      buildMusicDownloadSubdirectory({
        title: 'Track',
        artists: [],
        release: null,
      }),
    ).toBe('Unknown Artist/Unknown Release')
  })

  it('sanitizes filesystem-sensitive path components', () => {
    expect(
      buildMusicDownloadSubdirectory({
        title: 'Track',
        artists: ['Guest'],
        release: {
          title: 'Hits: Vol. 1. ',
          artists: ['AC/DC'],
          releaseDate: null,
          discNumber: 1,
          trackNumber: 1,
        },
      }),
    ).toBe('AC_DC/Hits_ Vol. 1')
    expect(sanitizeDownloadPathComponent('... ', 'Unknown', 120)).toBe('Unknown')
  })

  it('builds disc and track filenames and preserves compilation artists', () => {
    expect(
      buildMusicDownloadFilename(
        {
          title: 'Track: One',
          artists: ['Track Artist'],
          release: {
            title: 'Compilation',
            artists: ['Various Artists'],
            releaseDate: '2023',
            discNumber: 2,
            trackNumber: 7,
          },
        },
        'FLAC',
      ),
    ).toBe('02-07 Track Artist - Track_ One.flac')
  })

  it('only accepts safe relative subdirectories', () => {
    expect(isValidDownloadSubdirectory('Artist/Album')).toBe(true)
    expect(isValidDownloadSubdirectory('/Artist/Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist/../Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist\\Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist//Album')).toBe(false)
  })
})
