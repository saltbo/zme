import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMusicAlbumDetails, listPopularMusicAlbums, searchMusicAlbums } from './music'

const releaseGroupMbid = 'f5093c06-23e3-404f-aeaa-40f72885ee3a'
const releaseMbid = '59211ea4-fb59-49dd-a69e-83d1666a1aa5'
const recordingMbid = '8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042'

describe('music provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searches MusicBrainz release groups as normalized music albums', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        'release-groups': [
          {
            id: releaseGroupMbid,
            title: 'Blue Train',
            'first-release-date': '1958-01',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
            disambiguation: 'classic album',
            'artist-credit': [
              {
                name: 'John Coltrane',
                artist: { id: 'b625448e-bf4a-41c3-a421-72ad46cdb831', name: 'John Coltrane' },
              },
            ],
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchMusicAlbums({ artist: 'John Coltrane', title: 'Blue Train' })

    expect(results).toEqual([
      {
        mediaKey: `musicbrainz:release-group:${releaseGroupMbid}`,
        provider: 'musicbrainz',
        resourceType: 'release-group',
        mbid: releaseGroupMbid,
        releaseGroupMbid,
        title: 'Blue Train',
        artist: 'John Coltrane',
        artists: [
          {
            id: 'b625448e-bf4a-41c3-a421-72ad46cdb831',
            name: 'John Coltrane',
            joinPhrase: '',
          },
        ],
        firstReleaseDate: '1958-01',
        releaseYear: '1958',
        releaseDate: '1958-01',
        country: null,
        primaryType: 'Album',
        secondaryTypes: ['Compilation'],
        disambiguation: 'classic album',
        coverArt: {
          frontUrl: null,
          frontThumbnailUrl: null,
          backUrl: null,
          backThumbnailUrl: null,
        },
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/ws/2/release-group',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('zme/'),
        }),
      }),
    )
    expect(fetch.mock.calls[0][0].searchParams.get('query')).toBe(
      'primarytype:album AND artist:"John Coltrane" AND releasegroup:"Blue Train"',
    )
  })

  it('keeps q-only API search text broad enough for natural search terms', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ 'release-groups': [] }))
    vi.stubGlobal('fetch', fetch)

    await searchMusicAlbums({ q: 'Blue Train Miles Davis' })

    expect(fetch.mock.calls[0][0].searchParams.get('query')).toBe('primarytype:album AND Blue Train Miles Davis')
  })

  it('loads popular releases from ListenBrainz as release-key music albums', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          payload: {
            releases: [
              {
                release_mbid: releaseMbid,
                release_name: 'Blue Train',
                artist_name: 'John Coltrane',
                artist_mbids: ['b625448e-bf4a-41c3-a421-72ad46cdb831'],
                listen_count: 12000,
              },
            ],
          },
        }),
      ),
    )

    const results = await listPopularMusicAlbums()

    expect(results).toEqual([
      expect.objectContaining({
        mediaKey: `musicbrainz:release:${releaseMbid}`,
        resourceType: 'release',
        mbid: releaseMbid,
        title: 'Blue Train',
        artist: 'John Coltrane',
        primaryType: 'Album',
      }),
    ])
  })

  it('loads release details with cover art, aliases, media formats, tracks, recordings, and isrcs', async () => {
    vi.stubGlobal('fetch', mockDetailsFetch())

    const item = await getMusicAlbumDetails(`musicbrainz:release:${releaseMbid}`)

    expect(item.detailMediaKey).toBe(`musicbrainz:release:${releaseMbid}`)
    expect(item.releaseMbid).toBe(releaseMbid)
    expect(item.releaseGroupMbid).toBe(releaseGroupMbid)
    expect(item.preferredRelease).toEqual({
      mediaKey: `musicbrainz:release:${releaseMbid}`,
      mbid: releaseMbid,
      title: 'Blue Train',
      date: '1958-01',
      country: 'US',
      status: 'Official',
      barcode: '724349534427',
      formats: ['CD'],
    })
    expect(item.coverArt).toEqual({
      frontUrl: 'https://cover.example/front.jpg',
      frontThumbnailUrl: 'https://cover.example/front-500.jpg',
      backUrl: 'https://cover.example/back.jpg',
      backThumbnailUrl: 'https://cover.example/back-250.jpg',
    })
    expect(item.aliases).toEqual([
      {
        name: 'Blue Train alias',
        locale: 'en',
        primary: true,
        type: 'Album name',
      },
      {
        name: 'John Coltrane alias',
        locale: 'en',
        primary: true,
        type: 'Artist name',
      },
    ])
    expect(item.formats).toEqual(['CD'])
    expect(item.media).toEqual([
      {
        position: 1,
        format: 'CD',
        title: null,
        trackCount: 1,
        tracks: [
          {
            position: 1,
            number: '1',
            title: 'Blue Train',
            lengthMs: 643000,
            recordingMbid,
            recordingMediaKey: `musicbrainz:recording:${recordingMbid}`,
            isrcs: ['USBN20300123'],
          },
        ],
      },
    ])
  })

  it('loads release group details through a deterministic preferred release', async () => {
    vi.stubGlobal('fetch', mockDetailsFetch())

    const item = await getMusicAlbumDetails(`musicbrainz:release-group:${releaseGroupMbid}`)

    expect(item.detailMediaKey).toBe(`musicbrainz:release-group:${releaseGroupMbid}`)
    expect(item.releaseMbid).toBe(releaseMbid)
    expect(item.releases.map((release) => release.mbid)).toEqual([releaseMbid])
  })

  it('normalizes missing cover art to null fields', async () => {
    vi.stubGlobal('fetch', mockDetailsFetch({ missingCoverArt: true }))

    const item = await getMusicAlbumDetails(`musicbrainz:release:${releaseMbid}`)

    expect(item.coverArt).toEqual({
      frontUrl: null,
      frontThumbnailUrl: null,
      backUrl: null,
      backThumbnailUrl: null,
    })
  })

  it('fails fast when Cover Art Archive returns a non-404 error', async () => {
    vi.stubGlobal('fetch', mockDetailsFetch({ coverArtStatus: 500 }))

    await expect(getMusicAlbumDetails(`musicbrainz:release:${releaseMbid}`)).rejects.toMatchObject({
      message: 'Cover Art Archive request failed: 500',
      status: 502,
      code: 'COVER_ART_ARCHIVE_REQUEST_FAILED',
    })
  })

  it('fails fast for unsupported music media keys', async () => {
    await expect(getMusicAlbumDetails('musicbrainz:recording:8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042')).rejects.toThrow(
      'Unsupported music media key.',
    )
  })

  it('returns clear provider errors for MusicBrainz failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 502)))

    await expect(searchMusicAlbums({ title: 'Blue Train' })).rejects.toMatchObject({
      message: 'MusicBrainz request failed: 502',
      status: 502,
      code: 'MUSICBRAINZ_REQUEST_FAILED',
    })
  })
})

function mockDetailsFetch(options: { missingCoverArt?: boolean; coverArtStatus?: number } = {}) {
  return vi.fn().mockImplementation((url: URL | string) => {
    const value = url.toString()
    if (value.includes('/ws/2/release-group/')) {
      return Promise.resolve(jsonResponse(releaseGroupResponse()))
    }
    if (value.includes('/ws/2/release/')) {
      return Promise.resolve(jsonResponse(releaseResponse()))
    }
    if (value.includes('/release/') || value.includes('/release-group/')) {
      if (options.coverArtStatus) return Promise.resolve(jsonResponse({}, options.coverArtStatus))
      return Promise.resolve(options.missingCoverArt ? jsonResponse({}, 404) : jsonResponse(coverArtResponse()))
    }

    throw new Error(`Unexpected fetch: ${value}`)
  })
}

function releaseGroupResponse() {
  return {
    id: releaseGroupMbid,
    title: 'Blue Train',
    'first-release-date': '1958-01',
    'primary-type': 'Album',
    'artist-credit': [
      {
        name: 'John Coltrane',
        artist: { id: 'b625448e-bf4a-41c3-a421-72ad46cdb831', name: 'John Coltrane' },
      },
    ],
    releases: [
      {
        id: releaseMbid,
        title: 'Blue Train',
        date: '1958-01',
        country: 'US',
        status: 'Official',
        barcode: '724349534427',
        media: [{ format: 'CD' }],
      },
    ],
  }
}

function releaseResponse() {
  return {
    id: releaseMbid,
    title: 'Blue Train',
    date: '1958-01',
    country: 'US',
    status: 'Official',
    barcode: '724349534427',
    aliases: [
      {
        name: 'Blue Train alias',
        locale: 'en',
        primary: true,
        type: 'Album name',
      },
    ],
    'artist-credit': [
      {
        name: 'John Coltrane',
        artist: {
          id: 'b625448e-bf4a-41c3-a421-72ad46cdb831',
          name: 'John Coltrane',
          aliases: [
            {
              name: 'John Coltrane alias',
              locale: 'en',
              primary: true,
              type: 'Artist name',
            },
          ],
        },
      },
    ],
    'release-group': releaseGroupResponse(),
    media: [
      {
        position: 1,
        format: 'CD',
        'track-count': 1,
        tracks: [
          {
            position: 1,
            number: '1',
            title: 'Blue Train',
            length: 643000,
            recording: {
              id: recordingMbid,
              title: 'Blue Train',
              isrcs: ['USBN20300123'],
            },
          },
        ],
      },
    ],
  }
}

function coverArtResponse() {
  return {
    images: [
      {
        image: 'https://cover.example/front.jpg',
        front: true,
        back: false,
        thumbnails: {
          '500': 'https://cover.example/front-500.jpg',
        },
      },
      {
        image: 'https://cover.example/back.jpg',
        front: false,
        back: true,
        thumbnails: {
          '250': 'https://cover.example/back-250.jpg',
        },
      },
    ],
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}
