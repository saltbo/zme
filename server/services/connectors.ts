import type { ConnectorConfig } from '../usecases/ports'

export function toConnectorConfig(row: {
  endpoint: string
  credentialsJson: string
  optionsJson: string
}): ConnectorConfig {
  return {
    endpoint: row.endpoint,
    credentials: JSON.parse(row.credentialsJson) as Record<string, string>,
    options: JSON.parse(row.optionsJson) as Record<string, string>,
  }
}
