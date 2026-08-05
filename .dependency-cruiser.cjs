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
      to: { path: 'node_modules/(hono|drizzle-orm|zod)' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'netease-connector-is-isolated',
      comment: 'A provider implementation may not import another provider implementation or the connector registry.',
      severity: 'error',
      from: { path: '^server/adapters/music-connectors/netease' },
      to: { path: '^server/adapters/music-connectors/(?!netease(?:/|$))' },
    },
    {
      name: 'netease-connector-ui-is-isolated',
      comment: 'A provider UI may not import another provider UI or the connector UI registry.',
      severity: 'error',
      from: { path: '^src/features/music-connectors/netease' },
      to: { path: '^src/features/music-connectors/(?!netease(?:/|$))' },
    },
    {
      name: 'drizzle-only-in-repos',
      comment: 'Persistence is confined to adapters/repos/ and db/.',
      severity: 'error',
      from: { path: '^server', pathNot: '^server/(adapters/repos|db)' },
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
    {
      name: 'server-not-into-frontend',
      comment: 'The server never reaches into the SPA; the two halves meet only through shared/.',
      severity: 'error',
      from: { path: '^server' },
      to: { path: '^src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Tests are exempt; so is generated code (openapi-ts clients etc.).
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.gen\\.[jt]s$'] },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
  },
}
