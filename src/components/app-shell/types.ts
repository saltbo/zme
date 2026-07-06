import type { ReactNode } from 'react'

export type TopbarBackMode = 'history' | 'replace'

export interface TopbarOverride {
  pathname: string
  title: string
  subtitle: string
  backTo?: string
  backMode?: TopbarBackMode
  actions?: ReactNode
  hideSearch?: boolean
}

export interface AppOutletContext {
  setTopbarOverride: (override: TopbarOverride | null) => void
}
