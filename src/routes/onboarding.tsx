import type { DownloaderKind } from '@shared/types'
import { Clapperboard, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createDownloader, createIndexer, createInitialAdmin, createMediaSource } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

export function OnboardingPage({ onComplete }: { onComplete: () => Promise<void> }) {
  const [step, setStep] = useState(() => getOnboardingStep())
  const [name, setName] = useState('Admin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tmdbApiKey, setTmdbApiKey] = useState('')
  const [tmdbLanguage, setTmdbLanguage] = useState('zh-CN')
  const [indexerEndpoint, setIndexerEndpoint] = useState('http://127.0.0.1:9696')
  const [indexerApiKey, setIndexerApiKey] = useState('')
  const [downloaderKind, setDownloaderKind] = useState<DownloaderKind>('zpan')
  const [downloaderEndpoint, setDownloaderEndpoint] = useState('https://zpan.space')
  const [downloaderApiKey, setDownloaderApiKey] = useState('')
  const [downloaderUsername, setDownloaderUsername] = useState('')
  const [downloaderPassword, setDownloaderPassword] = useState('')
  const [downloaderOption, setDownloaderOption] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const steps = ['Administrator', 'Media source', 'Indexer', 'Downloader']
  const languageItems = [
    { label: '中文', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
  ]
  const downloaderKindItems = (['zpan', 'qbittorrent', 'transmission', 'aria2'] as DownloaderKind[]).map((kind) => ({
    label: getDownloaderKindLabel(kind),
    value: kind,
  }))

  async function handleCreateAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await createInitialAdmin({ name, email, password })
      setOnboardingStep(setStep, 1)
      const result = await authClient.signIn.email({ email, password })
      if (result.error) throw new Error(result.error.message || 'Sign in failed.')
      toast.success('Administrator created.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Setup failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMediaSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tmdbApiKey.trim()) {
      setOnboardingStep(setStep, 2)
      return
    }

    setSubmitting(true)
    try {
      await createMediaSource({
        description: 'TMDB',
        kind: 'tmdb',
        credentials: { apiKey: tmdbApiKey.trim() },
        options: { language: tmdbLanguage },
        enabled: true,
      })
      toast.success('Media source saved.')
      setOnboardingStep(setStep, 2)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save media source.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleIndexer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!indexerApiKey.trim()) {
      setOnboardingStep(setStep, 3)
      return
    }

    setSubmitting(true)
    try {
      await createIndexer({
        description: 'Prowlarr',
        kind: 'prowlarr',
        endpoint: indexerEndpoint.trim(),
        credentials: { apiKey: indexerApiKey.trim() },
        options: {},
        enabled: true,
      })
      toast.success('Indexer saved.')
      setOnboardingStep(setStep, 3)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save indexer.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDownloader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!downloaderEndpoint.trim()) {
      clearOnboardingStep()
      await onComplete()
      return
    }

    const credentials: Record<string, string> = {}
    const options: Record<string, string> = {}
    if (downloaderKind === 'zpan' && downloaderApiKey) credentials.apiKey = downloaderApiKey
    if (downloaderKind === 'aria2' && downloaderApiKey) credentials.secret = downloaderApiKey
    if ((downloaderKind === 'qbittorrent' || downloaderKind === 'transmission') && downloaderUsername) {
      credentials.username = downloaderUsername
    }
    if ((downloaderKind === 'qbittorrent' || downloaderKind === 'transmission') && downloaderPassword) {
      credentials.password = downloaderPassword
    }
    if (downloaderKind === 'zpan' && downloaderOption) options.targetFolder = downloaderOption
    if (downloaderKind === 'qbittorrent' && downloaderOption) options.savePath = downloaderOption
    if (downloaderKind === 'transmission' && downloaderOption) options.downloadDir = downloaderOption
    if (downloaderKind === 'aria2' && downloaderOption) options.dir = downloaderOption

    setSubmitting(true)
    try {
      await createDownloader({
        description: getDownloaderKindLabel(downloaderKind),
        kind: downloaderKind,
        endpoint: downloaderEndpoint.trim(),
        credentials,
        options,
        enabled: true,
      })
      toast.success('Downloader saved.')
      clearOnboardingStep()
      await onComplete()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save downloader.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleDownloaderKindChange(kind: DownloaderKind) {
    setDownloaderKind(kind)
    setDownloaderEndpoint(getDefaultDownloaderEndpoint(kind))
    setDownloaderOption('')
    setDownloaderApiKey('')
    setDownloaderUsername('')
    setDownloaderPassword('')
  }

  return (
    <main className="min-h-dvh bg-muted/40 p-4">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-3xl items-center">
        <div className="w-full">
          <div className="mb-8">
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Clapperboard className="size-5" />
            </div>
            <h1 className="font-semibold text-3xl">Initialize ZME</h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Create the first administrator. Media source, indexer, and downloader setup can be completed later in the
              admin area.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
            <div className="space-y-2 text-sm">
              {steps.map((label, index) => (
                <div
                  key={label}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    step === index
                      ? 'border-primary bg-primary text-primary-foreground'
                      : step > index
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'text-muted-foreground',
                  )}
                >
                  {index + 1}. {label}
                </div>
              ))}
            </div>
            <Card className="p-5">
              {step === 0 ? (
                <form onSubmit={handleCreateAdmin} className="flex flex-col gap-4">
                  <label htmlFor="setup-name" className="grid gap-2 text-sm">
                    Name
                    <Input id="setup-name" value={name} onChange={(event) => setName(event.target.value)} required />
                  </label>
                  <label htmlFor="setup-email" className="grid gap-2 text-sm">
                    Email
                    <Input
                      id="setup-email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      required
                    />
                  </label>
                  <label htmlFor="setup-password" className="grid gap-2 text-sm">
                    Password
                    <Input
                      id="setup-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      minLength={8}
                      required
                    />
                  </label>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <LoaderCircle data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <ShieldCheck data-icon="inline-start" />
                    )}
                    Create administrator
                  </Button>
                </form>
              ) : null}

              {step === 1 ? (
                <form onSubmit={handleMediaSource} className="flex flex-col gap-4">
                  <label htmlFor="setup-tmdb-api-key" className="grid gap-2 text-sm">
                    TMDB API Key
                    <Input
                      id="setup-tmdb-api-key"
                      value={tmdbApiKey}
                      onChange={(event) => setTmdbApiKey(event.target.value)}
                      type="password"
                    />
                  </label>
                  <div className="grid gap-2 text-sm">
                    <span>Default language</span>
                    <Select
                      items={languageItems}
                      value={tmdbLanguage}
                      onValueChange={(value) => setTmdbLanguage(value || 'zh-CN')}
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
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                      Save and continue
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setOnboardingStep(setStep, 2)}>
                      Skip
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 2 ? (
                <form onSubmit={handleIndexer} className="flex flex-col gap-4">
                  <label htmlFor="setup-indexer-endpoint" className="grid gap-2 text-sm">
                    Prowlarr endpoint
                    <Input
                      id="setup-indexer-endpoint"
                      value={indexerEndpoint}
                      onChange={(event) => setIndexerEndpoint(event.target.value)}
                      required
                    />
                  </label>
                  <label htmlFor="setup-indexer-api-key" className="grid gap-2 text-sm">
                    API Key
                    <Input
                      id="setup-indexer-api-key"
                      value={indexerApiKey}
                      onChange={(event) => setIndexerApiKey(event.target.value)}
                      type="password"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                      Save and continue
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setOnboardingStep(setStep, 3)}>
                      Skip
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 3 ? (
                <form onSubmit={handleDownloader} className="flex flex-col gap-4">
                  <div className="grid gap-2 text-sm">
                    <span>Downloader</span>
                    <Select
                      items={downloaderKindItems}
                      value={downloaderKind}
                      onValueChange={(value) => handleDownloaderKindChange((value || 'zpan') as DownloaderKind)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(['zpan', 'qbittorrent', 'transmission', 'aria2'] as DownloaderKind[]).map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {getDownloaderKindLabel(kind)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <label htmlFor="setup-downloader-endpoint" className="grid gap-2 text-sm">
                    Endpoint
                    <Input
                      id="setup-downloader-endpoint"
                      value={downloaderEndpoint}
                      onChange={(event) => setDownloaderEndpoint(event.target.value)}
                      required
                    />
                  </label>
                  {downloaderKind === 'zpan' || downloaderKind === 'aria2' ? (
                    <label htmlFor="setup-downloader-api-key" className="grid gap-2 text-sm">
                      {downloaderKind === 'aria2' ? 'Secret' : 'API Key'}
                      <Input
                        id="setup-downloader-api-key"
                        value={downloaderApiKey}
                        onChange={(event) => setDownloaderApiKey(event.target.value)}
                        type="password"
                      />
                    </label>
                  ) : null}
                  {downloaderKind === 'qbittorrent' || downloaderKind === 'transmission' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label htmlFor="setup-downloader-username" className="grid gap-2 text-sm">
                        Username
                        <Input
                          id="setup-downloader-username"
                          value={downloaderUsername}
                          onChange={(event) => setDownloaderUsername(event.target.value)}
                        />
                      </label>
                      <label htmlFor="setup-downloader-password" className="grid gap-2 text-sm">
                        Password
                        <Input
                          id="setup-downloader-password"
                          value={downloaderPassword}
                          onChange={(event) => setDownloaderPassword(event.target.value)}
                          type="password"
                        />
                      </label>
                    </div>
                  ) : null}
                  <label htmlFor="setup-downloader-option" className="grid gap-2 text-sm">
                    {getDownloaderOptionLabel(downloaderKind)}
                    <Input
                      id="setup-downloader-option"
                      value={downloaderOption}
                      onChange={(event) => setDownloaderOption(event.target.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                      Finish
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        clearOnboardingStep()
                        void onComplete()
                      }}
                    >
                      Skip
                    </Button>
                  </div>
                </form>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </main>
  )
}

function getDefaultDownloaderEndpoint(kind: DownloaderKind) {
  if (kind === 'zpan') return 'https://zpan.space'
  if (kind === 'qbittorrent') return 'http://127.0.0.1:8080'
  if (kind === 'transmission') return 'http://127.0.0.1:9091'
  return 'http://127.0.0.1:6800/jsonrpc'
}

function getDownloaderKindLabel(kind: DownloaderKind) {
  if (kind === 'zpan') return 'ZPan'
  if (kind === 'qbittorrent') return 'qBittorrent'
  if (kind === 'transmission') return 'Transmission'
  return 'aria2'
}

function getDownloaderOptionLabel(kind: DownloaderKind) {
  if (kind === 'zpan') return 'Target folder'
  if (kind === 'transmission') return 'Download directory'
  return 'Directory'
}

function getOnboardingStep() {
  const value = window.sessionStorage.getItem('zme.onboarding.step')
  const step = Number(value)
  return Number.isInteger(step) && step >= 0 && step <= 3 ? step : 0
}

function setOnboardingStep(setStep: (step: number) => void, step: number) {
  window.sessionStorage.setItem('zme.onboarding.step', String(step))
  setStep(step)
}

function clearOnboardingStep() {
  window.sessionStorage.removeItem('zme.onboarding.step')
}
