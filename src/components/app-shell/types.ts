import type { ReactNode } from 'react'

export interface TopbarOverride {
  pathname: string
  title: string
  subtitle: string
  actions?: ReactNode
}

export interface AppOutletContext {
  setTopbarOverride: (override: TopbarOverride | null) => void
}
