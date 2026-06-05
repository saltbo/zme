import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { type ManagedUser, useManagedUsers } from '@/hooks/use-admin-queries'
import { authClient } from '@/lib/auth-client'
import { queryKeys } from '@/lib/query-keys'

type UserFormState = {
  name: string
  email: string
  password: string
  role: 'user' | 'admin'
}

const initialForm: UserFormState = {
  name: '',
  email: '',
  password: '',
  role: 'user',
}

export function UsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const users = useManagedUsers()
  const items = users.data?.users ?? []
  const currentUserId = users.data?.currentUserId ?? null
  const loading = users.isLoading
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selected, setSelected] = useState<ManagedUser | null>(null)
  const [form, setForm] = useState<UserFormState>(initialForm)
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    if (users.error) {
      toast.error(users.error instanceof Error ? users.error.message : t('usersLoadFailed'))
    }
  }, [users.error, t])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await authClient.admin.createUser({
        email: form.email,
        name: form.name,
        password: form.password,
        role: form.role,
      })
      if (result.error) throw new Error(result.error.message || t('userCreateFailed'))
      setForm(initialForm)
      setCreateOpen(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(t('userCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('userCreateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    try {
      const updateResult = await authClient.admin.updateUser({
        userId: selected.id,
        data: {
          name: form.name,
          email: form.email,
          role: form.role,
        },
      })
      if (updateResult.error) throw new Error(updateResult.error.message || t('userUpdateFailed'))

      if (newPassword) {
        const passwordResult = await authClient.admin.setUserPassword({
          userId: selected.id,
          newPassword,
        })
        if (passwordResult.error) throw new Error(passwordResult.error.message || t('userPasswordUpdateFailed'))
      }

      setEditOpen(false)
      setSelected(null)
      setNewPassword('')
      await queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(t('userUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('userUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleBan(user: ManagedUser) {
    if (user.id === currentUserId) return
    try {
      const result = user.banned
        ? await authClient.admin.unbanUser({ userId: user.id })
        : await authClient.admin.banUser({ userId: user.id, banReason: 'Disabled by administrator' })
      if (result.error) throw new Error(result.error.message || t('userUpdateFailed'))
      await queryClient.invalidateQueries({ queryKey: queryKeys.users })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('userUpdateFailed'))
    }
  }

  async function handleDelete(user: ManagedUser) {
    if (user.id === currentUserId) return
    try {
      const result = await authClient.admin.removeUser({ userId: user.id })
      if (result.error) throw new Error(result.error.message || t('userDeleteFailed'))
      await queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success(t('userDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('userDeleteFailed'))
    }
  }

  function openEdit(user: ManagedUser) {
    setSelected(user)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role === 'admin' ? 'admin' : 'user',
    })
    setNewPassword('')
    setEditOpen(true)
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          {t('addUser')}
        </Button>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('addUser')}</SheetTitle>
            <SheetDescription>{t('addUserDescription')}</SheetDescription>
          </SheetHeader>
          <UserForm
            form={form}
            saving={saving}
            submitLabel={t('addUser')}
            requirePassword
            onChange={setForm}
            onSubmit={handleCreate}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('editUser')}</SheetTitle>
            <SheetDescription>{t('editUserDescription')}</SheetDescription>
          </SheetHeader>
          <UserForm form={form} saving={saving} submitLabel={t('save')} onChange={setForm} onSubmit={handleUpdate} />
          <div className="grid gap-4 px-4 pb-4">
            <Separator />
            <label htmlFor="user-new-password" className="grid gap-2 text-sm">
              {t('newPassword')}
              <Input
                id="user-new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                minLength={8}
                placeholder={t('leaveBlankToKeep')}
              />
            </label>
          </div>
        </SheetContent>
      </Sheet>

      {loading ? <UsersSkeleton /> : null}
      {!loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((user) => (
            <Card key={user.id} className="rounded-lg">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{user.name}</CardTitle>
                  <p className="truncate text-muted-foreground text-sm">{user.email}</p>
                </div>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="shrink-0">
                  {user.role === 'admin' ? t('administrator') : t('standardUser')}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-2 sm:flex sm:flex-wrap">
                <Button type="button" variant="outline" onClick={() => openEdit(user)}>
                  <UserRound data-icon="inline-start" />
                  {t('edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={user.id === currentUserId}
                  onClick={() => void handleToggleBan(user)}
                >
                  <ShieldCheck data-icon="inline-start" />
                  {user.banned ? t('enableUser') : t('disableUser')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={user.id === currentUserId}
                  onClick={() => void handleDelete(user)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t('delete')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </main>
  )
}

function UserForm({
  form,
  onChange,
  onSubmit,
  saving,
  submitLabel,
  requirePassword,
}: {
  form: UserFormState
  onChange: (form: UserFormState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  saving: boolean
  submitLabel: string
  requirePassword?: boolean
}) {
  const { t } = useTranslation()
  const roleItems = [
    { label: t('standardUser'), value: 'user' },
    { label: t('administrator'), value: 'admin' },
  ]

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
      <label htmlFor="user-name" className="grid gap-2 text-sm">
        {t('name')}
        <Input
          id="user-name"
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          required
        />
      </label>
      <label htmlFor="user-email" className="grid gap-2 text-sm">
        Email
        <Input
          id="user-email"
          value={form.email}
          onChange={(event) => onChange({ ...form, email: event.target.value })}
          type="email"
          required
        />
      </label>
      {requirePassword ? (
        <label htmlFor="user-password" className="grid gap-2 text-sm">
          {t('password')}
          <Input
            id="user-password"
            value={form.password}
            onChange={(event) => onChange({ ...form, password: event.target.value })}
            type="password"
            minLength={8}
            required
          />
        </label>
      ) : null}
      <div className="grid gap-2 text-sm">
        <span>{t('role')}</span>
        <Select
          items={roleItems}
          value={form.role}
          onValueChange={(role) => onChange({ ...form, role: role as UserFormState['role'] })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="user">{t('standardUser')}</SelectItem>
              <SelectItem value="admin">{t('administrator')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  )
}

function UsersSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {['user-skeleton-1', 'user-skeleton-2', 'user-skeleton-3'].map((key) => (
        <Skeleton key={key} className="h-40 rounded-lg" />
      ))}
    </div>
  )
}
