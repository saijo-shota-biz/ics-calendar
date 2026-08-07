export interface CalendarSource {
  id: string
  name: string
  url: string
  color: string
  enabled: boolean
}

const STORAGE_KEY = 'ics-calendar:sources'

export const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#9333ea', // purple
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
]

export function loadSources(): CalendarSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is CalendarSource =>
        typeof s?.id === 'string' && typeof s?.name === 'string' && typeof s?.url === 'string',
    )
  } catch {
    return []
  }
}

export function saveSources(sources: CalendarSource[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sources))
}

export function nextColor(sources: CalendarSource[]): string {
  const used = new Set(sources.map((s) => s.color))
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[sources.length % PALETTE.length]
}

// ---- Shared JSON file (team export/import) ----

export interface SharedCalendar {
  name: string
  url: string
  color?: string
}

export function toShareJson(sources: CalendarSource[]): string {
  const calendars: SharedCalendar[] = sources.map(({ name, url, color }) => ({
    name,
    url,
    color,
  }))
  return JSON.stringify({ version: 1, calendars }, null, 2)
}

/**
 * Accepts either the exported shape `{version, calendars: [...]}` or a
 * bare array `[...]`. Returns only entries with a valid http(s) URL,
 * de-duplicated by URL (first one wins). Throws on unusable input.
 */
export function parseShareJson(text: string): SharedCalendar[] {
  const data = JSON.parse(text)
  const list: unknown = Array.isArray(data) ? data : data?.calendars
  if (!Array.isArray(list)) {
    throw new Error('no "calendars" array found')
  }
  const seen = new Set<string>()
  const result: SharedCalendar[] = []
  for (const item of list) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    } catch {
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    result.push({
      name:
        typeof item?.name === 'string' && item.name.trim()
          ? item.name.trim()
          : url,
      url,
      color: typeof item?.color === 'string' ? item.color : undefined,
    })
  }
  return result
}
