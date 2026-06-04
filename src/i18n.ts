import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const supportedLanguages = [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]['value']

const resources = {
  'zh-CN': {
    translation: {
      discover: '发现',
      movies: '电影',
      series: '剧集',
      requests: '请求',
      sources: '来源',
      privateDesk: '私人媒体库',
      signedIn: '已登录',
      zpanConnected: 'ZPan 已连接',
      language: '语言',
      searchPlaceholder: '搜索电影或剧集',
      discoverSubtitle: '来自 TMDB 的趋势和热门媒体。',
      moviesSubtitle: '浏览电影元数据。',
      seriesSubtitle: '浏览剧集元数据。',
      trending: '趋势',
      trendingSubtitle: 'TMDB 今日趋势',
      popularMovies: '热门电影',
      popularMoviesSubtitle: 'TMDB 热门电影',
      popularSeries: '热门剧集',
      popularSeriesSubtitle: 'TMDB 热门剧集',
      viewAll: '查看全部',
      movie: '电影',
      tv: '剧集',
      titles: '个标题',
      moviesOnly: '仅电影',
      seriesOnly: '仅剧集',
      mixedDiscoveryWall: '混合发现',
      recommended: '推荐',
      latestMovies: '最新电影',
      latestSeries: '最新剧集',
      subtitles: '字幕',
      filters: '筛选',
      noMedia: '没有找到媒体。',
      noMatchedMedia: '当前视图没有匹配的媒体。',
      noReleases: '配置的索引器没有找到资源。',
      noCast: '没有演职人员信息。',
      noPortrait: '无头像',
      noPoster: '无海报',
      unknown: '未知',
      unknownYear: '未知年份',
      unknownRuntime: '未知时长',
      unknownDirector: '未知导演',
      details: '详情',
      cast: '演员',
      externalIds: '外部 ID',
      director: '导演',
      writers: '编剧',
      country: '国家/地区',
      originalLanguage: '原始语言',
      runtime: '时长',
      rating: '评分',
      indexerSearch: '索引器搜索',
      compareReleases: '对比已配置来源中的资源。',
      results: '个结果',
      searchAgain: '重新搜索',
      saveToZpan: '保存到 ZPan',
      seeders: '做种',
      magnetReady: '磁力链接',
      torrentUrl: '种子链接',
      unknownDate: '未知日期',
      releaseMissingUrl: '这个资源没有可用下载链接。',
      openZpanFailed: '无法打开 ZPan。',
      indexerSearchFailed: '索引器搜索失败。',
      mediaLoadFailed: '媒体加载失败。',
      discoveryLoadFailed: '发现页加载失败。',
      searchFailed: '搜索失败。',
      invalidMediaRoute: '无效的媒体路由。',
      unableToLoadMediaDetails: '无法加载媒体详情。',
      mediaNotFound: '没有找到媒体。',
    },
  },
  'en-US': {
    translation: {
      discover: 'Discover',
      movies: 'Movies',
      series: 'Series',
      requests: 'Requests',
      sources: 'Sources',
      privateDesk: 'Private media desk',
      signedIn: 'Signed in',
      zpanConnected: 'ZPan connected',
      language: 'Language',
      searchPlaceholder: 'Search movies or series',
      discoverSubtitle: 'Trending and popular media from TMDB.',
      moviesSubtitle: 'Browse movie metadata.',
      seriesSubtitle: 'Browse series metadata.',
      trending: 'Trending',
      trendingSubtitle: 'Trending today from TMDB',
      popularMovies: 'Movies',
      popularMoviesSubtitle: 'Popular movies from TMDB',
      popularSeries: 'Series',
      popularSeriesSubtitle: 'Popular series from TMDB',
      viewAll: 'View all',
      movie: 'Movie',
      tv: 'Series',
      titles: 'titles',
      moviesOnly: 'Movies only',
      seriesOnly: 'Series only',
      mixedDiscoveryWall: 'Mixed discovery wall',
      recommended: 'Recommended',
      latestMovies: 'Latest movies',
      latestSeries: 'Latest series',
      subtitles: 'Subtitles',
      filters: 'Filters',
      noMedia: 'No media found.',
      noMatchedMedia: 'No media matched this view.',
      noReleases: 'No releases found from configured indexers.',
      noCast: 'No cast information.',
      noPortrait: 'No portrait',
      noPoster: 'No poster',
      unknown: 'Unknown',
      unknownYear: 'Unknown year',
      unknownRuntime: 'Unknown runtime',
      unknownDirector: 'Unknown director',
      details: 'Details',
      cast: 'Cast',
      externalIds: 'External IDs',
      director: 'Director',
      writers: 'Writers',
      country: 'Country',
      originalLanguage: 'Original language',
      runtime: 'Runtime',
      rating: 'Rating',
      indexerSearch: 'Indexer search',
      compareReleases: 'Compare releases from configured sources before saving.',
      results: 'results',
      searchAgain: 'Search again',
      saveToZpan: 'Save to ZPan',
      seeders: 'seeders',
      magnetReady: 'Magnet ready',
      torrentUrl: 'Torrent URL',
      unknownDate: 'Unknown date',
      releaseMissingUrl: 'This release does not include a usable download link.',
      openZpanFailed: 'Unable to open ZPan.',
      indexerSearchFailed: 'Indexer search failed.',
      mediaLoadFailed: 'Failed to load media.',
      discoveryLoadFailed: 'Failed to load discovery.',
      searchFailed: 'Search failed.',
      invalidMediaRoute: 'Invalid media route.',
      unableToLoadMediaDetails: 'Unable to load media details.',
      mediaNotFound: 'Media not found.',
    },
  },
} as const

i18n.use(initReactI18next).init({
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
  lng: getInitialLanguage(),
  resources,
  supportedLngs: supportedLanguages.map((language) => language.value),
})

export function getTmdbLanguage(language: string): SupportedLanguage {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

function getInitialLanguage(): SupportedLanguage {
  if (typeof window !== 'undefined') {
    const storedLanguage = window.localStorage.getItem('zme.language')
    if (storedLanguage === 'zh-CN' || storedLanguage === 'en-US') {
      return storedLanguage
    }
  }

  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh-CN'
  }

  return 'en-US'
}

export default i18n
