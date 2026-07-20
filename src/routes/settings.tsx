import type { ConnectorSummary } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Music2, Plug, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAuth } from '@/contexts/auth'
import {
  beginNeteaseLogin,
  checkNeteaseLogin,
  deleteConnector,
  listConnectorPlaylists,
  listConnectors,
  loginNeteaseWithSms,
  saveDoubanConnector,
  selectConnectorPlaylist,
  sendNeteaseSmsCode,
  syncConnector,
  updateConnector,
} from '@/lib/api'
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
  const netease = connectors.data?.find((item) => item.kind === 'netease') ?? null

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
      await Promise.all([
        refreshConnectors(),
        queryClient.invalidateQueries({ queryKey: queryKeys.library.root }),
        queryClient.invalidateQueries({ queryKey: ['music', 'library'] }),
      ])
      toast.success(t('connectorSynced'))
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
        <ConnectorCard
          icon={<Music2 className="size-5" />}
          title={t('neteaseMusic')}
          description={t('neteaseConnectorDescription')}
          connector={netease}
          actions={netease ? connectorActions(netease) : null}
          configure={<NeteaseConnectorDialog connector={netease} onChanged={refreshConnectors} />}
        />
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

function NeteaseConnectorDialog({
  connector,
  onChanged,
}: {
  connector: ConnectorSummary | null
  onChanged: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [loginMethod, setLoginMethod] = useState<'qr' | 'sms'>('qr')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [countryCode, setCountryCode] = useState('86')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsSent, setSmsSent] = useState(false)
  const [retriedVerificationAttemptId, setRetriedVerificationAttemptId] = useState<string | null>(null)
  const begin = useMutation({
    mutationFn: beginNeteaseLogin,
    onSuccess: ({ item }) => {
      setAttemptId(item.id)
      setQrUrl(item.qrUrl)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('neteaseLoginFailed')),
  })
  const sendSms = useMutation({
    mutationFn: () => sendNeteaseSmsCode({ countryCode: countryCode.trim(), phone: phone.trim() }),
    onSuccess: () => {
      setSmsSent(true)
      toast.success(t('smsCodeSent'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('smsCodeSendFailed')),
  })
  const smsLogin = useMutation({
    mutationFn: () =>
      loginNeteaseWithSms({
        countryCode: countryCode.trim(),
        phone: phone.trim(),
        code: smsCode.trim(),
        verificationAttemptId: attemptId ?? undefined,
      }),
    onSuccess: async ({ connector: connected, verification }) => {
      if (verification) {
        setAttemptId(verification.id)
        setQrUrl(verification.qrUrl)
        setRetriedVerificationAttemptId(null)
        return
      }
      if (!connected) return
      await onChanged()
      setAttemptId(null)
      setQrUrl(null)
      setSmsCode('')
      setSmsSent(false)
      toast.success(t('neteaseConnected'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('neteaseLoginFailed')),
  })
  const login = useQuery({
    queryKey: ['connectors', 'netease-login', attemptId],
    queryFn: () => checkNeteaseLogin(attemptId as string),
    enabled: Boolean(open && attemptId),
    refetchInterval: (query) =>
      query.state.data?.attempt.status === 'connected' || query.state.data?.attempt.status === 'expired' ? false : 2000,
  })
  const playlists = useQuery({
    queryKey: queryKeys.connectors.playlists(connector?.id ?? ''),
    queryFn: async () => (await listConnectorPlaylists(connector?.id as string)).items,
    enabled: Boolean(open && connector),
  })
  const select = useMutation({
    mutationFn: (input: { playlistId: string; selected: boolean }) =>
      selectConnectorPlaylist(connector?.id as string, input.playlistId, input.selected),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.connectors.playlists(connector?.id ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.music.library('playlist') }),
      ])
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('playlistSelectionFailed')),
  })

  useEffect(() => {
    if (!attemptId || !login.data?.connector) return
    void onChanged()
    setAttemptId(null)
    setQrUrl(null)
    toast.success(t('neteaseConnected'))
  }, [attemptId, login.data?.connector, onChanged, t])

  useEffect(() => {
    if (
      loginMethod !== 'sms' ||
      !attemptId ||
      login.data?.attempt.status !== 'connected' ||
      login.data.connector ||
      retriedVerificationAttemptId === attemptId
    )
      return
    setRetriedVerificationAttemptId(attemptId)
    smsLogin.mutate()
  }, [attemptId, login.data, loginMethod, retriedVerificationAttemptId, smsLogin.mutate])

  const canSendSms = /^\d{1,4}$/.test(countryCode.trim()) && /^\d{5,20}$/.test(phone.trim())
  const canLoginWithSms = canSendSms && /^\d{4,8}$/.test(smsCode.trim())
  const verificationPending = loginMethod === 'sms' && Boolean(attemptId) && login.data?.attempt.status !== 'connected'

  function changeLoginMethod(values: string[]) {
    const method = values[0]
    if (method !== 'qr' && method !== 'sms') return
    setLoginMethod(method)
    setAttemptId(null)
    setQrUrl(null)
    setRetriedVerificationAttemptId(null)
  }

  function changeSmsRecipient(nextCountryCode: string, nextPhone: string) {
    setCountryCode(nextCountryCode)
    setPhone(nextPhone)
    setSmsCode('')
    setSmsSent(false)
    setAttemptId(null)
    setQrUrl(null)
    setRetriedVerificationAttemptId(null)
  }

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) return
    setAttemptId(null)
    setQrUrl(null)
    setSmsCode('')
    setSmsSent(false)
    setRetriedVerificationAttemptId(null)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button variant={connector ? 'outline' : 'default'} />}>
        <Settings2 />
        {connector ? t('managePlaylists') : t('connect')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('neteaseMusic')}</DialogTitle>
          <DialogDescription>
            {connector ? t('playlistSelectionDescription') : t('neteaseLoginDescription')}
          </DialogDescription>
        </DialogHeader>
        {connector ? (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {playlists.isLoading ? <div className="text-muted-foreground text-sm">{t('loading')}</div> : null}
            {playlists.data?.map((playlist) => (
              <div key={playlist.id} className="flex items-center gap-3 rounded-lg border p-3">
                {playlist.coverUrl ? (
                  <img src={playlist.coverUrl} alt="" className="size-12 rounded-md object-cover" />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded-md bg-muted">
                    <Music2 />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">{playlist.title}</div>
                  <div className="text-muted-foreground text-xs">{t('trackCount', { count: playlist.trackCount })}</div>
                </div>
                <Switch
                  checked={Boolean(playlist.libraryAddedAt)}
                  disabled={select.isPending}
                  onCheckedChange={(selected) => select.mutate({ playlistId: playlist.id, selected })}
                  aria-label={t('syncPlaylist')}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5 py-2">
            <ToggleGroup
              className="grid w-full grid-cols-2"
              variant="outline"
              spacing={0}
              value={[loginMethod]}
              onValueChange={changeLoginMethod}
            >
              <ToggleGroupItem className="w-full" value="qr">
                {t('qrCodeLogin')}
              </ToggleGroupItem>
              <ToggleGroupItem className="w-full" value="sms">
                {t('smsCodeLogin')}
              </ToggleGroupItem>
            </ToggleGroup>

            {loginMethod === 'qr' ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted-foreground text-sm">{t('neteaseQrDescription')}</p>
                {qrUrl ? (
                  <div className="rounded-xl bg-white p-4">
                    <QRCodeSVG value={qrUrl} size={196} />
                  </div>
                ) : (
                  <Button type="button" onClick={() => begin.mutate()} disabled={begin.isPending}>
                    {begin.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                    {t('startQrLogin')}
                  </Button>
                )}
                {login.data?.attempt.status === 'waiting_scan' ? (
                  <p className="text-muted-foreground text-sm">{t('waitingForScan')}</p>
                ) : null}
                {login.data?.attempt.status === 'waiting_confirmation' ? (
                  <p className="text-muted-foreground text-sm">{t('waitingForConfirmation')}</p>
                ) : null}
                {login.data?.attempt.status === 'expired' ? (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-destructive text-sm">{t('qrCodeExpired')}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAttemptId(null)
                        setQrUrl(null)
                        begin.mutate()
                      }}
                      disabled={begin.isPending}
                    >
                      {t('tryAgain')}
                    </Button>
                  </div>
                ) : null}
                {login.isError ? (
                  <p className="text-destructive text-sm">
                    {login.error instanceof Error ? login.error.message : t('neteaseLoginFailed')}
                  </p>
                ) : null}
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  smsLogin.mutate()
                }}
              >
                <FieldGroup>
                  <div className="grid grid-cols-[7rem_1fr] gap-3">
                    <Field>
                      <FieldLabel htmlFor="netease-country-code">{t('countryCode')}</FieldLabel>
                      <Input
                        id="netease-country-code"
                        inputMode="numeric"
                        autoComplete="tel-country-code"
                        value={countryCode}
                        onChange={(event) => changeSmsRecipient(event.target.value, phone)}
                        placeholder="86"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="netease-phone">{t('phoneNumber')}</FieldLabel>
                      <Input
                        id="netease-phone"
                        inputMode="tel"
                        autoComplete="tel-national"
                        value={phone}
                        onChange={(event) => changeSmsRecipient(countryCode, event.target.value)}
                        placeholder={t('phoneNumberPlaceholder')}
                        required
                      />
                    </Field>
                  </div>
                  <FieldDescription>{t('neteaseSmsDescription')}</FieldDescription>
                  {qrUrl && attemptId ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg border p-4 text-center">
                      <p className="font-medium text-sm">{t('neteaseVerificationTitle')}</p>
                      <div className="rounded-xl bg-white p-3">
                        <QRCodeSVG value={qrUrl} size={176} />
                      </div>
                      <p className="text-muted-foreground text-sm">{t('neteaseVerificationDescription')}</p>
                      {login.data?.attempt.status === 'waiting_scan' ? (
                        <p className="text-muted-foreground text-sm">{t('waitingForScan')}</p>
                      ) : null}
                      {login.data?.attempt.status === 'waiting_confirmation' ? (
                        <p className="text-muted-foreground text-sm">{t('waitingForConfirmation')}</p>
                      ) : null}
                      {login.data?.attempt.status === 'connected' ? (
                        <p className="text-muted-foreground text-sm">{t('verificationComplete')}</p>
                      ) : null}
                      {login.data?.attempt.status === 'expired' ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setAttemptId(null)
                            setQrUrl(null)
                            setRetriedVerificationAttemptId(null)
                          }}
                        >
                          {t('tryAgain')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => sendSms.mutate()}
                    disabled={!canSendSms || sendSms.isPending || smsLogin.isPending}
                  >
                    {sendSms.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                    {smsSent ? t('resendSmsCode') : t('sendSmsCode')}
                  </Button>
                  {smsSent ? (
                    <Field>
                      <FieldLabel htmlFor="netease-sms-code">{t('smsCode')}</FieldLabel>
                      <Input
                        id="netease-sms-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]*"
                        maxLength={8}
                        value={smsCode}
                        onChange={(event) => setSmsCode(event.target.value)}
                        placeholder={t('smsCodePlaceholder')}
                        required
                        autoFocus
                      />
                    </Field>
                  ) : null}
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={!smsSent || !canLoginWithSms || verificationPending || smsLogin.isPending}
                    >
                      {smsLogin.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                      {t('connect')}
                    </Button>
                  </DialogFooter>
                </FieldGroup>
              </form>
            )}
          </div>
        )}
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
