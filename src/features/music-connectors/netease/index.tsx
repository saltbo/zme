import type { ConnectorSummary } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Music2, Settings2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  beginNeteaseLogin,
  checkNeteaseLogin,
  listConnectorPlaylists,
  loginNeteaseWithSms,
  saveConnectorPlaylistSelection,
  sendNeteaseSmsCode,
} from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function NeteaseConnectorDialog({
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
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string> | null>(null)
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
  const savePlaylistSelection = useMutation({
    mutationFn: () =>
      saveConnectorPlaylistSelection(connector?.id as string, [...(selectedPlaylistIds ?? new Set<string>())]),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.connectors.playlists(connector?.id ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.music.library('playlist') }),
      ])
      setOpen(false)
      setSelectedPlaylistIds(null)
      toast.success(t('playlistSelectionSaved'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('playlistSelectionFailed')),
  })

  useEffect(() => {
    if (!open || !connector || !playlists.data || selectedPlaylistIds) return
    setSelectedPlaylistIds(
      new Set(playlists.data.filter((playlist) => playlist.libraryAddedAt).map((playlist) => playlist.id)),
    )
  }, [connector, open, playlists.data, selectedPlaylistIds])

  useEffect(() => {
    const nextQrUrl = login.data?.attempt.qrUrl
    if (!attemptId || !nextQrUrl || nextQrUrl === qrUrl) return
    setQrUrl(nextQrUrl)
  }, [attemptId, login.data?.attempt.qrUrl, qrUrl])

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
  const qrVerificationPending =
    loginMethod === 'qr' && Boolean(qrUrl?.startsWith('https://st.music.163.com/encrypt-pages'))

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
    if (!nextOpen && savePlaylistSelection.isPending) return
    setOpen(nextOpen)
    if (nextOpen) {
      setSelectedPlaylistIds(null)
      return
    }
    setAttemptId(null)
    setQrUrl(null)
    setSmsCode('')
    setSmsSent(false)
    setRetriedVerificationAttemptId(null)
    setSelectedPlaylistIds(null)
  }

  function changePlaylistSelection(playlistId: string, selected: boolean) {
    setSelectedPlaylistIds((current) => {
      const next = new Set(
        current ?? playlists.data?.filter((playlist) => playlist.libraryAddedAt).map((playlist) => playlist.id),
      )
      if (selected) next.add(playlistId)
      else next.delete(playlistId)
      return next
    })
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
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              savePlaylistSelection.mutate()
            }}
          >
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
                    <div className="text-muted-foreground text-xs">
                      {t('trackCount', { count: playlist.trackCount })}
                    </div>
                  </div>
                  <Switch
                    checked={selectedPlaylistIds?.has(playlist.id) ?? Boolean(playlist.libraryAddedAt)}
                    disabled={savePlaylistSelection.isPending}
                    onCheckedChange={(selected) => changePlaylistSelection(playlist.id, selected)}
                    aria-label={t('syncPlaylist')}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={savePlaylistSelection.isPending}
                onClick={() => changeOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={!selectedPlaylistIds || savePlaylistSelection.isPending}>
                {savePlaylistSelection.isPending ? (
                  <LoaderCircle data-icon="inline-start" className="animate-spin" />
                ) : null}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
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
                <p className="text-muted-foreground text-sm">
                  {qrVerificationPending ? t('neteaseVerificationTitle') : t('neteaseQrDescription')}
                </p>
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
                {qrVerificationPending ? (
                  <p className="text-muted-foreground text-sm">{t('neteaseVerificationDescription')}</p>
                ) : null}
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
