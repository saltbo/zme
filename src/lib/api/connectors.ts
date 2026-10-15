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
  return apiRequest<ConnectorSummary>('/api/connectors', 'Failed to save Douban connector.', {
    method: 'POST',
    body: JSON.stringify({ kind: 'douban', ...input }),
  })
}

export async function updateConnector(id: string, input: { enabled: boolean }) {
  return apiRequest<ConnectorSummary>(`/api/connectors/${id}`, 'Failed to update connector.', {
    ...mergePatch(input),
  })
}

export async function deleteConnector(id: string) {
  return apiRequest<void>(`/api/connectors/${id}`, 'Failed to delete connector.', {
    method: 'DELETE',
  })
}

export async function syncConnector(id: string) {
  return apiRequest<ConnectorSyncJobSummary>('/api/connector-sync-jobs', 'Failed to sync connector.', {
    method: 'POST',
    body: JSON.stringify({ connectorId: id }),
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
}

export async function startConnectorLogin(kind: string, method: string, input: Record<string, string> = {}) {
  const response = await apiRequest<LoginAttemptResource>(
    '/api/connector-login-attempts',
    'Failed to start connector login.',
    {
      method: 'POST',
      body: JSON.stringify({ kind, method, input }),
    },
  )
  return loginResult(response)
}

export async function getConnectorLoginAttempt(id: string) {
  const response = await apiRequest<LoginAttemptResource>(
    `/api/connector-login-attempts/${id}`,
    'Failed to load connector login attempt.',
  )
  return loginResult(response)
}

type LoginAttemptResource = ConnectorLoginResult['attempt'] & {
  connector: ConnectorLoginResult['connector']
  links: Record<string, string>
}

function loginResult(resource: LoginAttemptResource): ConnectorLoginResult {
  const { connector, links: _links, ...attempt } = resource
  return { attempt, connector }
}

export async function submitConnectorChallengeResponse(id: string, input: Record<string, string>) {
  await apiRequest(`/api/connector-login-attempts/${id}/challenge-response`, 'Failed to continue connector login.', {
    method: 'PUT',
    body: JSON.stringify({ input }),
  })
  return getConnectorLoginAttempt(id)
}

export async function listConnectorPlaylists(id: string) {
  return apiRequest<{ items: MusicCollectionSummary[] }>(
    `/api/connectors/${id}/playlists`,
    'Failed to load connector playlists.',
  )
}

export async function saveConnectorPlaylistSelection(id: string, selectedPlaylistIds: string[]) {
  return apiRequest<{ selectedPlaylistIds: string[]; links: { syncJob: string } }>(
    `/api/connectors/${id}/playlist-selection`,
    'Failed to update playlist selection.',
    { method: 'PUT', body: JSON.stringify({ selectedPlaylistIds }) },
  )
}
