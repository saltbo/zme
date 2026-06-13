/**
 * Architecture enforcement for the hono-cf-clean-arch layout.
 * Copy to repo root as `.dependency-cruiser.cjs`.
 *
 *   pnpm add -D dependency-cruiser
 *   package.json: "lint:arch": "depcruise server/ shared/ --config .dependency-cruiser.cjs"
 *   (keep the trailing slashes — bare directory names can resolve to 0 modules)
 *
 * Adjust the tsConfig fileName if the server tsconfig has a different name.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm|zod|better-auth)' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-only-in-repos',
      comment:
        'Persistence is confined to adapters/repos/ and db/. server/auth is the better-auth integration: it owns its own tables and is consumed directly by the delivery layer.',
      severity: 'error',
      from: { path: '^server', pathNot: '^server/(adapters/repos|db)|^server/auth' },
      to: { path: 'node_modules/drizzle-orm|^server/db/schema' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
    {
      name: 'frontend-not-into-server',
      comment: 'The SPA talks to the server over HTTP only.',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^server' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Tests are exempt; so is generated code (openapi-ts clients etc.).
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.gen\\.[jt]s$'] },
    tsConfig: { fileName: 'tsconfig.server.json' },
    tsPreCompilationDeps: true,
  },
}
