import type { IndexerDetails, IndexerInput, IndexerSummary } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Activity, Database, LoaderCircle, MapPin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIndexers } from '@/hooks/use-admin-queries'
import { checkIndexerHealth, createIndexer, deleteIndexer, getIndexer, updateIndexer } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

type IndexerFormState = {
  description: string
  endpoint: string
  apiKey: string
}

const initialForm: IndexerFormState = {
  description: '',
  endpoint: 'http://127.0.0.1:9696',
  apiKey: '',
}

export function IndexersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const indexers = useIndexers()
  const items = indexers.data ?? []
  const loading = indexers.isLoading
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<IndexerFormState>(initialForm)
  const [editForm, setEditForm] = useState<IndexerFormState>(initialForm)

  useEffect(() => {
    if (indexers.error) {
      toast.error(indexers.error instanceof Error ? indexers.error.message : t('indexersLoadFailed'))
    }
  }, [indexers.error, t])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await createIndexer(toIndexerInput(createForm))
      setCreateForm(initialForm)
      await queryClient.invalidateQueries({ queryKey: queryKeys.indexers })
      setCreateOpen(false)
      toast.success(t('indexerCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('indexerCreateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId) return
    setSaving(true)
    try {
      const payload = await updateIndexer(selectedId, toIndexerInput(editForm))
      queryClient.setQueryData<IndexerSummary[]>(queryKeys.indexers, (current = []) =>
        current.map((item) => (item.id === payload.item.id ? payload.item : item)),
      )
      setEditOpen(false)
      toast.success(t('indexerUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('indexerUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (!selectedId) return
    try {
      await deleteIndexer(selectedId)
      queryClient.setQueryData<IndexerSummary[]>(queryKeys.indexers, (current = []) =>
        current.filter((item) => item.id !== selectedId),
      )
      setEditOpen(false)
      setSelectedId(null)
      toast.success(t('indexerDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('indexerDeleteFailed'))
    }
  }

  async function handleHealthCheck(id: string) {
    setCheckingId(id)
    try {
      const payload = await checkIndexerHealth(id)
      queryClient.setQueryData<IndexerSummary[]>(queryKeys.indexers, (current = []) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                healthStatus: payload.health.status,
                healthMessage: payload.health.message,
                healthCheckedAt: payload.health.checkedAt,
              }
            : item,
        ),
      )
      toast.success(t('indexerHealthChecked'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('indexerHealthCheckFailed'))
    } finally {
      setCheckingId(null)
    }
  }

  async function openEdit(item: IndexerSummary) {
    setSelectedId(item.id)
    setEditOpen(true)
    setEditing(true)
    setEditForm(fromSummary(item))
    try {
      const payload = await getIndexer(item.id)
      setEditForm(fromDetails(payload.item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('indexersLoadFailed'))
    } finally {
      setEditing(false)
    }
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          {t('addIndexer')}
        </Button>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('addIndexer')}</SheetTitle>
            <SheetDescription>{t('addIndexerDescription')}</SheetDescription>
          </SheetHeader>
          <IndexerForm
            form={createForm}
            saving={saving}
            submitLabel={t('addIndexer')}
            onChange={setCreateForm}
            onSubmit={handleCreate}
          />
        </SheetContent>
      </Sheet>

      <Sheet
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('editIndexer')}</SheetTitle>
            <SheetDescription>{t('editIndexerDescription')}</SheetDescription>
          </SheetHeader>
          {editing ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : (
            <>
              <IndexerForm
                form={editForm}
                saving={saving}
                submitLabel={t('save')}
                onChange={setEditForm}
                onSubmit={handleUpdate}
              />
              <div className="px-4 pb-4">
                <Separator className="mb-4" />
                <Button type="button" variant="destructive" onClick={() => void handleDeleteSelected()}>
                  <Trash2 data-icon="inline-start" />
                  {t('deleteIndexer')}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {loading ? <IndexersSkeleton /> : null}
      {!loading && items.length === 0 ? <EmptyIndexers /> : null}
      {!loading && items.length > 0 ? (
        <TooltipProvider>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <IndexerCard
                key={item.id}
                item={item}
                checking={checkingId === item.id}
                onEdit={openEdit}
                onHealthCheck={handleHealthCheck}
              />
            ))}
          </div>
        </TooltipProvider>
      ) : null}
    </main>
  )
}

function IndexerForm({
  form,
  onChange,
  onSubmit,
  saving,
  submitLabel,
}: {
  form: IndexerFormState
  onChange: (form: IndexerFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  saving: boolean
  submitLabel: string
}) {
  const { t } = useTranslation()

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
      <Field label={t('indexerKind')}>
        <Input value="Prowlarr" disabled />
      </Field>

      <Field label={t('indexerEndpoint')}>
        <Input
          value={form.endpoint}
          onChange={(event) => onChange({ ...form, endpoint: event.target.value })}
          placeholder="http://127.0.0.1:9696"
          required
        />
      </Field>

      <Field label={t('apiKey')}>
        <Input
          type="password"
          value={form.apiKey}
          onChange={(event) => onChange({ ...form, apiKey: event.target.value })}
          required
        />
      </Field>

      <Field label={t('indexerDescription')}>
        <Input
          value={form.description}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
          placeholder={t('indexerDescriptionPlaceholder')}
        />
      </Field>

      <Button type="submit" disabled={saving}>
        {saving ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <Plus data-icon="inline-start" />
        )}
        {submitLabel}
      </Button>
    </form>
  )
}

function IndexerCard({
  checking,
  item,
  onEdit,
  onHealthCheck,
}: {
  checking: boolean
  item: IndexerSummary
  onEdit: (item: IndexerSummary) => Promise<void>
  onHealthCheck: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <Card
      className="w-full cursor-pointer transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={() => void onEdit(item)}
    >
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Database />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate">Prowlarr</CardTitle>
            <CardDescription className="line-clamp-2">{item.description || t('indexerNoDescription')}</CardDescription>
          </div>
        </div>
        <CardAction>
          <HealthBadge item={item} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 p-3 text-muted-foreground text-xs">
          <MapPin />
          <span className="min-w-0 truncate font-mono text-foreground">{item.endpoint}</span>
        </div>
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <StatusBadge enabled={item.enabled} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onHealthCheck(item.id)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  disabled={checking}
                />
              }
            >
              {checking ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {t('checkConnection')}
            </TooltipTrigger>
            <TooltipContent>{getHealthDetails(item, t)}</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  return <Badge variant={enabled ? 'outline' : 'secondary'}>{enabled ? t('enabled') : t('disabled')}</Badge>
}

function HealthBadge({ item }: { item: IndexerSummary }) {
  const { t } = useTranslation()
  const label =
    item.healthStatus === 'online'
      ? t('healthOnline')
      : item.healthStatus === 'offline'
        ? t('healthOffline')
        : t('healthUnknown')

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={(event) => event.stopPropagation()}
        render={
          <Badge
            variant={item.healthStatus === 'online' ? 'outline' : 'secondary'}
            className={cn(item.healthStatus === 'offline' && 'text-destructive')}
          />
        }
      >
        <Activity />
        {label}
      </TooltipTrigger>
      <TooltipContent>{getHealthDetails(item, t)}</TooltipContent>
    </Tooltip>
  )
}

function Field({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={className}>
      <span className="mb-1.5 block font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
        {label}
      </span>
      {children}
    </div>
  )
}

function IndexersSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  )
}

function EmptyIndexers() {
  const { t } = useTranslation()

  return (
    <Empty className="min-h-[360px] w-full border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>{t('noIndexers')}</EmptyTitle>
        <EmptyDescription>{t('noIndexersDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function toIndexerInput(form: IndexerFormState): IndexerInput {
  return {
    description: form.description.trim() || undefined,
    kind: 'prowlarr',
    endpoint: form.endpoint.trim(),
    credentials: {
      apiKey: form.apiKey,
    },
    options: {},
    enabled: true,
  }
}

function fromSummary(item: IndexerSummary): IndexerFormState {
  return {
    ...initialForm,
    description: item.description || '',
    endpoint: item.endpoint,
  }
}

function fromDetails(item: IndexerDetails): IndexerFormState {
  return {
    description: item.description || '',
    endpoint: item.endpoint,
    apiKey: item.credentials.apiKey || '',
  }
}

function getHealthDetails(item: IndexerSummary, t: (key: string, options?: Record<string, string>) => string) {
  const checkedAt = item.healthCheckedAt ? dayjs(item.healthCheckedAt).fromNow() : t('neverChecked')
  const message = item.healthMessage || t('noHealthMessage')
  return t('healthDetails', { checkedAt, message })
}
