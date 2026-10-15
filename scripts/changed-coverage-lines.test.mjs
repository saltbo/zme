import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedExecutableLines } from './changed-coverage-lines.mjs'

const statement = (start, end) => ({ start: { line: start, column: 0 }, end: { line: end, column: 10 } })

test('maps changed multiline object members to the native statement counter', () => {
  assert.deepEqual(
    [...changedExecutableLines(new Set([12, 13]), new Map([[10, 1]]), { object: statement(10, 15) })],
    [10],
  )
})

test('retains uncovered inner statements instead of borrowing a covered outer counter', () => {
  const counts = new Map([[5, 1], [10, 0]])
  const lines = changedExecutableLines(new Set([12]), counts, { outer: statement(5, 20), inner: statement(10, 15) })
  assert.deepEqual([...lines], [10])
  assert.equal(counts.get([...lines][0]), 0)
})

test('preserves direct LCOV counters including uncovered changed lines', () => {
  assert.deepEqual([...changedExecutableLines(new Set([12]), new Map([[12, 0]]), {})], [12])
})

test('type-only edits outside executable statements do not invent a denominator', () => {
  assert.deepEqual([...changedExecutableLines(new Set([1, 2]), new Map([[10, 1]]), { body: statement(10, 15) })], [])
})

test('missing native counters fail closed', () => {
  assert.throws(
    () => changedExecutableLines(new Set([12]), new Map(), { object: statement(10, 15) }),
    /no LCOV counter/,
  )
})
