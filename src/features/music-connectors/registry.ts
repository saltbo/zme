import type { ConnectorSummary } from '@shared/types'
import { type LucideIcon, Music2 } from 'lucide-react'
import type { ComponentType } from 'react'
import { NeteaseConnectorDialog } from './netease'

export interface MusicConnectorUiModule {
  kind: string
  Icon: LucideIcon
  titleKey: string
  descriptionKey: string
  Configure: ComponentType<{
    connector: ConnectorSummary | null
    onChanged: () => Promise<unknown>
  }>
}

export const musicConnectorUiModules: readonly MusicConnectorUiModule[] = [
  {
    kind: 'netease',
    Icon: Music2,
    titleKey: 'neteaseMusic',
    descriptionKey: 'neteaseConnectorDescription',
    Configure: NeteaseConnectorDialog,
  },
]

export function findMusicConnectorUiModule(kind: string): MusicConnectorUiModule | null {
  return musicConnectorUiModules.find((module) => module.kind === kind) ?? null
}
