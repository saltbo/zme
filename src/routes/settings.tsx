import type { ConnectorSummary } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plug, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth'
import { musicConnectorUiModules } from '@/features/music-connectors/registry'
import { deleteConnector, listConnectors, saveDoubanConnector, syncConnector, updateConnector } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { DownloadersPanel } from '@/routes/downloaders'

export function SettingsPage() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <ProfileSettings />
      <ConnectorSettings />
      <DownloadersPanel framed />
    </main>
  )
}

function ProfileSettings() {
  const { user } = useAuth()
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile')}</CardTitle>
        <CardDescription>Identity details are managed by the configured OIDC provider.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm">{user.name}</div>
          <div className="mt-1 text-muted-foreground text-sm">{user.email ?? user.subject}</div>
          <div className="mt-1 text-muted-foreground text-xs">{user.issuer}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ConnectorSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const connectors = useQuery({
    queryKey: queryKeys.connectors.root,
    queryFn: async () => (await listConnectors()).items,
  })
  const douban = connectors.data?.find((item) => item.kind === 'douban') ?? null

  const refreshConnectors = () => queryClient.invalidateQueries({ queryKey: queryKeys.connectors.root })

  const setEnabled = useMutation({
    mutationFn: async (input: { id: string; enabled: boolean; updatedAt: string }) =>
      updateConnector(input.id, { enabled: input.enabled }, input.updatedAt),
    onSuccess: refreshConnectors,
    onError: (error) => toast.error(error instanceof Error ? error.message : t('connectorUpdateFailed')),
  })

  const remove = useMutation({
    mutationFn: (input: { id: string; updatedAt: string }) => deleteConnector(input.id, input.updatedAt),
    onSuccess: async () => {
      await refreshConnectors()
      toast.success(t('connectorDeleted'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('connectorDeleteFailed')),
  })

  const sync = useMutation({
    mutationFn: syncConnector,
    onSuccess: async () => {
      await refreshConnectors()
      toast.success(t('connectorSyncQueued'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('connectorSyncFailed')),
  })

  function connectorActions(item: ConnectorSummary) {
    return {
      syncing: sync.isPending && sync.variables === item.id,
      removing: remove.isPending && remove.variables?.id === item.id,
      onSync: () => sync.mutate(item.id),
      onRemove: () => remove.mutate({ id: item.id, updatedAt: item.updatedAt }),
      onEnabledChange: (enabled: boolean) => setEnabled.mutate({ id: item.id, enabled, updatedAt: item.updatedAt }),
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('connectors')}</CardTitle>
        <CardDescription>{t('connectorsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <ConnectorCard
          icon={<Plug className="size-5" />}
          title={t('douban')}
          description={t('doubanConnectorDescription')}
          connector={douban}
          actions={douban ? connectorActions(douban) : null}
          configure={<DoubanConnectorDialog connector={douban} onSaved={refreshConnectors} />}
        />
        {musicConnectorUiModules.map(({ kind, Icon, titleKey, descriptionKey, Configure }) => {
          const connector = connectors.data?.find((item) => item.kind === kind) ?? null
          return (
            <ConnectorCard
              key={kind}
              icon={<Icon className="size-5" />}
              title={t(titleKey)}
              description={t(descriptionKey)}
              connector={connector}
              actions={connector ? connectorActions(connector) : null}
              configure={<Configure connector={connector} onChanged={refreshConnectors} />}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}

function ConnectorCard({
  icon,
  title,
  description,
  connector,
  actions,
  configure,
}: {
  icon: ReactNode
  title: string
  description: string
  connector: ConnectorSummary | null
  actions: {
    syncing: boolean
    removing: boolean
    onSync: () => void
    onRemove: () => void
    onEnabledChange: (enabled: boolean) => void
  } | null
  configure: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-muted-foreground text-sm">{description}</div>
        </div>
        {connector ? (
          <Switch checked={connector.enabled} onCheckedChange={actions?.onEnabledChange} aria-label={t('enabled')} />
        ) : null}
      </div>
      {connector ? (
        <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
          <div className="font-medium">{connector.displayName}</div>
          <div className="text-muted-foreground">
            {t('lastSynced')}:{' '}
            {connector.lastSyncedAt ? new Date(connector.lastSyncedAt).toLocaleString() : t('neverSynced')}
          </div>
          {connector.lastError ? <div className="text-destructive">{connector.lastError}</div> : null}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">{t('connectorNotConfigured')}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {configure}
        {connector ? (
          <>
            <Button variant="secondary" onClick={actions?.onSync} disabled={actions?.syncing || actions?.removing}>
              {actions?.syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {t('syncNow')}
            </Button>
            <Button variant="ghost" onClick={actions?.onRemove} disabled={actions?.removing || actions?.syncing}>
              {actions?.removing ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {t('delete')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function DoubanConnectorDialog({
  connector,
  onSaved,
}: {
  connector: ConnectorSummary | null
  onSaved: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [profileId, setProfileId] = useState('')

  useEffect(() => {
    if (open) setProfileId(connector?.externalAccountId ?? '')
  }, [connector, open])

  const save = useMutation({
    mutationFn: () => saveDoubanConnector({ profileId, enabled: connector?.enabled ?? true }),
    onSuccess: async () => {
      await onSaved()
      setOpen(false)
      toast.success(t('connectorSaved'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('connectorSaveFailed')),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={connector ? 'outline' : 'default'} />}>
        <Settings2 />
        {connector ? t('configure') : t('connect')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('doubanConnector')}</DialogTitle>
          <DialogDescription>{t('doubanConnectorDialogDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <label htmlFor="settings-douban-profile" className="grid gap-2 text-sm">
            {t('doubanProfile')}
            <Input
              id="settings-douban-profile"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              placeholder={t('doubanProfilePlaceholder')}
              required
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={!profileId.trim() || save.isPending}>
              {save.isPending ? <LoaderCircle className="animate-spin" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
