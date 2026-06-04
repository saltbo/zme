import { LoaderCircle } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth'
import { authClient } from '@/lib/auth-client'
import { DownloadersPanel } from '@/routes/downloaders'

export function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <section className="grid gap-5 xl:grid-cols-2">
        <ProfileSettings />
        <PasswordSettings />
      </section>
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
