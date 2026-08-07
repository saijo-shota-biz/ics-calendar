import { Hono } from 'hono'

// Guardrails: this proxy is deployed on a public URL, so it must not be
// usable as a generic "fetch anything" relay. It only returns content
// that actually looks like an iCalendar file, and caps the size.
const MAX_BYTES = 5 * 1024 * 1024

export const icsApi = new Hono()

icsApi.get('/api/ics', async (c) => {
  const raw = c.req.query('url')
  if (!raw) return c.text('missing "url" query parameter', 400)

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return c.text('invalid URL', 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return c.text('only http/https URLs are allowed', 400)
  }

  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'ics-calendar/0.1 (calendar viewer)' },
    })
    if (!res.ok) {
      return c.text(`upstream responded ${res.status}`, 502)
    }
    const declaredLength = Number(res.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_BYTES) {
      return c.text('ICS file too large', 502)
    }
    const body = await res.text()
    if (body.length > MAX_BYTES) {
      return c.text('ICS file too large', 502)
    }
    if (!body.slice(0, 2000).includes('BEGIN:VCALENDAR')) {
      return c.text('URL did not return an ICS file', 502)
    }
    return c.body(body, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    })
  } catch (e) {
    // Log detail server-side only: raw error text (DNS/connection failures)
    // would let clients probe arbitrary hosts through this proxy.
    console.error(`ics-proxy: fetch failed for ${target.href}:`, e)
    return c.text('could not fetch the ICS URL', 502)
  }
})
