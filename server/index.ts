import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { icsApi } from './ics-proxy'

const PORT = 8787

// Local Node entry point: same ICS proxy as the Cloudflare Worker,
// plus static serving of the Vite build.
const app = new Hono()
app.route('/', icsApi)
app.use('/*', serveStatic({ root: './dist' }))
app.use('*', serveStatic({ path: './dist/index.html' }))

// bind to loopback only — this dev server must not be reachable from LAN
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`ics-calendar server: http://localhost:${PORT}`)
})
