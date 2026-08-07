import { Hono } from 'hono'
import { icsApi } from './ics-proxy'

// Cloudflare Workers entry point. Static files (the Vite build in ./dist)
// are served by Workers Assets per wrangler.jsonc; only /api/* reaches
// this code (assets.run_worker_first).
const app = new Hono()
app.route('/', icsApi)

export default app
