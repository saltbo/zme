import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Living-documentation guarantee: every scenario in spec/*.md must have a test
// annotated with [spec: <id>], and every annotation must point at a real scenario.
// Keeps the product spec and the suite from drifting — without a Cucumber runner.
const ROOT = process.cwd()
const SELF = 'spec-coverage.test.ts'

function walk(dir: string, matches: (file: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = path.join(entry.parentPath, entry.name)
    if (matches(full)) out.push(full)
  }
  return out
}

function specIds(): Set<string> {
  const ids = new Set<string>()
  for (const file of walk(path.join(ROOT, 'spec'), (f) => f.endsWith('.md'))) {
    for (const match of readFileSync(file, 'utf-8').matchAll(/^###\s+`([^`]+)`/gm)) {
      ids.add(match[1])
    }
  }
  return ids
}

function annotatedIds(): Set<string> {
  const ids = new Set<string>()
  for (const base of ['server', 'src', 'e2e']) {
    for (const file of walk(path.join(ROOT, base), (f) => /\.(test|spec)\.[tj]sx?$/.test(f) && !f.endsWith(SELF))) {
      for (const match of readFileSync(file, 'utf-8').matchAll(/\[spec:\s*([^\]]+)\]/g)) {
        for (const id of match[1].split(',')) ids.add(id.trim())
      }
    }
  }
  return ids
}

describe('spec coverage', () => {
  it('parses scenarios from spec/ (guards against a vacuous pass)', () => {
    expect(specIds().size).toBeGreaterThan(0)
  })

  it('every spec scenario has a test annotated with its id', () => {
    const covered = annotatedIds()
    const uncovered = [...specIds()].filter((id) => !covered.has(id)).sort()
    expect(uncovered, `scenarios with no [spec: id] test:\n${uncovered.join('\n')}`).toEqual([])
  })

  it('every [spec: id] annotation refers to a real scenario', () => {
    const specs = specIds()
    const orphans = [...annotatedIds()].filter((id) => !specs.has(id)).sort()
    expect(orphans, `[spec: id] annotations with no scenario in spec/:\n${orphans.join('\n')}`).toEqual([])
  })
})
