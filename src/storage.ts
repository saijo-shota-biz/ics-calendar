export interface CalendarSource {
  id: string
  name: string
  url: string
  color: string
  enabled: boolean
}

const STORAGE_KEY = 'ics-calendar:sources'
const GROUPS_KEY = 'ics-calendar:groups'

export interface CalendarGroup {
  id: string
  name: string
  memberIds: string[]
}

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

function isValidColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    typeof CSS !== 'undefined' &&
    CSS.supports('color', value)
  )
}

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
          color: isValidColor(s.color) ? s.color : PALETTE[i % PALETTE.length],
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

export function loadGroups(): CalendarGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((g) => typeof g?.id === 'string' && typeof g?.name === 'string')
      .map(
        (g): CalendarGroup => ({
          id: g.id,
          name: g.name,
          memberIds: Array.isArray(g.memberIds)
            ? g.memberIds.filter((m: unknown): m is string => typeof m === 'string')
            : [],
        }),
      )
  } catch {
    return []
  }
}

export function saveGroups(groups: CalendarGroup[]): void {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
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

// Groups reference members by URL, not by id — ids differ per device,
// URLs are the stable cross-device key.
export interface SharedGroup {
  name: string
  urls: string[]
}

export interface SharedData {
  calendars: SharedCalendar[]
  groups: SharedGroup[]
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function toShareJson(
  sources: CalendarSource[],
  groups: CalendarGroup[],
): string {
  const urlById = new Map(sources.map((s) => [s.id, s.url]))
  const calendars: SharedCalendar[] = sources.map(({ name, url, color }) => ({
    name,
    url,
    color,
  }))
  const sharedGroups: SharedGroup[] = groups.map((g) => ({
    name: g.name,
    urls: g.memberIds
      .map((id) => urlById.get(id))
      .filter((u): u is string => typeof u === 'string'),
  }))
  return JSON.stringify(
    { version: 2, calendars, groups: sharedGroups },
    null,
    2,
  )
}

/**
 * Accepts the v2 shape `{version, calendars, groups}`, the v1 shape
 * without groups, or a bare calendar array. Calendars keep only entries
 * with a valid http(s) URL, de-duplicated by URL (first one wins);
 * groups keep only valid member URLs, de-duplicated by name.
 * Throws on unusable input.
 */
export function parseShareJson(text: string): SharedData {
  const data = JSON.parse(text)
  const list: unknown = Array.isArray(data) ? data : data?.calendars
  if (!Array.isArray(list)) {
    throw new Error('no "calendars" array found')
  }
  const seen = new Set<string>()
  const calendars: SharedCalendar[] = []
  for (const item of list) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    if (!isHttpUrl(url) || seen.has(url)) continue
    seen.add(url)
    calendars.push({
      name:
        typeof item?.name === 'string' && item.name.trim()
          ? item.name.trim()
          : url,
      url,
      color: isValidColor(item?.color) ? item.color : undefined,
    })
  }

  const groups: SharedGroup[] = []
  const rawGroups: unknown = Array.isArray(data) ? [] : data?.groups
  if (Array.isArray(rawGroups)) {
    const names = new Set<string>()
    for (const g of rawGroups) {
      const name = typeof g?.name === 'string' ? g.name.trim() : ''
      if (!name || names.has(name)) continue
      names.add(name)
      groups.push({
        name,
        urls: Array.isArray(g.urls) ? g.urls.filter(isHttpUrl) : [],
      })
    }
  }

  return { calendars, groups }
}
