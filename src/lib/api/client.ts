export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  try {
    const payload = (await response.clone().json()) as { detail?: string; error?: string; code?: string }
    return new ApiError(payload.detail || payload.error || fallbackMessage, response.status, payload.code)
  } catch {
    return new ApiError(fallbackMessage, response.status)
  }
}

export async function apiRequest<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw await apiError(response, fallbackMessage)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export interface ApiPage<T> {
  items: T[]
  pagination: { page: number; pageSize: number; totalItems?: number; totalPages?: number }
}

export async function apiResourcePage<T>(path: string, message: string) {
  const response = await apiRequest<ApiPage<T>>(path, message)
  return {
    results: response.items,
    page: response.pagination.page,
    totalPages:
      response.pagination.totalPages ??
      response.pagination.page + Number(response.items.length === response.pagination.pageSize),
    totalResults:
      response.pagination.totalItems ??
      (response.pagination.page - 1) * response.pagination.pageSize + response.items.length,
  }
}

export function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const value = search.toString()
  return value ? `?${value}` : ''
}

export function jsonBody(input: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(input),
  }
}

export function mergePatch(input: unknown): RequestInit {
  return {
    method: 'PATCH',
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/merge-patch+json' },
  }
}
