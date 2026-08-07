import { useEffect, useRef, useState } from 'preact/hooks'
import { Calendar } from '@fullcalendar/core'
import type { EventInput } from '@fullcalendar/core'
import jaLocale from '@fullcalendar/core/locales/ja'
import timeGridPlugin from '@fullcalendar/timegrid'
import iCalendarPlugin from '@fullcalendar/icalendar'
import {
  CalendarSource,
  loadSources,
  saveSources,
  nextColor,
  toShareJson,
  parseShareJson,
} from './storage'

interface ImportRow {
  name: string
  url: string
  color?: string
  exists: boolean
  selected: boolean
}

function proxyUrl(icsUrl: string, bust: number): string {
  return `/api/ics?url=${encodeURIComponent(icsUrl)}&_=${bust}`
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Solid saturated blocks are hard on the eyes; render events as a soft
// tint of the calendar color with a deep tone of the same hue for text.
// Opaque mix (not alpha) so the tint reads the same over any cell shading.
function softBackground(hex: string): string {
  const c = hexChannels(hex)
  if (!c) return hex
  const mix = c.map((ch) => Math.round(255 - (255 - ch) * 0.3))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

function softText(hex: string): string {
  const c = hexChannels(hex)
  return c
    ? `rgb(${Math.round(c[0] * 0.55)}, ${Math.round(c[1] * 0.55)}, ${Math.round(c[2] * 0.55)})`
    : hex
}

export function App() {
  const [sources, setSources] = useState<CalendarSource[]>(loadSources)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // bump to force FullCalendar to drop its sources and fetch fresh ICS
  const [refreshTick, setRefreshTick] = useState(() => Date.now())
  // non-null while the import preview dialog is open
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importError, setImportError] = useState('')

  const calendarEl = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<Calendar | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveSources(sources)
  }, [sources])

  const importOpen = importRows !== null
  useEffect(() => {
    if (!importOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImportRows(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [importOpen])

  useEffect(() => {
    if (!calendarEl.current) return
    const calendar = new Calendar(calendarEl.current, {
      plugins: [timeGridPlugin, iCalendarPlugin],
      initialView: 'timeGridWeek',
      locale: jaLocale,
      height: '100%',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: '',
      },
      nowIndicator: true,
      scrollTime: '08:00:00',
      // Some feeds (e.g. Google) write all-day events as timed UTC spans
      // like 20260812T150000Z–20260813T150000Z (= JST midnight-to-midnight).
      // The icalendar plugin emits these as timed ISO strings, which would
      // flood the whole day column; detect local-midnight-to-midnight spans
      // and rewrite them as date-only all-day events for the 終日 lane.
      eventDataTransform: (input: EventInput) => {
        const asLocalMidnight = (v: unknown): Date | null => {
          const d =
            v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
          if (!d || Number.isNaN(d.getTime())) return null
          const isMidnight =
            d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0
          return isMidnight ? d : null
        }
        const toDateOnly = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

        if (input.allDay || input.start == null) return input
        const start = asLocalMidnight(input.start)
        if (!start) return input
        if (input.end == null) {
          return {
            ...input,
            allDay: true,
            start: toDateOnly(start),
            end: undefined,
          }
        }
        const end = asLocalMidnight(input.end)
        if (!end) return input
        return {
          ...input,
          allDay: true,
          start: toDateOnly(start),
          end: toDateOnly(end),
        }
      },
    })
    calendar.render()
    calendarRef.current = calendar
    return () => calendar.destroy()
  }, [])

  useEffect(() => {
    const calendar = calendarRef.current
    if (!calendar) return
    calendar.batchRendering(() => {
      calendar.getEventSources().forEach((s) => s.remove())
      for (const src of sources) {
        if (!src.enabled) continue
        calendar.addEventSource({
          id: src.id,
          url: proxyUrl(src.url, refreshTick),
          format: 'ics',
          backgroundColor: softBackground(src.color),
          borderColor: src.color,
          textColor: softText(src.color),
        })
      }
    })
  }, [sources, refreshTick])

  async function addSource(e: Event) {
    e.preventDefault()
    setError('')
    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    if (!trimmedName || !trimmedUrl) return

    try {
      new URL(trimmedUrl)
    } catch {
      setError('URLの形式が正しくありません')
      return
    }
    if (sources.some((s) => s.url === trimmedUrl)) {
      setError('このURLはすでに追加されています')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(proxyUrl(trimmedUrl, Date.now()))
      const text = await res.text()
      if (!res.ok) {
        setError(`取得に失敗しました: ${text}`)
        return
      }
      if (!text.includes('BEGIN:VCALENDAR')) {
        setError('このURLはICS形式ではないようです')
        return
      }
      setSources((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          url: trimmedUrl,
          color: nextColor(prev),
          enabled: true,
        },
      ])
      setName('')
      setUrl('')
    } catch {
      setError('サーバーに接続できません')
    } finally {
      setBusy(false)
    }
  }

  function removeSource(id: string) {
    const target = sources.find((s) => s.id === id)
    if (target && !confirm(`「${target.name}」を削除しますか？`)) return
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  function toggleSource(id: string) {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    )
  }

  function exportJson() {
    const blob = new Blob([toShareJson(sources)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ics-calendars.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow choosing the same file again later
    if (!file) return
    setImportError('')
    try {
      const shared = parseShareJson(await file.text())
      if (shared.length === 0) {
        setImportError('ファイルに有効なカレンダーがありません')
        return
      }
      const existing = new Set(sources.map((s) => s.url))
      setImportRows(
        shared.map((c) => {
          const exists = existing.has(c.url)
          return { ...c, exists, selected: !exists }
        }),
      )
    } catch {
      setImportError('JSONファイルを読み込めませんでした')
    }
  }

  function updateImportRow(index: number, patch: Partial<ImportRow>) {
    setImportRows((rows) =>
      rows ? rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) : rows,
    )
  }

  function confirmImport() {
    if (!importRows) return
    const toAdd = importRows.filter((r) => r.selected && !r.exists)
    setSources((prev) => {
      const next = [...prev]
      for (const row of toAdd) {
        const colorTaken = next.some((s) => s.color === row.color)
        const color = row.color && !colorTaken ? row.color : nextColor(next)
        next.push({
          id: crypto.randomUUID(),
          name: row.name.trim() || row.url,
          url: row.url,
          color,
          enabled: true,
        })
      }
      return next
    })
    setImportRows(null)
  }

  return (
    <div class="layout">
      <aside class="sidebar">
        <h1>ICS カレンダー</h1>

        <form onSubmit={addSource}>
          <input
            type="text"
            required
            placeholder="名前（例: 会社の予定）"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            required
            placeholder="ICSのURL (https://...)"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? '確認中…' : '追加'}
          </button>
          {error && <p class="error">{error}</p>}
        </form>

        <ul class="source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <label>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={() => toggleSource(s.id)}
                />
                <span class="dot" style={{ background: s.color }} />
                <span class="source-name" title={s.url}>
                  {s.name}
                </span>
              </label>
              <button
                class="remove"
                title="削除"
                onClick={() => removeSource(s.id)}
              >
                ×
              </button>
            </li>
          ))}
          {sources.length === 0 && (
            <li class="empty">まだカレンダーがありません</li>
          )}
        </ul>

        <button
          class="refresh"
          onClick={() => setRefreshTick(Date.now())}
          disabled={sources.length === 0}
        >
          ↻ 最新の予定を取得
        </button>

        <div class="share">
          <h2>チームで共有</h2>
          <div class="share-buttons">
            <button
              class="secondary"
              onClick={exportJson}
              disabled={sources.length === 0}
            >
              ⬇ エクスポート
            </button>
            <button class="secondary" onClick={() => fileInput.current?.click()}>
              ⬆ インポート
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            class="hidden-file"
            onChange={onImportFile}
          />
          {importError && <p class="error">{importError}</p>}
        </div>

        <p class="note">
          URLと名前はこの端末（localStorage）にだけ保存されます。JSONファイルを配れば、チームの他のメンバーも同じカレンダーを見られます。
        </p>
      </aside>

      <main class="calendar-area">
        <div ref={calendarEl} class="calendar" />
      </main>

      {importRows && (
        <div class="modal-overlay" onClick={() => setImportRows(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>インポートする内容の確認</h2>
            <p class="modal-hint">
              取り込むものにチェックを入れ、必要なら名前を編集してください。
            </p>
            <ul class="import-list">
              {importRows.map((row, i) => (
                <li key={row.url} class={row.exists ? 'exists' : ''}>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={row.exists}
                    onChange={() =>
                      updateImportRow(i, { selected: !row.selected })
                    }
                  />
                  <div class="import-fields">
                    <input
                      type="text"
                      value={row.name}
                      disabled={row.exists}
                      onInput={(e) =>
                        updateImportRow(i, {
                          name: (e.target as HTMLInputElement).value,
                        })
                      }
                    />
                    <span class="import-url" title={row.url}>
                      {row.exists ? '追加済み ・ ' : ''}
                      {row.url}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div class="modal-buttons">
              <button class="secondary" onClick={() => setImportRows(null)}>
                キャンセル
              </button>
              <button
                onClick={confirmImport}
                disabled={!importRows.some((r) => r.selected && !r.exists)}
              >
                {importRows.filter((r) => r.selected && !r.exists).length}
                件を取り込む
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
