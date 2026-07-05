import type { ReactNode } from 'react'

export interface TopbarOverride {
  pathname: string
  title: string
  subtitle: string
  backTo?: string
  actions?: ReactNode
  hideSearch?: boolean
}

export interface AppOutletContext {
  setTopbarOverride: (override: TopbarOverride | null) => void
}
