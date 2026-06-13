import { apiRequest, jsonBody } from './client'

export async function getSetupStatus() {
  return apiRequest<{ initialized: boolean }>('/api/setup/status', 'Failed to load setup status.')
}

export async function createInitialAdmin(input: { name: string; email: string; password: string }) {
  return apiRequest<{ user: unknown }>('/api/setup/admin', 'Failed to create administrator.', jsonBody(input))
}
