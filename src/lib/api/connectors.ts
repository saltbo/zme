import type {
  ConnectorLoginAttempt,
  ConnectorSummary,
  ConnectorSyncResult,
  DoubanConnectorInput,
  MusicCollectionSummary,
  NeteaseSmsCodeInput,
  NeteaseSmsLoginInput,
} from '@shared/types'
import { apiRequest } from './client'

export async function listConnectors() {
  return apiRequest<{ items: ConnectorSummary[] }>('/api/connectors', 'Failed to load connectors.')
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
  return apiRequest<{ result: ConnectorSyncResult }>(`/api/connectors/${id}/sync`, 'Failed to sync connector.', {
    method: 'POST',
  })
}

export async function beginNeteaseLogin() {
  return apiRequest<{ item: ConnectorLoginAttempt }>(
    '/api/connectors/netease/login-attempts',
    'Failed to start Netease login.',
    { method: 'POST' },
  )
}

export async function checkNeteaseLogin(id: string) {
  return apiRequest<{ attempt: ConnectorLoginAttempt; connector: ConnectorSummary | null }>(
    `/api/connectors/netease/login-attempts/${id}/check`,
    'Failed to check Netease login.',
    { method: 'POST' },
  )
}

export async function sendNeteaseSmsCode(input: NeteaseSmsCodeInput) {
  return apiRequest<{ sent: true }>('/api/connectors/netease/sms-codes', 'Failed to send Netease SMS code.', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function loginNeteaseWithSms(input: NeteaseSmsLoginInput) {
  return apiRequest<{ item: ConnectorSummary }>('/api/connectors/netease/sms-login', 'Netease SMS login failed.', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listConnectorPlaylists(id: string) {
  return apiRequest<{ items: MusicCollectionSummary[] }>(
    `/api/connectors/${id}/playlists`,
    'Failed to load connector playlists.',
  )
}

export async function selectConnectorPlaylist(id: string, playlistId: string, selected: boolean) {
  return apiRequest<{ item: MusicCollectionSummary }>(
    `/api/connectors/${id}/playlists/${playlistId}`,
    'Failed to update playlist selection.',
    { method: 'PUT', body: JSON.stringify({ selected }) },
  )
}
