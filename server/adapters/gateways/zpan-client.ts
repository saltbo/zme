import { type Client, createClient } from '@server/clients/zpan/client'
import { getApiDownloadsTasks, getApiEvents, postApiDownloadsTasks } from '@server/clients/zpan/sdk.gen'
import type {
  GetApiDownloadsTasksData,
  GetApiDownloadsTasksResponse,
  GetApiEventsData,
  PostApiDownloadsTasksData,
  PostApiDownloadsTasksResponse,
} from '@server/clients/zpan/types.gen'

export type ZpanListDownloadTasksParams = NonNullable<GetApiDownloadsTasksData['query']>
export type ZpanStreamDownloadTasksParams = NonNullable<GetApiEventsData['query']>
export type ZpanDownloadTaskPage = GetApiDownloadsTasksResponse
export type ZpanDownloadTask = ZpanDownloadTaskPage['items'][number]
export type ZpanDownloadTaskStatus = ZpanDownloadTask['status']
export type ZpanCreateDownloadTaskInput = PostApiDownloadsTasksData['body']
export type ZpanDownloadTaskEvent = {
  event: string
  data: unknown
}

export class ZpanClient {
  private readonly client: Client

  constructor(endpoint: string, apiKey?: string) {
    this.client = createClient({
      baseUrl: endpoint.replace(/\/+$/, ''),
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    })
  }

  async listDownloadTasks(params: ZpanListDownloadTasksParams): Promise<ZpanDownloadTaskPage> {
    const result = await getApiDownloadsTasks({ client: this.client, query: params })
    return expectData(result, 'ZPan list download tasks failed')
  }

  async createDownloadTask(input: ZpanCreateDownloadTaskInput): Promise<PostApiDownloadsTasksResponse> {
    const result = await postApiDownloadsTasks({ client: this.client, body: input })
    return expectData(result, 'ZPan create download task failed')
  }

  async streamDownloadTaskEvents(
    params: ZpanStreamDownloadTasksParams,
    signal: AbortSignal,
    onEvent: (event: ZpanDownloadTaskEvent) => void,
  ): Promise<void> {
    let streamError: unknown
    const result = await getApiEvents({
      client: this.client,
      query: { ...params, downloadTasks: '1' },
      signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error) => {
        streamError = error
      },
      onSseEvent: (event) => {
        onEvent({ event: event.event || 'message', data: event.data })
      },
    })

    let next = await result.stream.next(false)
    while (!next.done) {
      // Events are emitted through onSseEvent so event names are preserved.
      next = await result.stream.next(false)
    }

    if (streamError && !signal.aborted) {
      throw new Error(getErrorMessage(streamError, 'ZPan download task events failed'))
    }
  }
}

async function expectData<T>(
  result: { data?: T; error?: unknown; response?: Response },
  fallbackMessage: string,
): Promise<T> {
  if (result.data !== undefined) return result.data
  throw new Error(getErrorMessage(result.error, fallbackMessage))
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === 'string') return `${fallbackMessage}: ${error}`
  if (error instanceof Error) return `${fallbackMessage}: ${error.message}`
  if (isErrorObject(error)) return `${fallbackMessage}: ${error.error}`
  return fallbackMessage
}

function isErrorObject(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
}
