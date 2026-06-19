import { type Client, createClient } from '@server/clients/zpan/client'
import * as zpanApi from '@server/clients/zpan/sdk.gen'
import type {
  CreateDownloadTaskData,
  DownloadTask,
  DownloadTaskPage,
  ListDownloadTasksData,
  StreamEventsData,
} from '@server/clients/zpan/types.gen'

export type ZpanListDownloadTasksParams = NonNullable<ListDownloadTasksData['query']>
export type ZpanStreamDownloadTasksParams = NonNullable<StreamEventsData['query']>
export type ZpanDownloadTaskPage = DownloadTaskPage
export type ZpanDownloadTask = DownloadTask
export type ZpanDownloadTaskStatus = ZpanDownloadTask['status']
export type ZpanCreateDownloadTaskInput = CreateDownloadTaskData['body']
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
    const result = await zpanApi.listDownloadTasks({ client: this.client, query: params })
    return expectData(result, 'ZPan list download tasks failed')
  }

  async createDownloadTask(input: ZpanCreateDownloadTaskInput): Promise<ZpanDownloadTask> {
    const result = await zpanApi.createDownloadTask({ client: this.client, body: input })
    return expectData(result, 'ZPan create download task failed')
  }

  async streamDownloadTaskEvents(
    params: ZpanStreamDownloadTasksParams,
    signal: AbortSignal,
    onEvent: (event: ZpanDownloadTaskEvent) => void,
  ): Promise<void> {
    let streamError: unknown
    const result = await zpanApi.streamEvents({
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
  const apiMessage = getApiErrorMessage(error)
  if (apiMessage) return `${fallbackMessage}: ${apiMessage}`
  return fallbackMessage
}

// ZPan wraps failures as `{ error: { code, message, status, details } }`.
function getApiErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const { error } = value as { error: unknown }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string') return message
  }
  return null
}
