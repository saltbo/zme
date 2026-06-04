import { LoaderCircle } from 'lucide-react'

export function FullPageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 text-muted-foreground">
      <LoaderCircle className="mr-2 size-5 animate-spin" />
      Loading
    </div>
  )
}
