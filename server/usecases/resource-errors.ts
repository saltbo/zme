export class IdempotencyConflictError extends Error {}
export class ResourceNotFoundError extends Error {}
export class ResourceConflictError extends Error {}
export class ResourceUpstreamError extends Error {}
export class DownloadManagementUnsupportedError extends ResourceConflictError {}
export class DownloadNotTerminalError extends ResourceConflictError {}
