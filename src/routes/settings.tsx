import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth'
import { deleteLibrarySource, listLibrarySources, saveLibrarySource, syncLibrarySource } from '@/lib/api'
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
      <LibraryImportSettings />
      <DownloadersPanel framed />
    </main>
  )
}

function ProfileSettings() {
  const { refreshSession, user } = useAuth()
  const { t } = useTranslation()
  const [name, setName] = useState(user.name)
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
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <label htmlFor="settings-name" className="grid gap-2 text-sm">
            {t('name')}
            <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {t('save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function LibraryImportSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const sources = useQuery({
    queryKey: queryKeys.librarySources,
    queryFn: async () => (await listLibrarySources()).items,
  })
  const douban = sources.data?.find((item) => item.source === 'douban') ?? null
  const [profileId, setProfileId] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!douban) return
    setProfileId(douban.profileId)
    setEnabled(douban.enabled)
  }, [douban])

  const saveSource = useMutation({
    mutationFn: async () => saveLibrarySource('douban', { profileId, enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySources })
      toast.success(t('librarySourceSaved'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('librarySourceSaveFailed')),
  })

  const removeSource = useMutation({
    mutationFn: async () => deleteLibrarySource('douban'),
    onSuccess: async () => {
      setProfileId('')
      setEnabled(true)
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySources })
      toast.success(t('librarySourceDeleted'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('librarySourceDeleteFailed')),
  })

  const syncSource = useMutation({
    mutationFn: async () => syncLibrarySource('douban'),
    onSuccess: async (payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySources }),
        queryClient.invalidateQueries({ queryKey: queryKeys.library }),
      ])
      toast.success(t('librarySourceSynced', { ...payload.result }))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('librarySourceSyncFailed')),
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId.trim()) return
    saveSource.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('libraryImports')}</CardTitle>
        <CardDescription>{t('libraryImportsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <label htmlFor="settings-douban-profile" className="grid gap-2 text-sm">
            {t('doubanProfile')}
            <Input
              id="settings-douban-profile"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              placeholder={t('doubanProfilePlaceholder')}
              disabled={saveSource.isPending || syncSource.isPending}
            />
          </label>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="font-medium text-sm">{t('automaticSync')}</div>
              <div className="text-muted-foreground text-xs">{t('automaticSyncDescription')}</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saveSource.isPending} />
          </div>
          {douban ? (
            <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="text-muted-foreground">
                {t('lastSynced')}:{' '}
                {douban.lastSyncedAt ? new Date(douban.lastSyncedAt).toLocaleString() : t('neverSynced')}
              </div>
              {douban.lastResult ? (
                <div className="text-muted-foreground">{t('librarySourceLastResult', { ...douban.lastResult })}</div>
              ) : null}
              {douban.lastError ? <div className="text-destructive">{douban.lastError}</div> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!profileId.trim() || saveSource.isPending || syncSource.isPending}>
              {saveSource.isPending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {t('save')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!douban || syncSource.isPending || saveSource.isPending}
              onClick={() => syncSource.mutate()}
            >
              {syncSource.isPending ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {t('syncNow')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!douban || removeSource.isPending || syncSource.isPending}
              onClick={() => removeSource.mutate()}
            >
              {removeSource.isPending ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {t('delete')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordSettings() {
  const { t } = useTranslation()
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
      <CardContent>
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
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {t('save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
