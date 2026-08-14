import { describe, expect, it } from 'vitest'
import {
  buildTitleSearches,
  filterExactMediaMatches,
  scoreResourceResults,
  uniqueById,
  uniqueReleases,
} from './indexer-search'
import {
  analyzeIndexerRelease,
  compareIndexerReleasesByRecommendation,
  getReleaseAvailabilityTier,
} from './release-analysis'
import type { ReleaseCandidateFull } from './types'

describe('media indexer search planning', () => {
  it('keeps more title aliases for multilingual release searches', () => {
    const searches = buildTitleSearches({
      query: '流浪地球 2019',
      title: '流浪地球',
      aliases: [
        'The Wandering Earth',
        'Liu Lang Di Qiu',
        'Wandering Earth',
        '流浪地球1',
        'The Wandering Earth 1',
        'Chinese Sci-Fi Movie',
        'Earth Rescue',
      ],
      year: '2019',
    })

    expect(searches.map((item) => item.query)).toEqual([
      '流浪地球 2019',
      'The Wandering Earth 2019',
      'Liu Lang Di Qiu 2019',
      'Wandering Earth 2019',
      '流浪地球1 2019',
      'The Wandering Earth 1 2019',
      'Chinese Sci-Fi Movie 2019',
      'Earth Rescue 2019',
    ])
  })

  it('orders named title variants, removes case-insensitive duplicates, and labels their source', () => {
    const searches = buildTitleSearches({
      query: 'Original 2024',
      originalTitle: 'Original',
      englishTitle: 'English',
      localizedTitle: 'Localized',
      aliases: ['english', 'Alternative'],
      year: '2024',
    })

    expect(searches.map(({ query, titleKind }) => ({ query, titleKind }))).toEqual([
      { query: 'Original 2024', titleKind: 'original' },
      { query: 'English 2024', titleKind: 'english' },
      { query: 'Localized 2024', titleKind: 'localized' },
      { query: 'Alternative 2024', titleKind: 'alternative' },
    ])
    expect(buildTitleSearches({ query: '' })).toEqual([{ query: '', titleKind: 'original' }])
  })

  it('deduplicates releases by their opaque candidate identity', () => {
    const explicit = release('explicit', 'Release A')
    const sameExplicit = { ...release('explicit', 'Release A mirror') }
    const magnet = release('magnet', 'Release B')
    const sameMagnet = { ...release('magnet', 'Release B mirror') }
    const fallback = release('fallback', 'Release C')

    expect(uniqueReleases([explicit, sameExplicit, magnet, sameMagnet, fallback, fallback])).toEqual([
      explicit,
      magnet,
      fallback,
    ])
  })

  it('scores resource candidates and assigns the requested download target', () => {
    const preferred = release('preferred', 'Roald Dahl Matilda 1988 EPUB')
    preferred.categories = ['Books', 'Ebook']
    preferred.categoryIds = [7000, 7020]
    preferred.seeders = 12
    const unrelated = release('unrelated', 'Different Book EPUB')

    const results = scoreResourceResults([unrelated, preferred], {
      mediaKey: 'openlibrary:work:OL45804W',
      target: 'ebook',
      query: 'Matilda Roald Dahl 1988 ebook',
      title: 'Matilda',
      creators: ['Roald Dahl'],
      year: '1988',
      formats: ['epub'],
    })

    expect(results).toEqual([{ ...preferred, downloadTarget: 'ebook' }])
  })

  it('keeps the first candidate for duplicate opaque identities', () => {
    const first = release('same', 'First')
    const duplicate = release('same', 'Second')

    expect(uniqueById([first, duplicate])).toEqual([first])
  })

  it('does not drop title matches only because the release title omits the year', () => {
    const results = filterExactMediaMatches([release('cn-release', '流浪地球 WEB-DL 1080p')], {
      query: '流浪地球 2019',
      title: '流浪地球',
      aliases: ['The Wandering Earth'],
      year: '2019',
      kind: 'movie',
    })

    expect(results.map((item) => item.id)).toEqual(['cn-release'])
  })

  it('parses common movie release markers from titles', () => {
    const analysis = analyzeIndexerRelease(
      release('dcp-release', 'Example.Movie.2026.1080p.DCPRip.x265.DDP5.1.CHS-Group'),
    )

    expect(analysis.resolution.id).toBe('1080p')
    expect(analysis.source.label).toBe('DCPRip')
    expect(analysis.source.tier).toBe('good')
    expect(analysis.codec).toBe('x265')
    expect(analysis.subtitles).toContain('CHS')
  })

  it('parses lower resolution release markers', () => {
    const analysis = analyzeIndexerRelease(release('small-release', 'Example.Movie.2026.360p.WEBRip.x264'))

    expect(analysis.resolution.id).toBe('360p')
    expect(analysis.resolution.label).toBe('360p')
  })

  it('formats seed counts into stable availability tiers', () => {
    expect([null, 0, 1, 5, 20].map(getReleaseAvailabilityTier)).toEqual(['unknown', 'none', 'low', 'medium', 'high'])
  })

  it('penalizes likely cinema recordings in recommendation sort', () => {
    const web = release('web-release', 'Example.Movie.2026.1080p.WEB-DL.x264')
    const cam = release('cam-release', 'Example.Movie.2026.2160p.HDCAM.x264')
    web.seeders = 8
    cam.seeders = 200

    expect(analyzeIndexerRelease(cam).warnings).toContain('lowQualitySource')
    expect([cam, web].sort(compareIndexerReleasesByRecommendation).map((item) => item.id)).toEqual([
      'web-release',
      'cam-release',
    ])
  })

  it('classifies real indexer movie release titles', () => {
    const cases = [
      {
        title: 'Dune.2021.1080p.BluRay.REMUX.AVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT',
        source: 'REMUX',
        resolution: '1080p',
        codec: 'x264',
        audio: 'Atmos',
        warnings: [],
      },
      {
        title: 'Dune.2021.2160p.HMAX.WEB-DL.DDP5.1.Atmos.HDR.HEVC-EVO[TGx]',
        source: 'WEB-DL',
        resolution: '2160p',
        codec: 'x265',
        audio: 'Atmos',
        warnings: [],
      },
      {
        title: 'Oppenheimer.2023.2160p.UHD.Bluray.REMUX.HDR10.HEVC.DTS-HD.MA.5.1',
        source: 'REMUX',
        resolution: '2160p',
        codec: 'x265',
        audio: 'DTS-HD MA',
        warnings: [],
      },
      {
        title: 'Dune.Part.One.2021.1080p.UHD.BluRay.DD+7.1.x264-LoRD',
        source: 'UHD BluRay',
        resolution: '1080p',
        codec: 'x264',
        audio: 'EAC3',
        warnings: [],
      },
      {
        title: 'Dune 2021 REPACK 4K HDR DV 2160p BDRemux Ita Eng x265 NAHOM mkv',
        source: 'REMUX',
        resolution: '2160p',
        codec: 'x265',
        audio: null,
        warnings: [],
      },
      {
        title: 'Dune.2021.1080p.HDRip.X264-EVO[TGx]',
        source: 'HDRip',
        resolution: '1080p',
        codec: 'x264',
        audio: null,
        warnings: [],
      },
      {
        title: 'Avatar.2009.REMASTERED.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG26',
        source: 'BluRay',
        resolution: '1080p',
        codec: 'x265',
        audio: 'EAC3',
        warnings: [],
      },
      {
        title: 'Thor : Love and Thunder (2022) 1080p HDCAM x264 -ProLover',
        source: 'HDCAM',
        resolution: '1080p',
        codec: 'x264',
        audio: null,
        warnings: ['lowQualitySource'],
      },
      {
        title: 'The.Mandalorian.and.Grogu.2026.1080p.HDTS.h264.Dual.YG',
        source: 'Telesync',
        resolution: '1080p',
        codec: 'x264',
        audio: null,
        warnings: ['lowQualitySource'],
      },
      {
        title: 'Masters of the Universe.2026.1080p.TeleCine.h264.Latino.YG',
        source: 'Telecine',
        resolution: '1080p',
        codec: 'x264',
        audio: null,
        warnings: ['lowQualitySource'],
      },
      {
        title: 'The Devil Wears Prada 2 2026 1080p DCPRip x264-FS',
        source: 'DCPRip',
        resolution: '1080p',
        codec: 'x264',
        audio: null,
        warnings: [],
      },
      {
        title: 'Portrait of A Lady on Fire.2019.DVDSCR.XviD.AC3-EVO[TGx]',
        source: 'Screener',
        resolution: 'other',
        codec: null,
        audio: 'AC3',
        warnings: ['screenerSource'],
      },
      {
        title: 'The.Voice.of.Hind.Rajab.2025.1080p.SCREENER.WEB-DL.H264.AAC-AOC',
        source: 'Screener',
        resolution: '1080p',
        codec: 'x264',
        audio: 'AAC',
        warnings: ['screenerSource'],
      },
      {
        title: 'Hoppers.2026.1080p.CamRip.h265.Latino.YG',
        source: 'CAM',
        resolution: '1080p',
        codec: 'x265',
        audio: null,
        warnings: ['lowQualitySource'],
      },
      {
        title: 'Sintel (2010)DVD5 nl subs NLT-Release',
        source: 'DVDRip',
        resolution: 'other',
        codec: null,
        audio: null,
        warnings: [],
      },
    ] as const

    for (const item of cases) {
      const analysis = analyzeIndexerRelease(release(item.title, item.title))
      expect(
        {
          source: analysis.source.label,
          resolution: analysis.resolution.id,
          codec: analysis.codec,
          audio: analysis.audio,
          warnings: analysis.warnings,
        },
        item.title,
      ).toEqual({
        source: item.source,
        resolution: item.resolution,
        codec: item.codec,
        audio: item.audio,
        warnings: item.warnings,
      })
    }
  })
})

function release(id: string, title: string): ReleaseCandidateFull {
  return {
    id,
    downloadTarget: null,
    title,
    fileName: null,
    indexer: 'Indexer',
    size: null,
    quality: testQuality,
    availability: { tier: 'unknown' },
    seeders: null,
    leechers: null,
    files: null,
    publishDate: null,
    links: { self: `/api/release-candidates/${id}` },
    resourceRef: 'release-ref:v1:test',
    resourceRefExpiresAt: '2026-08-08T00:00:00.000Z',
    sourceType: 'torrent_url',
    infoUrl: null,
    categories: [],
    categoryIds: [],
    indexerFlags: [],
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
  }
}

const testQuality: ReleaseCandidateFull['quality'] = {
  resolution: 'other',
  source: 'unknown',
  codec: null,
  hdr: null,
  audio: null,
  tier: 'unknown',
  warnings: [],
}
