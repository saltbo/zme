export type ResourceSearchSort = 'best' | 'newest' | 'oldest' | 'title'

export function getResourceSearchSort(value: string | null | undefined): ResourceSearchSort {
  if (value === 'newest' || value === 'oldest' || value === 'title') return value
  return 'best'
}

export function getResourceSearchSortOptions(t: (key: string) => string) {
  return [
    { value: 'best' as const, label: t('sortByBestMatch') },
    { value: 'newest' as const, label: t('sortByNewest') },
    { value: 'oldest' as const, label: t('sortByOldest') },
    { value: 'title' as const, label: t('sortByTitle') },
  ]
}

export function parseResourceYear(value: string | number | null | undefined) {
  const year = Number(value)
  return Number.isFinite(year) ? year : 0
}

export function compareResourceTitle(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}
