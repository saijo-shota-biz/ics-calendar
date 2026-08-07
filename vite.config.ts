import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import devServer from '@hono/vite-dev-server'

export default defineConfig({
  plugins: [
    preact(),
    // Run the real Worker entry inside Vite's dev server: /api/* is
    // handled in-process by Hono, everything else (the SPA) by Vite.
    // One `npm run dev`, no second server, same code path as prod.
    devServer({
      entry: 'server/worker.ts',
      exclude: [/^(?!\/api\/)/],
    }),
  ],
})
