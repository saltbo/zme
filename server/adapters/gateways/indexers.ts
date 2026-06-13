import type { IndexerGateway } from '../../usecases/ports'
import { prowlarrIndexerGateway } from './prowlarr'

export const indexerGateways: Record<'prowlarr', IndexerGateway> = {
  prowlarr: prowlarrIndexerGateway,
}
