import type { IndexerGateway } from '@server/usecases/ports'
import { prowlarrIndexerGateway } from './prowlarr'

export const indexerGateways: Record<'prowlarr', IndexerGateway> = {
  prowlarr: prowlarrIndexerGateway,
}
