// Generates server/clients/zpan from zpan's global OpenAPI document.
//
// zpan no longer publishes a downloader-scoped spec; it serves one document at
// /api/openapi.json covering its entire API (objects, auth, organizations, ...).
// ZME only talks to the download-task and SSE-events endpoints, so we filter the
// document down to those tags and prune unreferenced schemas before handing it to
// openapi-ts — otherwise the generated client would carry all of better-auth's
// surface. Run via `pnpm openapi:zpan` (puts node_modules/.bin on PATH).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SPEC_URL = process.env.ZPAN_OPENAPI_URL ?? 'https://zpan.space/api/openapi.json'
const KEEP_TAGS = new Set(['Download Tasks', 'Events'])

const response = await fetch(SPEC_URL)
if (!response.ok) throw new Error(`Failed to fetch ${SPEC_URL}: ${response.status} ${response.statusText}`)
const doc = await response.json()

// Keep only operations tagged with one of KEEP_TAGS; drop paths left empty.
doc.paths = Object.fromEntries(
  Object.entries(doc.paths)
    .map(([path, item]) => [
      path,
      Object.fromEntries(Object.entries(item).filter(([, op]) => (op.tags ?? []).some((tag) => KEEP_TAGS.has(tag)))),
    ])
    .filter(([, item]) => Object.keys(item).length > 0),
)

// Prune components.schemas to those transitively referenced by the kept paths.
const used = new Set()
const collectRefs = (node) => {
  if (Array.isArray(node)) return node.forEach(collectRefs)
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.split('/').pop()
        if (!used.has(name)) {
          used.add(name)
          collectRefs(doc.components?.schemas?.[name])
        }
      } else {
        collectRefs(value)
      }
    }
  }
}
collectRefs(doc.paths)
if (doc.components?.schemas) {
  doc.components.schemas = Object.fromEntries(
    Object.entries(doc.components.schemas).filter(([name]) => used.has(name)),
  )
}

const specPath = join(mkdtempSync(join(tmpdir(), 'zpan-openapi-')), 'openapi.json')
writeFileSync(specPath, JSON.stringify(doc))
execFileSync('openapi-ts', ['-i', specPath, '-o', 'server/clients/zpan'], { stdio: 'inherit' })
