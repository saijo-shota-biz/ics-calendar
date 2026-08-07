export interface CalendarSource {
  id: string
  name: string
  url: string
  color: string
  enabled: boolean
}

const STORAGE_KEY = 'ics-calendar:sources'

export const PALETTE = [
  '#6366f1', // indigo
  '#f43f5e', // rose
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#ec4899', // pink
  '#84cc16', // lime
]

export function loadSources(): CalendarSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s) =>
          typeof s?.id === 'string' && typeof s?.name === 'string' && typeof s?.url === 'string',
      )
      .map(
        (s, i): CalendarSource => ({
          id: s.id,
          name: s.name,
          url: s.url,
          color:
            typeof s.color === 'string' && s.color
              ? s.color
              : PALETTE[i % PALETTE.length],
          // missing/garbage "enabled" must not silently hide a calendar
          enabled: s.enabled !== false,
        }),
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
