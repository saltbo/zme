import type { AppConfig } from '@server/config'

export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api'

const agentScope = {
  mediaRead: 'media:read',
  releaseCandidatesRead: 'release-candidates:read',
  downloadersRead: 'downloaders:read',
  downloadsRead: 'downloads:read',
  downloadsWrite: 'downloads:write',
  downloadsManage: 'downloads:manage',
} as const

type AgentScope = (typeof agentScope)[keyof typeof agentScope]

export const AGENT_OPERATION_POLICIES = [
  policy('listMedia', 'GET', '/media', agentScope.mediaRead),
  policy('listReleaseCandidates', 'GET', '/release-candidates', agentScope.releaseCandidatesRead),
  policy('listDownloaders', 'GET', '/downloaders', agentScope.downloadersRead),
  policy('getDownloader', 'GET', '/downloaders/{id}', agentScope.downloadersRead),
  policy('listDownloads', 'GET', '/downloads', agentScope.downloadsRead),
  policy('getDownload', 'GET', '/downloads/{downloadId}', agentScope.downloadsRead),
  policy('getDownloadSuspension', 'GET', '/downloads/{downloadId}/suspension', agentScope.downloadsRead),
  policy('getDownloadCancellation', 'GET', '/downloads/{downloadId}/cancellation', agentScope.downloadsRead),
  policy('createDownload', 'POST', '/downloads', agentScope.downloadsWrite),
  policy('deleteDownload', 'DELETE', '/downloads/{downloadId}', agentScope.downloadsManage),
  policy('createDownloadSuspension', 'PUT', '/downloads/{downloadId}/suspension', agentScope.downloadsManage),
  policy('deleteDownloadSuspension', 'DELETE', '/downloads/{downloadId}/suspension', agentScope.downloadsManage),
  policy('createDownloadCancellation', 'PUT', '/downloads/{downloadId}/cancellation', agentScope.downloadsManage),
] as const

export const AGENT_SCOPES = Object.freeze(Object.values(agentScope))

export function agentScopeForOperation(operationId: string): AgentScope {
  const operation = AGENT_OPERATION_POLICIES.find((candidate) => candidate.operationId === operationId)
  if (!operation) throw new Error(`Missing Agent authorization policy for ${operationId}.`)
  return operation.scope
}

export function agentScopeForRequest(method: string, path: string): AgentScope | null {
  const operation = AGENT_OPERATION_POLICIES.find(
    (candidate) => candidate.method === method && matchesPath(candidate.path, path),
  )
  return operation?.scope ?? null
}

export function protectedResourceMetadata(config: AppConfig) {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.oidc.issuer],
    scopes_supported: AGENT_SCOPES,
    bearer_methods_supported: [],
    resource_name: 'ZME Private Media Library',
    dpop_signing_alg_values_supported: config.oidc.allowedAlgorithms,
    dpop_bound_access_tokens_required: true,
  }
}

function policy(operationId: string, method: string, path: string, scope: AgentScope) {
  return { operationId, method, path, scope }
}

function matchesPath(template: string, path: string): boolean {
  const templateSegments = template.split('/')
  const pathSegments = path.split('/')
  return (
    templateSegments.length === pathSegments.length &&
    templateSegments.every((segment, index) =>
      segment.startsWith('{') && segment.endsWith('}') ? Boolean(pathSegments[index]) : segment === pathSegments[index],
    )
  )
}
