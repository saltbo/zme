export interface TraceContext {
  traceparent: string
  tracestate?: string
  traceId: string
  spanId: string
}

export interface TraceCarrier {
  traceparent?: string
  tracestate?: string
}

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function startTrace(headers: Headers): TraceContext {
  return continueTrace({
    traceparent: headers.get('traceparent') ?? undefined,
    tracestate: headers.get('tracestate') ?? undefined,
  })
}

export function continueTrace(carrier: TraceCarrier): TraceContext {
  const parent = parseTraceparent(carrier.traceparent)
  const traceId = parent?.traceId ?? randomHex(16)
  const flags = parent?.flags ?? '01'
  const spanId = randomHex(8)
  const tracestate = validTracestate(carrier.tracestate) ? carrier.tracestate : undefined
  return {
    traceparent: `00-${traceId}-${spanId}-${flags}`,
    ...(tracestate ? { tracestate } : {}),
    traceId,
    spanId,
  }
}

export function traceCarrier(context: TraceContext | undefined): TraceCarrier {
  return context
    ? { traceparent: context.traceparent, ...(context.tracestate ? { tracestate: context.tracestate } : {}) }
    : {}
}

function parseTraceparent(value: string | undefined): { traceId: string; flags: string } | null {
  const match = value?.match(traceparentPattern)
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null
  return { traceId: match[1], flags: match[3] }
}

function validTracestate(value: string | undefined): value is string {
  return Boolean(value && value.length <= 512 && !/[\r\n]/.test(value) && /^[\x20-\x7e]+$/.test(value))
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((value) => value.toString(16).padStart(2, '0')).join('')
}
