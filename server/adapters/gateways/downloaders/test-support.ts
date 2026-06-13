import { vi } from 'vitest'

export interface RecordedRequest {
  url: URL
  method: string
  headers: Headers
  body: string | null
}

/**
 * Stubs global fetch, recording every request and answering from `respond`.
 * Returns the recorded calls for assertions.
 */
export function stubFetch(respond: (request: RecordedRequest, index: number) => Response): RecordedRequest[] {
  const calls: RecordedRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as RequestInfo, init)
      const recorded: RecordedRequest = {
        url: new URL(request.url),
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.text(),
      }
      calls.push(recorded)
      return respond(recorded, calls.length - 1)
    }),
  )
  return calls
}

export function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
}
