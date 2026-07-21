import type {
  ConnectorLoginResult,
  ConnectorProviderSummary,
  ConnectorSummary,
  DoubanConnectorInput,
  MusicCollectionSummary,
} from '@shared/types'
import { apiRequest } from './client'

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
  return apiRequest<{ item: ConnectorSummary }>('/api/connectors/douban', 'Failed to save Douban connector.', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateConnector(id: string, input: { enabled: boolean }) {
  return apiRequest<{ item: ConnectorSummary }>(`/api/connectors/${id}`, 'Failed to update connector.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteConnector(id: string) {
  return apiRequest<{ id: string }>(`/api/connectors/${id}`, 'Failed to delete connector.', {
    method: 'DELETE',
  })
}

export async function syncConnector(id: string) {
  return apiRequest<{ queued: true }>(`/api/connectors/${id}/sync`, 'Failed to sync connector.', {
    method: 'POST',
  })
}

export async function startConnectorLogin(kind: string, method: string, input: Record<string, string> = {}) {
  return apiRequest<ConnectorLoginResult>('/api/connectors/login-attempts', 'Failed to start connector login.', {
    method: 'POST',
    body: JSON.stringify({ kind, method, input }),
  })
}

export async function getConnectorLoginAttempt(id: string) {
  return apiRequest<ConnectorLoginResult>(
    `/api/connectors/login-attempts/${id}`,
    'Failed to load connector login attempt.',
  )
}

export async function continueConnectorLogin(id: string, action: string, input: Record<string, string> = {}) {
  return apiRequest<ConnectorLoginResult>(
    `/api/connectors/login-attempts/${id}/continue`,
    'Failed to continue connector login.',
    {
      method: 'POST',
      body: JSON.stringify({ action, input }),
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
