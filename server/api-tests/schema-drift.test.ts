import { env } from 'cloudflare:test'
import {
  account,
  downloaders,
  indexers,
  library,
  librarySources,
  mediaSources,
  session,
  user,
  verification,
} from '@server/db/schema'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

// schema.ts (drizzle, the type source) and migrations/*.sql (hand-written DDL,
// the runtime source) are maintained separately. This asserts they agree by
// comparing each drizzle table's columns against the live migrated D1 table,
// turning silent drift into a CI failure.
const tables = {
  user,
  session,
  account,
  verification,
  downloaders,
  indexers,
  mediaSources,
  library,
  librarySources,
}

describe('schema drift: drizzle schema.ts vs applied D1 migrations', () => {
  for (const [name, table] of Object.entries(tables)) {
    it(`${name}: live D1 columns match the drizzle definition`, async () => {
      const config = getTableConfig(table)
      const expected = config.columns.map((column) => column.name).sort()

      const info = await env.DB.prepare(`PRAGMA table_info(${config.name})`).all<{ name: string }>()
      const actual = info.results.map((row) => row.name).sort()

      expect(actual).toEqual(expected)
    })
  }
})
