import { describe, expect, it } from 'vitest'
import {
  buildMusicDownloadSubdirectory,
  isValidDownloadSubdirectory,
  sanitizeDownloadPathComponent,
} from './download-metadata'

describe('download metadata', () => {
  it('builds an artist and album hierarchy for music downloads', () => {
    expect(buildMusicDownloadSubdirectory(['Artist', 'Guest'], 'Album')).toBe('Artist/Album')
  })

  it('falls back when music metadata is missing', () => {
    expect(buildMusicDownloadSubdirectory([], null)).toBe('Unknown Artist/Unknown Album')
  })

  it('sanitizes filesystem-sensitive path components', () => {
    expect(buildMusicDownloadSubdirectory(['AC/DC'], 'Hits: Vol. 1. ')).toBe('AC_DC/Hits_ Vol. 1')
    expect(sanitizeDownloadPathComponent('... ', 'Unknown', 120)).toBe('Unknown')
  })

  it('only accepts safe relative subdirectories', () => {
    expect(isValidDownloadSubdirectory('Artist/Album')).toBe(true)
    expect(isValidDownloadSubdirectory('/Artist/Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist/../Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist\\Album')).toBe(false)
    expect(isValidDownloadSubdirectory('Artist//Album')).toBe(false)
  })
})
