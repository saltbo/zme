import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const featureFiles = files(join(root, 'spec')).filter((path) => extname(path) === '.feature')
const testFiles = ['server', 'shared', 'src', 'e2e']
  .flatMap((directory) => files(join(root, directory)))
  .filter((path) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(path))
const changedProfiles = productionProfiles()

const scenarios = new Set(
  featureFiles.flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/@([a-z][a-z0-9-]*\/[a-z0-9-]+)/g)].map((match) => match[1] as string)),
)
const references = new Set(
  testFiles.flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/\[spec:\s*([^\]]+)\]/g)].flatMap((match) =>
      (match[1] as string).split(',').map((value) => value.trim()),
    ),
  ),
)

const missingProof = [...scenarios].filter((id) => !references.has(id))
const unknownProof = [...references].filter((id) => !scenarios.has(id))
if (missingProof.length || unknownProof.length) {
  fail(`BDD traceability mismatch. Missing proof: ${missingProof.join(', ') || 'none'}; unknown proof: ${unknownProof.join(', ') || 'none'}`)
}

for (const path of testFiles) {
  const source = readFileSync(path, 'utf8')
  if (/\b(?:it|test|describe)\.(?:skip|only)\s*\(/.test(source) || /\b(?:fit|fdescribe)\s*\(/.test(source)) {
    fail(`Focused or skipped test found in ${relative(root, path)}`)
  }
}

const inventory = readFileSync(join(root, 'docs/quality/oidc-resource-verification.md'), 'utf8')
for (const match of inventory.matchAll(/`((?:server|shared|src|e2e|spec)\/[^`]+\.(?:ts|tsx|feature))`/g)) {
  const evidencePath = join(root, match[1] as string)
  if (!existsSync(evidencePath)) fail(`Verification inventory references missing evidence: ${match[1]}`)
}

const workerConfig = readFileSync(join(root, 'wrangler.toml'), 'utf8')
if (!/run_worker_first\s*=\s*\[[^\]]*"\/api"/s.test(workerConfig)) {
  fail('Worker asset routing must send the exact /api Resource Server URL through the Worker.')
}
if (!/compatibility_flags\s*=\s*\[[^\]]*"global_fetch_strictly_public"/s.test(workerConfig)) {
  fail('Worker compatibility must permit standards-based public OIDC fetches on the same Cloudflare zone.')
}

const e2eRunner = readFileSync(join(root, 'scripts/run-e2e.mjs'), 'utf8')
for (const variable of ['PUBLIC_APP_ORIGIN', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_ADMIN_SUBJECTS', 'CONNECTOR_CREDENTIALS_SECRET', 'DOWNLOAD_RESOURCE_REF_SECRET']) {
  if (!new RegExp(`\\b${variable}:`).test(e2eRunner)) fail(`The hermetic E2E runner must override ${variable}.`)
}
if (!/CLOUDFLARE_ENV:\s*cloudflareEnv/.test(e2eRunner) || !/\.dev\.vars\.\$\{cloudflareEnv\}/.test(e2eRunner)) {
  fail('The hermetic E2E runner must isolate Cloudflare dev vars from deployment configuration.')
}
const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
if (/cp\s+\.dev\.vars\.example\s+\.dev\.vars/.test(ciWorkflow)) {
  fail('CI E2E must not copy deployment example identity values over the fake OIDC configuration.')
}

const vitestReport = argument('--vitest-report')
if (vitestReport) verifyVitestReport(vitestReport)
const playwrightReport = argument('--playwright-report')
if (playwrightReport) verifyPlaywrightReport(playwrightReport)

console.log(
  `Quality inventory verified: ${scenarios.size} scenarios, ${references.size} traced IDs, ${testFiles.length} native test files; changed production profiles ${[...changedProfiles].sort().join(', ')}.`,
)

function verifyVitestReport(reportPath: string) {
  const report = JSON.parse(readFileSync(join(root, reportPath), 'utf8')) as {
    numTotalTests: number
    numPassedTests: number
    numFailedTests: number
    numPendingTests: number
    testResults: Array<{
      name: string
      status: string
      assertionResults: Array<{ fullName: string; status: string }>
    }>
  }
  if (report.numFailedTests !== 0 || report.numPendingTests !== 0 || report.numPassedTests !== report.numTotalTests) {
    fail(
      `Vitest report is not clean: ${report.numPassedTests}/${report.numTotalTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} pending.`,
    )
  }
  const expected = testFiles
    .filter((path) => !path.startsWith(join(root, 'e2e')))
    .map((path) => relative(root, path))
    .sort()
  const reported = report.testResults.map((result) => relative(root, result.name)).sort()
  if (JSON.stringify(reported) !== JSON.stringify(expected)) {
    fail(`Vitest report file inventory differs. Expected ${expected.length}; reported ${reported.length}.`)
  }
  const assertions = report.testResults.flatMap((result) =>
    result.assertionResults.map((assertion) => ({
      id: `${relative(root, result.name)}:${assertion.fullName}`,
      status: assertion.status,
    })),
  )
  if (assertions.length !== report.numTotalTests || assertions.some(({ status }) => status !== 'passed')) {
    fail(`Vitest assertion inventory is not clean: ${assertions.length}/${report.numTotalTests} detailed assertions reported.`)
  }
  if (new Set(assertions.map(({ id }) => id)).size !== assertions.length) {
    fail('Vitest assertion identities are not unique.')
  }
  const reportedProfiles = new Set(
    reported.map((path) => (path.startsWith('server/api-tests/') ? 'api' : path.startsWith('src/') ? 'web' : 'unit')),
  )
  for (const profile of [...changedProfiles].filter((value) => value !== 'e2e')) {
    if (!reportedProfiles.has(profile)) fail(`Vitest report is missing the changed ${profile} verification profile.`)
  }
  console.log(`Vitest report verified: ${report.numPassedTests} tests across ${reported.length} files, no failed or pending tests.`)
}

function verifyPlaywrightReport(reportPath: string) {
  const report = JSON.parse(readFileSync(join(root, reportPath), 'utf8')) as {
    suites: PlaywrightSuite[]
    stats: { expected: number; unexpected: number; flaky: number; skipped: number }
  }
  const { expected, unexpected, flaky, skipped } = report.stats
  if (unexpected !== 0 || flaky !== 0 || skipped !== 0 || expected === 0) {
    fail(`Playwright report is not clean: ${expected} expected, ${unexpected} unexpected, ${flaky} flaky, ${skipped} skipped.`)
  }
  const expectedFiles = testFiles
    .filter((path) => path.startsWith(join(root, 'e2e')))
    .map((path) => relative(root, path))
    .sort()
  const reportedFiles = [...new Set(report.suites.flatMap(playwrightFiles))].sort()
  if (JSON.stringify(reportedFiles) !== JSON.stringify(expectedFiles)) {
    fail(`Playwright report file inventory differs. Expected ${expectedFiles.length}; reported ${reportedFiles.length}.`)
  }
  const tests = report.suites.flatMap(playwrightTests)
  if (tests.length !== expected || tests.some(({ passed }) => !passed)) {
    fail(`Playwright detailed result inventory is not clean: ${tests.length}/${expected} expected tests reported.`)
  }
  if (new Set(tests.map(({ id }) => id)).size !== tests.length) fail('Playwright test identities are not unique.')
  if (changedProfiles.has('e2e') && tests.length === 0) fail('Playwright report is missing the changed e2e profile.')
  console.log(`Playwright report verified: ${expected} tests across ${reportedFiles.length} files, no failed, flaky, or skipped tests.`)
}

interface PlaywrightSuite {
  file?: string
  suites?: PlaywrightSuite[]
  specs?: Array<{
    id: string
    file?: string
    tests: Array<{
      projectId: string
      expectedStatus: string
      status: string
      results: Array<{ status: string }>
    }>
  }>
}

function playwrightFiles(suite: PlaywrightSuite): string[] {
  return [
    ...(suite.file ? [suite.file] : []),
    ...(suite.specs ?? []).flatMap((spec) => (spec.file ? [spec.file] : [])),
    ...(suite.suites ?? []).flatMap(playwrightFiles),
  ].map((path) => {
    if (path.startsWith(root)) return relative(root, path)
    return path.startsWith('e2e/') ? path : join('e2e', path)
  })
}

function playwrightTests(suite: PlaywrightSuite): Array<{ id: string; passed: boolean }> {
  return [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        id: `${spec.id}:${test.projectId}`,
        passed:
          test.expectedStatus === 'passed' &&
          test.status === 'expected' &&
          test.results.length > 0 &&
          test.results.every((result) => result.status === 'passed'),
      })),
    ),
    ...(suite.suites ?? []).flatMap(playwrightTests),
  ]
}

function productionProfiles(): Set<'api' | 'unit' | 'web' | 'e2e'> {
  const base = resolveBase()
  const changed = new Set([
    ...git(['diff', '--name-only', '--diff-filter=ACMR', base, '--']).split('\n').filter(Boolean),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
  ])
  const profiles = new Set<'api' | 'unit' | 'web' | 'e2e'>()
  const unclassified: string[] = []
  for (const path of changed) {
    if (/\.(?:test|spec)\.tsx?$/.test(path)) continue
    if (path.startsWith('migrations/') && path.endsWith('.sql')) profiles.add('api')
    else if (path.startsWith('e2e/') && /\.spec\.tsx?$/.test(path)) profiles.add('e2e')
    else if (path.startsWith('src/') && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) profiles.add('web')
    else if (path.startsWith('shared/') && /\.ts$/.test(path) && !/\.test\.ts$/.test(path)) profiles.add('unit')
    else if (path.startsWith('server/') && /\.ts$/.test(path) && !/\.(?:test|d)\.ts$/.test(path)) {
      profiles.add(isUnitSource(path) ? 'unit' : 'api')
    } else if (/^(?:server|shared|src|e2e|migrations)\//.test(path) && /\.(?:ts|tsx|sql)$/.test(path)) {
      unclassified.push(path)
    }
  }
  if (unclassified.length > 0) fail(`Changed production files lack a verification profile: ${unclassified.join(', ')}`)
  return profiles
}

function isUnitSource(path: string) {
  return (
    path === 'server/config.ts' ||
    path.startsWith('server/domain/') ||
    (path.startsWith('server/usecases/') && !['server/usecases/deps.ts', 'server/usecases/ports.ts'].includes(path)) ||
    path.startsWith('server/adapters/gateways/') ||
    path.startsWith('server/adapters/providers/') ||
    ['server/http/openapi.ts', 'server/http/protocol.ts'].includes(path)
  )
}

function resolveBase() {
  for (const candidate of [process.env.COVERAGE_DIFF_BASE, 'origin/main', 'main', 'HEAD^'].filter(
    (value): value is string => Boolean(value?.trim()),
  )) {
    try {
      git(['rev-parse', '--verify', candidate])
      return candidate
    } catch {
      continue
    }
  }
  fail('Could not resolve a base revision for the changed production inventory.')
}

function git(args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function argument(name: string) {
  const prefix = `${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
