export interface TopbarOverride {
  pathname: string
  title: string
  subtitle: string
}

export interface AppOutletContext {
  setTopbarOverride: (override: TopbarOverride | null) => void
}
