import { Clapperboard, ShieldCheck } from 'lucide-react'
import { useLocation } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { loginUrl } from '@/lib/identity'

export function LoginPage() {
  const location = useLocation()
  const returnTo = typeof location.state?.from === 'string' ? location.state.from : '/'
  const error = new URLSearchParams(location.search).get('error')
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </span>
          <div>
            <h1 className="font-semibold text-xl">ZME</h1>
            <p className="text-muted-foreground text-sm">Sign in through the configured identity provider.</p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mb-4 text-sm">
            Sign-in could not be completed. Please try again.
          </p>
        ) : null}
        <a href={loginUrl(returnTo)} className={buttonVariants({ className: 'w-full' })}>
          <ShieldCheck data-icon="inline-start" />
          Continue with identity provider
        </a>
      </Card>
    </main>
  )
}
