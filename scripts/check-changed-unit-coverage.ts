import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { changedExecutableLines } from './changed-coverage-lines.mjs'

const root = process.cwd()
const lcovPath = resolve(root, 'coverage/lcov.info')
const statementsPath = resolve(root, 'coverage/coverage-final.json')
const threshold = Number(process.env.CHANGED_UNIT_COVERAGE_THRESHOLD ?? '90')
if (!existsSync(lcovPath)) fail(`Missing ${relative(root, lcovPath)}. Run the Unit coverage suite first.`)
if (!existsSync(statementsPath)) fail(`Missing ${relative(root, statementsPath)}. Run the Unit coverage suite first.`)

const coverage = parseLcov(readFileSync(lcovPath, 'utf8'))
type NativeStatement = {
  start: { line: number; column: number }
  end: { line: number; column: number }
}
const statementReport = JSON.parse(readFileSync(statementsPath, 'utf8')) as Record<
  string,
  { statementMap: Record<string, NativeStatement> }
>
const statements = new Map(
  Object.entries(statementReport).map(([path, item]) => [
    relative(root, path).replaceAll('\\', '/'),
    item.statementMap,
  ]),
)
const base = resolveBase()
const changedFiles = new Set([
  ...git(['diff', '--name-only', '--diff-filter=ACMR', base, '--'])!.split('\n').filter(Boolean),
  ...git(['ls-files', '--others', '--exclude-standard'])!.split('\n').filter(Boolean),
])
const unitFiles = [...changedFiles].filter(isUnitOwnedSource).sort()
if (unitFiles.length === 0) {
  console.log('No changed Unit-owned production files were discovered; changed Unit coverage is not applicable.')
  process.exit(0)
}

const trackedChangedLines = changedLines(base, new Set(unitFiles))
let aggregateCovered = 0
let aggregateTotal = 0
let measuredFiles = 0
const failures: string[] = []
for (const path of unitFiles) {
  const lines = coverage.get(path)
  if (!lines) {
    failures.push(`${path}: missing from LCOV`)
    continue
  }
  const isUntracked = git(['ls-files', '--error-unmatch', '--', path], false) === null
  const changedForFile = isUntracked ? new Set(lines.keys()) : trackedChangedLines.get(path) ?? new Set<number>()
  const statementMap = statements.get(path)
  if (!statementMap) {
    failures.push(`${path}: missing native statement map`)
    continue
  }
  const executable = [...changedExecutableLines(changedForFile, lines, statementMap)]
  if (executable.length === 0) {
    console.log(`${path}: no changed executable statements; coverage is not applicable`)
    continue
  }
  const uncovered = executable.filter((line) => (lines.get(line) ?? 0) === 0)
  measuredFiles += 1
  const covered = executable.length - uncovered.length
  const percentage = (covered / executable.length) * 100
  aggregateCovered += covered
  aggregateTotal += executable.length
  console.log(`${path}: ${percentage.toFixed(2)}% (${covered}/${executable.length}) changed executable lines`)
  if (percentage + Number.EPSILON < threshold) {
    failures.push(`${path}: ${percentage.toFixed(2)}%; uncovered changed lines ${uncovered.join(', ')}`)
  }
}

if (aggregateTotal === 0) fail('No changed executable lines were found in Unit-owned production files.')
if (failures.length > 0) fail(`Per-file changed Unit coverage is below ${threshold}%:\n${failures.join('\n')}`)
console.log(
  `Per-file changed Unit coverage meets ${threshold}% for ${measuredFiles} executable files (${unitFiles.length} discovered); aggregate ${(
    (aggregateCovered / aggregateTotal) *
    100
  ).toFixed(2)}% (${aggregateCovered}/${aggregateTotal}).`,
)

export function isUnitOwnedSource(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.test.ts') || path.endsWith('.d.ts')) return false
  if (path === 'server/config.ts') return true
  if (path.startsWith('server/domain/')) return true
  if (path.startsWith('server/usecases/')) return !['server/usecases/deps.ts', 'server/usecases/ports.ts'].includes(path)
  if (path.startsWith('server/adapters/gateways/') || path.startsWith('server/adapters/providers/')) return true
  if (['server/http/openapi.ts', 'server/http/protocol.ts'].includes(path)) return true
  return path.startsWith('shared/') && path !== 'shared/types.ts'
}

function parseLcov(source: string): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>()
  let path: string | null = null
  for (const line of source.split('\n')) {
    if (line.startsWith('SF:')) {
      path = relative(root, resolve(line.slice(3))).replaceAll('\\', '/')
      result.set(path, new Map())
    } else if (path && line.startsWith('DA:')) {
      const [lineNumber, count] = line.slice(3).split(',').map(Number)
      result.get(path)?.set(lineNumber, count)
    } else if (line === 'end_of_record') {
      path = null
    }
  }
  return result
}

function changedLines(baseRef: string, files: Set<string>): Map<string, Set<number>> {
  const output = git(['diff', '--unified=0', '--no-color', baseRef, '--', ...files])!
  const result = new Map<string, Set<number>>()
  let path: string | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice(6)
      result.set(path, result.get(path) ?? new Set())
      continue
    }
    if (!path || !line.startsWith('@@')) continue
    const match = line.match(/\+(\d+)(?:,(\d+))?\s/)
    if (!match) continue
    const start = Number(match[1])
    const count = Number(match[2] ?? '1')
    for (let offset = 0; offset < count; offset += 1) result.get(path)?.add(start + offset)
  }
  return result
}

function resolveBase(): string {
  const configured = process.env.COVERAGE_DIFF_BASE?.trim()
  for (const candidate of [configured, 'origin/main', 'main', 'HEAD^'].filter((value): value is string => Boolean(value))) {
    if (git(['rev-parse', '--verify', candidate], false) !== null) return candidate
  }
  fail('Could not resolve a base revision for changed-line coverage. CI must checkout full history.')
}

function git(args: string[], required = true): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    if (!required) return null
    throw new Error(`git ${args.join(' ')} failed`)
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
