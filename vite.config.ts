import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const appPort = Number(process.env.E2E_APP_PORT ?? 5173)

export default defineConfig(() => {
  const isVitest = process.env.VITEST === 'true'

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
        cloudflare(process.env.E2E_PERSIST ? { persistState: { path: process.env.E2E_PERSIST } } : undefined),
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
