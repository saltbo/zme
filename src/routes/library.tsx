import { useTranslation } from 'react-i18next'
import { FilterBar, MediaWall } from '@/components/media/media-components'
import { Card } from '@/components/ui/card'
import { useLibrary } from '@/contexts/library'

export function LibraryPage() {
  const { items, loading } = useLibrary()
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <FilterBar mode="library" resultCount={items.length} />
      {loading ? <MediaWall items={[]} loading /> : null}
      {!loading && items.length > 0 ? <MediaWall items={items} loading={false} /> : null}
      {!loading && items.length === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-center text-muted-foreground">
          {t('noLibrary')}
        </Card>
      ) : null}
    </div>
  )
}
