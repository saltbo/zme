/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Mirrors the bindings provided to the api test project in vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    BETTER_AUTH_SECRET: string
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
  }
}
