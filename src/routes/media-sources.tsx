import type { MediaSourceDetails, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Activity, Database, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  checkMediaSourceHealth,
  createMediaSource,
  deleteMediaSource,
  getMediaSource,
  listMediaSources,
  updateMediaSource,
} from '@/lib/api'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

type MediaSourceFormState = {
  description: string
  apiKey: string
  language: string
}

const initialForm: MediaSourceFormState = {
  description: 'TMDB',
  apiKey: '',
  language: 'zh-CN',
}

export function MediaSourcesPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<MediaSourceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<MediaSourceFormState>(initialForm)
  const [editForm, setEditForm] = useState<MediaSourceFormState>(initialForm)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await listMediaSources()
      setItems(payload.items)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourcesLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await createMediaSource(toMediaSourceInput(createForm))
      setCreateForm(initialForm)
      await refresh()
      setCreateOpen(false)
      toast.success(t('mediaSourceCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourceCreateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId) return
    setSaving(true)
    try {
      const payload = await updateMediaSource(selectedId, toMediaSourceInput(editForm))
      setItems((current) => current.map((item) => (item.id === payload.item.id ? payload.item : item)))
      setEditOpen(false)
      toast.success(t('mediaSourceUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourceUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (!selectedId) return
    try {
      await deleteMediaSource(selectedId)
      setItems((current) => current.filter((item) => item.id !== selectedId))
      setEditOpen(false)
      setSelectedId(null)
      toast.success(t('mediaSourceDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourceDeleteFailed'))
    }
  }

  async function handleHealthCheck(id: string) {
    setCheckingId(id)
    try {
      const payload = await checkMediaSourceHealth(id)
      setItems((current) =>
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
      toast.success(t('mediaSourceHealthChecked'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourceHealthCheckFailed'))
    } finally {
      setCheckingId(null)
    }
  }

  async function openEdit(item: MediaSourceSummary) {
    setSelectedId(item.id)
    setEditOpen(true)
    setEditing(true)
    setEditForm(fromSummary(item))
    try {
      const payload = await getMediaSource(item.id)
      setEditForm(fromDetails(payload.item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaSourcesLoadFailed'))
    } finally {
      setEditing(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          {t('addMediaSource')}
        </Button>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('addMediaSource')}</SheetTitle>
            <SheetDescription>{t('addMediaSourceDescription')}</SheetDescription>
          </SheetHeader>
          <MediaSourceForm
            form={createForm}
            saving={saving}
            submitLabel={t('addMediaSource')}
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
            <SheetTitle>{t('editMediaSource')}</SheetTitle>
            <SheetDescription>{t('editMediaSourceDescription')}</SheetDescription>
          </SheetHeader>
          {editing ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : (
            <>
              <MediaSourceForm
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
                  {t('deleteMediaSource')}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {loading ? <MediaSourcesSkeleton /> : null}
      {!loading && items.length === 0 ? <EmptyMediaSources /> : null}
      {!loading && items.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {items.map((item) => (
            <MediaSourceCard
              key={item.id}
              item={item}
              checking={checkingId === item.id}
              onEdit={openEdit}
              onHealthCheck={handleHealthCheck}
            />
          ))}
        </div>
      ) : null}
    </main>
  )
}

function MediaSourceForm({
  form,
  onChange,
  onSubmit,
  saving,
  submitLabel,
}: {
  form: MediaSourceFormState
  onChange: (form: MediaSourceFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  saving: boolean
  submitLabel: string
}) {
  const { t } = useTranslation()

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
      <Field label={t('mediaSourceKind')}>
        <Input value="TMDB" disabled />
      </Field>
      <Field label={t('mediaSourceDescription')}>
        <Input value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} />
      </Field>
      <Field label={t('apiKey')}>
        <Input value={form.apiKey} onChange={(event) => onChange({ ...form, apiKey: event.target.value })} required />
      </Field>
      <Field label={t('defaultLanguage')}>
        <Select
          value={form.language}
          onValueChange={(language) => onChange({ ...form, language: language || 'zh-CN' })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={saving}>
        {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  )
}

function MediaSourceCard({
  item,
  checking,
  onEdit,
  onHealthCheck,
}: {
  item: MediaSourceSummary
  checking: boolean
  onEdit: (item: MediaSourceSummary) => void
  onHealthCheck: (id: string) => void
}) {
  const { t } = useTranslation()
  const status = getStatusCopy(item.healthStatus, t)

  return (
    <Card className="w-full max-w-sm overflow-hidden rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-5" />
          TMDB
        </CardTitle>
        <CardDescription>{item.description || t('mediaSourceNoDescription')}</CardDescription>
        <CardAction>
          <Badge variant={item.enabled ? 'default' : 'secondary'}>{item.enabled ? t('enabled') : t('disabled')}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Activity className={cn('size-4', status.className)} />
          <span className={status.className}>{status.label}</span>
          <span className="ml-auto text-muted-foreground">
            {item.healthCheckedAt ? dayjs(item.healthCheckedAt).fromNow() : t('neverChecked')}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onEdit(item)}>
            {t('edit')}
          </Button>
          <Button type="button" variant="secondary" disabled={checking} onClick={() => onHealthCheck(item.id)}>
            {checking ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {t('checkConnection')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyMediaSources() {
  const { t } = useTranslation()
  return (
    <Empty>
      <EmptyMedia>
        <Database />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{t('noMediaSources')}</EmptyTitle>
        <EmptyDescription>{t('noMediaSourcesDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function MediaSourcesSkeleton() {
  return (
    <div className="flex flex-wrap gap-4">
      {['media-source-skeleton-1', 'media-source-skeleton-2'].map((key) => (
        <Skeleton key={key} className="h-56 w-full max-w-sm rounded-lg" />
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 text-sm">
      <span>{label}</span>
      {children}
    </div>
  )
}

function toMediaSourceInput(form: MediaSourceFormState): MediaSourceInput {
  return {
    description: form.description,
    kind: 'tmdb',
    credentials: {
      apiKey: form.apiKey,
    },
    options: {
      language: form.language,
    },
    enabled: true,
  }
}

function fromSummary(item: MediaSourceSummary): MediaSourceFormState {
  return {
    description: item.description || '',
    apiKey: '',
    language: 'zh-CN',
  }
}

function fromDetails(item: MediaSourceDetails): MediaSourceFormState {
  return {
    description: item.description || '',
    apiKey: item.credentials.apiKey || '',
    language: item.options.language || 'zh-CN',
  }
}

function getStatusCopy(status: MediaSourceSummary['healthStatus'], t: (key: string) => string) {
  if (status === 'online') return { label: t('healthOnline'), className: 'text-emerald-600' }
  if (status === 'offline') return { label: t('healthOffline'), className: 'text-destructive' }
  return { label: t('healthUnknown'), className: 'text-muted-foreground' }
}
