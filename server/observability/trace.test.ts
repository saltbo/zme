import { describe, expect, it } from 'vitest'
import { continueTrace, startTrace, traceCarrier } from './trace'

describe('W3C trace context', () => {
  it('continues a valid trace with a fresh server span and bounded tracestate', () => {
    const trace = startTrace(
      new Headers({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'vendor=value',
      }),
    )

    expect(trace.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(trace.spanId).not.toBe('00f067aa0ba902b7')
    expect(trace.traceparent).toBe(`00-${trace.traceId}-${trace.spanId}-01`)
    expect(traceCarrier(trace)).toEqual({ traceparent: trace.traceparent, tracestate: 'vendor=value' })
  })

  it.each([
    undefined,
    '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
    '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
    'not-trace-context',
  ])('starts a fresh trace when the parent is absent or invalid: %s', (traceparent) => {
    const trace = continueTrace({ traceparent, tracestate: 'bad\r\nstate' })

    expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(trace.tracestate).toBeUndefined()
  })
})
