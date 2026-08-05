import type {
  ConnectorLoginResult,
  ConnectorProviderSummary,
  ConnectorSummary,
  ConnectorSyncJobSummary,
  DoubanConnectorInput,
  MusicCollectionSummary,
} from '@shared/types'
import { apiRequest, mergePatch } from './client'

export async function listConnectors() {
  return apiRequest<{ items: ConnectorSummary[] }>('/api/connectors', 'Failed to load connectors.')
}

export async function listConnectorProviders() {
  return apiRequest<{ items: ConnectorProviderSummary[] }>(
    '/api/connectors/providers',
    'Failed to load connector providers.',
  )
}

export async function saveDoubanConnector(input: DoubanConnectorInput) {
  return apiRequest<{ item: ConnectorSummary }>('/api/connectors', 'Failed to save Douban connector.', {
    method: 'POST',
    body: JSON.stringify({ kind: 'douban', ...input }),
  })
}

export async function updateConnector(id: string, input: { enabled: boolean }, expectedUpdatedAt: string) {
  return apiRequest<{ item: ConnectorSummary }>(`/api/connectors/${id}`, 'Failed to update connector.', {
    ...mergePatch(input),
    headers: { ...mergePatch(input).headers, 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function deleteConnector(id: string, expectedUpdatedAt: string) {
  return apiRequest<void>(`/api/connectors/${id}`, 'Failed to delete connector.', {
    method: 'DELETE',
    headers: { 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function syncConnector(id: string) {
  return apiRequest<{ job: ConnectorSyncJobSummary }>('/api/connector-sync-jobs', 'Failed to sync connector.', {
    method: 'POST',
    body: JSON.stringify({ connectorId: id }),
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
}

export async function startConnectorLogin(kind: string, method: string, input: Record<string, string> = {}) {
  return apiRequest<ConnectorLoginResult>('/api/connector-login-attempts', 'Failed to start connector login.', {
    method: 'POST',
    body: JSON.stringify({ kind, method, input }),
  })
}

export async function getConnectorLoginAttempt(id: string) {
  return apiRequest<ConnectorLoginResult>(
    `/api/connector-login-attempts/${id}`,
    'Failed to load connector login attempt.',
  )
}

export async function continueConnectorLogin(id: string, action: string, input: Record<string, string> = {}) {
  return apiRequest<ConnectorLoginResult>(
    `/api/connector-login-attempts/${id}/response`,
    'Failed to continue connector login.',
    {
      method: 'PUT',
      body: JSON.stringify({ challenge: action, input }),
    },
  )
}

export async function listConnectorPlaylists(id: string) {
  return apiRequest<{ items: MusicCollectionSummary[] }>(
    `/api/connectors/${id}/playlists`,
    'Failed to load connector playlists.',
  )
}

export async function saveConnectorPlaylistSelection(id: string, selectedPlaylistIds: string[]) {
  return apiRequest<{ selectedPlaylists: number }>(
    `/api/connectors/${id}/playlists`,
    'Failed to update playlist selection.',
    { method: 'PUT', body: JSON.stringify({ selectedPlaylistIds }) },
  )
}
