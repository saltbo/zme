import type { MusicConnectorModule } from '@server/usecases/ports'
import { neteaseMusicConnector } from './netease'

const modules: readonly MusicConnectorModule[] = [neteaseMusicConnector]

export function createMusicConnectorRegistry(): ReadonlyMap<string, MusicConnectorModule> {
  return new Map(modules.map((module) => [module.definition.kind, module]))
}
