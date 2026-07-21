import type { ConnectorSummary } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plug, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
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
import { authClient } from '@/lib/auth-client'
import { queryKeys } from '@/lib/query-keys'
import { DownloadersPanel } from '@/routes/downloaders'

export function SettingsPage() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <section className="grid gap-5 xl:grid-cols-2">
        <ProfileSettings />
        <PasswordSettings />
      </section>
      <ConnectorSettings />
      <DownloadersPanel framed />
    </main>
  )
}

function ProfileSettings() {
  const { refreshSession, user } = useAuth()
  const { t } = useTranslation()
  const [name, setName] = useState(user.name)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) return

    setSaving(true)
    try {
      const result = await authClient.updateUser({ name: nextName })
      if (result.error) throw new Error(result.error.message || t('profileUpdateFailed'))
      await refreshSession()
      setOpen(false)
      toast.success(t('profileUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('profileUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile')}</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm">{user.name}</div>
          <div className="mt-1 text-muted-foreground text-sm">{user.email}</div>
        </div>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (nextOpen) setName(user.name)
          }}
        >
          <DialogTrigger render={<Button variant="outline" />}>{t('editProfile')}</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('editProfile')}</DialogTitle>
              <DialogDescription>{t('editProfileDescription')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <label htmlFor="settings-name" className="grid gap-2 text-sm">
                {t('name')}
                <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
    mutationFn: async (input: { id: string; enabled: boolean }) =>
      updateConnector(input.id, { enabled: input.enabled }),
    onSuccess: refreshConnectors,
    onError: (error) => toast.error(error instanceof Error ? error.message : t('connectorUpdateFailed')),
  })

  const remove = useMutation({
    mutationFn: deleteConnector,
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
      removing: remove.isPending && remove.variables === item.id,
      onSync: () => sync.mutate(item.id),
      onRemove: () => remove.mutate(item.id),
      onEnabledChange: (enabled: boolean) => setEnabled.mutate({ id: item.id, enabled }),
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

function PasswordSettings() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'))
      return
    }

    setSaving(true)
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) throw new Error(result.error.message || t('passwordUpdateFailed'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setOpen(false)
      toast.success(t('passwordUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('passwordUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('password')}</CardTitle>
        <CardDescription>{t('passwordSettingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="text-muted-foreground text-sm">••••••••••••</div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="outline" />}>{t('changePassword')}</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('changePassword')}</DialogTitle>
              <DialogDescription>{t('passwordSettingsDescription')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <label htmlFor="settings-current-password" className="grid gap-2 text-sm">
                {t('currentPassword')}
                <Input
                  id="settings-current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  required
                />
              </label>
              <label htmlFor="settings-new-password" className="grid gap-2 text-sm">
                {t('newPassword')}
                <Input
                  id="settings-new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  minLength={8}
                  required
                />
              </label>
              <label htmlFor="settings-confirm-password" className="grid gap-2 text-sm">
                {t('confirmPassword')}
                <Input
                  id="settings-confirm-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  minLength={8}
                  required
                />
              </label>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
