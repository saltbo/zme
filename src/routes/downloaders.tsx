import type { DownloaderDetails, DownloaderInput, DownloaderKind, DownloaderSummary } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Activity, Cloud, LoaderCircle, MapPin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import qbittorrentIcon from '@/assets/downloaders/qbittorrent.svg'
import transmissionIcon from '@/assets/downloaders/transmission.svg'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDownloaders } from '@/hooks/use-downloader-queries'
import { checkDownloaderHealth, createDownloader, deleteDownloader, getDownloader, updateDownloader } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'

dayjs.extend(relativeTime)

const downloaderKinds: DownloaderKind[] = ['zpan', 'qbittorrent', 'transmission', 'aria2']

type DownloaderFormState = {
  description: string
  kind: DownloaderKind
  endpoint: string
  username: string
  password: string
  apiKey: string
  secret: string
  option: string
}

const initialForm: DownloaderFormState = {
  description: '',
  kind: 'zpan',
  endpoint: 'https://zpan.space',
  username: '',
  password: '',
  apiKey: '',
  secret: '',
  option: '',
}

export function DownloadersPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <DownloadersPanel />
    </main>
  )
}

export function DownloadersPanel({ framed = false }: { framed?: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const downloaders = useDownloaders()
  const items = downloaders.data ?? []
  const loading = downloaders.isLoading
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<DownloaderFormState>(initialForm)
  const [editForm, setEditForm] = useState<DownloaderFormState>(initialForm)

  useEffect(() => {
    if (downloaders.error) {
      toast.error(downloaders.error instanceof Error ? downloaders.error.message : t('downloadersLoadFailed'))
    }
  }, [downloaders.error, t])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await createDownloader(toDownloaderInput(createForm))
      setCreateForm({ ...initialForm, kind: createForm.kind, endpoint: getDefaultEndpoint(createForm.kind) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.downloaders })
      setCreateOpen(false)
      toast.success(t('downloaderCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloaderCreateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId) return
    setSaving(true)
    try {
      const payload = await updateDownloader(selectedId, toDownloaderInput(editForm))
      queryClient.setQueryData<DownloaderSummary[]>(queryKeys.downloaders, (current = []) =>
        current.map((item) => (item.id === payload.item.id ? payload.item : item)),
      )
      setEditOpen(false)
      toast.success(t('downloaderUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloaderUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (!selectedId) return
    try {
      await deleteDownloader(selectedId)
      queryClient.setQueryData<DownloaderSummary[]>(queryKeys.downloaders, (current = []) =>
        current.filter((item) => item.id !== selectedId),
      )
      setEditOpen(false)
      setSelectedId(null)
      toast.success(t('downloaderDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloaderDeleteFailed'))
    }
  }

  async function handleHealthCheck(id: string) {
    setCheckingId(id)
    try {
      const payload = await checkDownloaderHealth(id)
      queryClient.setQueryData<DownloaderSummary[]>(queryKeys.downloaders, (current = []) =>
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
      toast.success(t('downloaderHealthChecked'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloaderHealthCheckFailed'))
    } finally {
      setCheckingId(null)
    }
  }

  async function openEdit(item: DownloaderSummary) {
    setSelectedId(item.id)
    setEditOpen(true)
    setEditing(true)
    setEditForm(fromSummary(item))
    try {
      const payload = await getDownloader(item.id)
      setEditForm(fromDetails(payload.item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadersLoadFailed'))
    } finally {
      setEditing(false)
    }
  }

  const addButton = (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      {t('addDownloader')}
    </Button>
  )

  const content = (
    <>
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('addDownloader')}</SheetTitle>
            <SheetDescription>{t('addDownloaderDescription')}</SheetDescription>
          </SheetHeader>
          <DownloaderForm
            form={createForm}
            saving={saving}
            submitLabel={t('addDownloader')}
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
            <SheetTitle>{t('editDownloader')}</SheetTitle>
            <SheetDescription>{t('editDownloaderDescription')}</SheetDescription>
          </SheetHeader>
          {editing ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : (
            <>
              <DownloaderForm
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
                  {t('deleteDownloader')}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {loading ? <DownloadersSkeleton /> : null}
      {!loading && items.length === 0 ? <EmptyDownloaders /> : null}
      {!loading && items.length > 0 ? (
        <TooltipProvider>
          <div className="flex flex-wrap gap-4">
            {items.map((item) => (
              <DownloaderCard
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
    </>
  )

  if (framed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('downloaders')}</CardTitle>
          <CardDescription>{t('downloadersSubtitle')}</CardDescription>
          <CardAction>{addButton}</CardAction>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="flex items-center justify-end">{addButton}</div>
      {content}
    </>
  )
}

function DownloaderForm({
  form,
  onChange,
  onSubmit,
  saving,
  submitLabel,
}: {
  form: DownloaderFormState
  onChange: (form: DownloaderFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  saving: boolean
  submitLabel: string
}) {
  const { t } = useTranslation()

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
      <Field label={t('downloaderKind')}>
        <Select
          value={form.kind}
          onValueChange={(value) => {
            const kind = (value || 'zpan') as DownloaderKind
            onChange({ ...form, kind, endpoint: getDefaultEndpoint(kind), option: '' })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {downloaderKinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {getDownloaderKindLabel(kind)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field label={t('downloaderEndpoint')}>
        <Input
          value={form.endpoint}
          onChange={(event) => onChange({ ...form, endpoint: event.target.value })}
          placeholder={getEndpointPlaceholder(form.kind)}
          required
        />
      </Field>

      {form.kind === 'qbittorrent' || form.kind === 'transmission' ? (
        <>
          <Field label={t('username')}>
            <Input value={form.username} onChange={(event) => onChange({ ...form, username: event.target.value })} />
          </Field>
          <Field label={t('password')}>
            <Input
              type="password"
              value={form.password}
              onChange={(event) => onChange({ ...form, password: event.target.value })}
            />
          </Field>
        </>
      ) : null}

      {form.kind === 'zpan' ? (
        <Field label={t('apiKey')}>
          <Input
            type="password"
            value={form.apiKey}
            onChange={(event) => onChange({ ...form, apiKey: event.target.value })}
          />
        </Field>
      ) : null}

      {form.kind === 'aria2' ? (
        <Field label={t('secret')}>
          <Input
            type="password"
            value={form.secret}
            onChange={(event) => onChange({ ...form, secret: event.target.value })}
          />
        </Field>
      ) : null}

      <Field label={getOptionLabel(form.kind, t)}>
        <Input value={form.option} onChange={(event) => onChange({ ...form, option: event.target.value })} />
      </Field>

      <Field label={t('downloaderDescription')}>
        <Input
          value={form.description}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
          placeholder={t('downloaderDescriptionPlaceholder')}
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

function DownloaderCard({
  checking,
  item,
  onEdit,
  onHealthCheck,
}: {
  checking: boolean
  item: DownloaderSummary
  onEdit: (item: DownloaderSummary) => Promise<void>
  onHealthCheck: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const title = getDownloaderKindLabel(item.kind)

  return (
    <Card
      className="w-full cursor-pointer transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[420px]"
      onClick={() => void onEdit(item)}
    >
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <DownloaderIcon kind={item.kind} />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate">{title}</CardTitle>
            <CardDescription className="line-clamp-2">
              {item.description || t('downloaderNoDescription')}
            </CardDescription>
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
        <div className="flex items-center justify-between gap-3">
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

function HealthBadge({ item }: { item: DownloaderSummary }) {
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

function DownloadersSkeleton() {
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

function EmptyDownloaders() {
  const { t } = useTranslation()

  return (
    <Empty className="min-h-[360px] w-full border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Cloud />
        </EmptyMedia>
        <EmptyTitle>{t('noDownloaders')}</EmptyTitle>
        <EmptyDescription>{t('noDownloadersDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function toDownloaderInput(form: DownloaderFormState): DownloaderInput {
  const credentials: Record<string, string> = {}
  const options: Record<string, string> = {}

  if (form.kind === 'zpan' && form.apiKey) credentials.apiKey = form.apiKey
  if ((form.kind === 'qbittorrent' || form.kind === 'transmission') && form.username) {
    credentials.username = form.username
  }
  if ((form.kind === 'qbittorrent' || form.kind === 'transmission') && form.password) {
    credentials.password = form.password
  }
  if (form.kind === 'aria2' && form.secret) credentials.secret = form.secret

  if (form.kind === 'zpan' && form.option) options.targetFolder = form.option
  if (form.kind === 'qbittorrent' && form.option) options.category = form.option
  if (form.kind === 'transmission' && form.option) options.downloadDir = form.option
  if (form.kind === 'aria2' && form.option) options.dir = form.option

  return {
    description: form.description.trim() || undefined,
    kind: form.kind,
    endpoint: form.endpoint.trim(),
    credentials,
    options,
    enabled: true,
  }
}

function DownloaderIcon({ kind }: { kind: DownloaderKind }) {
  if (kind === 'zpan') return <Cloud />

  if (kind === 'qbittorrent') {
    return <img src={qbittorrentIcon} alt="" className="size-6" />
  }

  if (kind === 'transmission') {
    return <img src={transmissionIcon} alt="" className="size-6" />
  }

  return <span className="font-semibold text-[0.65rem] text-muted-foreground">aria2</span>
}

function fromSummary(item: DownloaderSummary): DownloaderFormState {
  return {
    ...initialForm,
    description: item.description || '',
    kind: item.kind,
    endpoint: item.endpoint,
  }
}

function fromDetails(item: DownloaderDetails): DownloaderFormState {
  return {
    description: item.description || '',
    kind: item.kind,
    endpoint: item.endpoint,
    username: item.credentials.username || '',
    password: item.credentials.password || '',
    apiKey: item.credentials.apiKey || '',
    secret: item.credentials.secret || '',
    option: item.options.targetFolder || item.options.category || item.options.downloadDir || item.options.dir || '',
  }
}

function getDownloaderKindLabel(kind: DownloaderKind) {
  if (kind === 'zpan') return 'ZPan'
  if (kind === 'qbittorrent') return 'qBittorrent'
  if (kind === 'transmission') return 'Transmission'
  return 'aria2'
}

function getEndpointPlaceholder(kind: DownloaderKind) {
  return getDefaultEndpoint(kind)
}

function getDefaultEndpoint(kind: DownloaderKind) {
  if (kind === 'zpan') return 'https://zpan.space'
  if (kind === 'qbittorrent') return 'http://127.0.0.1:8080'
  if (kind === 'transmission') return 'http://127.0.0.1:9091'
  return 'http://127.0.0.1:6800/jsonrpc'
}

function getOptionLabel(kind: DownloaderKind, t: (key: string) => string) {
  if (kind === 'zpan') return t('targetFolder')
  if (kind === 'qbittorrent') return t('category')
  return t('downloadDir')
}

function getHealthDetails(item: DownloaderSummary, t: (key: string, options?: Record<string, string>) => string) {
  const checkedAt = item.healthCheckedAt ? dayjs(item.healthCheckedAt).fromNow() : t('neverChecked')
  const message = item.healthMessage || t('noHealthMessage')
  return t('healthDetails', { checkedAt, message })
}
