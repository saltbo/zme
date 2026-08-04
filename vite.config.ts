import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const appPort = Number(process.env.E2E_APP_PORT ?? 7171)
const oidcPort = Number(process.env.E2E_OIDC_PORT ?? 7180)
const e2eAppOrigin = `http://localhost:${appPort}`
const e2eOidcIssuer = `http://localhost:${oidcPort}`

export default defineConfig(() => {
  const isVitest = process.env.VITEST === 'true'
  const isE2e = Boolean(process.env.E2E_PERSIST)

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    environments: {
      zme: {
        resolve: {
          conditions: ['browser', 'workerd', 'worker', 'module', 'development|production'],
          mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      // E2E_PERSIST isolates the local D1/state from the default dev store so
      // end-to-end runs never clobber `pnpm dev` data.
      !isVitest &&
        cloudflare(
          isE2e
            ? {
                persistState: { path: process.env.E2E_PERSIST as string },
                config: {
                  vars: {
                    PUBLIC_APP_ORIGIN: e2eAppOrigin,
                    OIDC_ISSUER: e2eOidcIssuer,
                    OIDC_CLIENT_ID: 'zme-e2e-client',
                    OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none',
                    OIDC_REDIRECT_URI: `${e2eAppOrigin}/auth/callback`,
                    OIDC_POST_LOGOUT_REDIRECT_URI: `${e2eAppOrigin}/login`,
                    OIDC_ALLOWED_ALGS: 'ES256',
                    OIDC_ADMIN_SUBJECTS: `${e2eOidcIssuer}|e2e-admin`,
                    OIDC_LEGACY_BINDINGS_JSON: '[]',
                    REALMROOT_RESOURCE_URL: `${e2eAppOrigin}/api`,
                    MUSIC_AUTO_TAGGING_ENABLED: 'true',
                  },
                },
              }
            : undefined,
        ),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@server': path.resolve(__dirname, './server'),
        '@shared': path.resolve(__dirname, './shared'),
      },
    },
    server: {
      port: appPort,
      allowedHosts: process.env.E2E_BASE_URL ? true : undefined,
    },
  }
})
