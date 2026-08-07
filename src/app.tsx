import { useEffect, useRef, useState } from 'preact/hooks'
import { Calendar } from '@fullcalendar/core'
import type { CalendarOptions, EventInput } from '@fullcalendar/core'
import jaLocale from '@fullcalendar/core/locales/ja'
import timeGridPlugin from '@fullcalendar/timegrid'
import iCalendarPlugin from '@fullcalendar/icalendar'
import {
  CalendarSource,
  CalendarGroup,
  SharedGroup,
  loadSources,
  saveSources,
  loadGroups,
  saveGroups,
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

interface GroupDraft {
  id: string | null // null = creating a new group
  name: string
  memberIds: string[]
}

function proxyUrl(icsUrl: string, bust: number): string {
  return `/api/ics?url=${encodeURIComponent(icsUrl)}&_=${bust}`
}

// Solid saturated blocks are hard on the eyes; render events as a soft
// tint of the calendar color with a deep tone of the same hue for text.
// color-mix() handles every valid CSS color, not just 6-digit hex.
function softBackground(color: string): string {
  return `color-mix(in srgb, ${color} 30%, white)`
}

function softText(color: string): string {
  return `color-mix(in srgb, ${color} 55%, black)`
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
  const [pendingGroups, setPendingGroups] = useState<SharedGroup[]>([])
  const [includeGroups, setIncludeGroups] = useState(true)
  const [groups, setGroups] = useState<CalendarGroup[]>(loadGroups)
  // non-null while the team create/edit dialog is open
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null)

  const calendarEl = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<Calendar | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveSources(sources)
  }, [sources])

  useEffect(() => {
    saveGroups(groups)
  }, [groups])

  // drop member ids that no longer exist (calendar was deleted)
  useEffect(() => {
    setGroups((prev) => {
      const valid = new Set(sources.map((s) => s.id))
      let changed = false
      const next = prev.map((g) => {
        const filtered = g.memberIds.filter((id) => valid.has(id))
        if (filtered.length === g.memberIds.length) return g
        changed = true
        return { ...g, memberIds: filtered }
      })
      return changed ? next : prev
    })
  }, [sources])

  const modalOpen = importRows !== null || groupDraft !== null
  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImportRows(null)
        setGroupDraft(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen])

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
      // Render overlapping events side by side so conflicting meetings
      // stay visible. (Timegrid option missing from CalendarOptions
      // typings, same as allDaySlot — hence the cast.)
      ...({ slotEventOverlap: false } as CalendarOptions),
      // Some feeds (e.g. Google) write all-day events as timed UTC spans
      // like 20260812T150000Z–20260813T150000Z (= JST midnight-to-midnight).
      // The icalendar plugin emits these as timed ISO strings, which would
      // flood the whole day column; detect local-midnight-to-midnight spans
      // and rewrite them as date-only all-day events for the 終日 lane.
      eventDataTransform: (input: EventInput) => {
        // A hostile feed could set URL:javascript:... which would land in
        // the event anchor's href; only http(s) links may pass through.
        if (typeof input.url === 'string') {
          let safe = false
          try {
            const u = new URL(input.url)
            safe = u.protocol === 'http:' || u.protocol === 'https:'
          } catch {
            safe = false
          }
          if (!safe) {
            // drop the key entirely — url: undefined still stringifies
            // into href="undefined" inside FullCalendar
            const { url: _url, ...rest } = input
            input = rest
          }
        }
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

  // exclusive team view: only this team's members stay enabled
  function selectGroup(group: CalendarGroup) {
    const members = new Set(group.memberIds)
    setSources((prev) =>
      prev.map((s) => ({ ...s, enabled: members.has(s.id) })),
    )
  }

  function removeGroup(id: string) {
    const target = groups.find((g) => g.id === id)
    if (
      target &&
      !confirm(`チーム「${target.name}」を削除しますか？（メンバーのカレンダーは残ります）`)
    ) {
      return
    }
    setGroups((prev) => prev.filter((g) => g.id !== id))
  }

  function saveGroupDraft() {
    if (!groupDraft) return
    const name = groupDraft.name.trim()
    if (!name) return
    setGroups((prev) => {
      if (groupDraft.id) {
        return prev.map((g) =>
          g.id === groupDraft.id
            ? { ...g, name, memberIds: groupDraft.memberIds }
            : g,
        )
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), name, memberIds: groupDraft.memberIds },
      ]
    })
    setGroupDraft(null)
  }

  function toggleDraftMember(id: string) {
    setGroupDraft((draft) => {
      if (!draft) return draft
      const has = draft.memberIds.includes(id)
      return {
        ...draft,
        memberIds: has
          ? draft.memberIds.filter((m) => m !== id)
          : [...draft.memberIds, id],
      }
    })
  }

  // highlight the team whose members are exactly the enabled set
  const enabledIds = new Set(sources.filter((s) => s.enabled).map((s) => s.id))
  const activeGroupId = groups.find((g) => {
    const members = g.memberIds.filter((id) => sources.some((s) => s.id === id))
    return (
      members.length > 0 &&
      members.length === enabledIds.size &&
      members.every((id) => enabledIds.has(id))
    )
  })?.id

  function exportJson() {
    const blob = new Blob([toShareJson(sources, groups)], {
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
      if (shared.calendars.length === 0) {
        setImportError('ファイルに有効なカレンダーがありません')
        return
      }
      const existing = new Set(sources.map((s) => s.url))
      setImportRows(
        shared.calendars.map((c) => {
          const exists = existing.has(c.url)
          return { ...c, exists, selected: !exists }
        }),
      )
      setPendingGroups(shared.groups)
      setIncludeGroups(true)
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
    // built synchronously (not in the setSources updater) so the group
    // merge below can resolve member URLs against the final list
    const next = [...sources]
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
    setSources(next)

    if (includeGroups && pendingGroups.length > 0) {
      const idByUrl = new Map(next.map((s) => [s.url, s.id]))
      setGroups((prev) => {
        const merged = [...prev]
        for (const shared of pendingGroups) {
          const memberIds = shared.urls
            .map((u) => idByUrl.get(u))
            .filter((id): id is string => typeof id === 'string')
          if (memberIds.length === 0) continue
          const idx = merged.findIndex((g) => g.name === shared.name)
          if (idx >= 0) {
            merged[idx] = {
              ...merged[idx],
              memberIds: [
                ...new Set([...merged[idx].memberIds, ...memberIds]),
              ],
            }
          } else {
            merged.push({ id: crypto.randomUUID(), name: shared.name, memberIds })
          }
        }
        return merged
      })
    }
    setImportRows(null)
    setPendingGroups([])
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

        <div class="teams">
          <div class="section-head">
            <h2>チーム</h2>
            <button
              class="mini"
              title="チームを作成"
              onClick={() =>
                setGroupDraft({ id: null, name: '', memberIds: [] })
              }
            >
              ＋
            </button>
          </div>
          {groups.map((g) => (
            <div
              class={`team ${g.id === activeGroupId ? 'active' : ''}`}
              key={g.id}
            >
              <div class="team-row">
                <button class="team-name" onClick={() => selectGroup(g)}>
                  {g.name}
                </button>
                <button
                  class="mini"
                  title="編集"
                  onClick={() =>
                    setGroupDraft({
                      id: g.id,
                      name: g.name,
                      memberIds: [...g.memberIds],
                    })
                  }
                >
                  ✎
                </button>
                <button
                  class="mini remove"
                  title="チームを削除"
                  onClick={() => removeGroup(g.id)}
                >
                  ×
                </button>
              </div>
              <ul class="team-members">
                {g.memberIds.map((id) => {
                  const s = sources.find((src) => src.id === id)
                  if (!s) return null
                  return (
                    <li key={id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => toggleSource(id)}
                        />
                        <span class="dot" style={{ background: s.color }} />
                        <span class="source-name">{s.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {groups.length === 0 && (
            <p class="empty-note">
              「＋」からチームを作ると、1クリックでそのチームの予定に切り替えられます。
            </p>
          )}
        </div>

        <div class="section-head">
          <h2>メンバー</h2>
        </div>
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
            {pendingGroups.length > 0 && (
              <label class="import-groups">
                <input
                  type="checkbox"
                  checked={includeGroups}
                  onChange={() => setIncludeGroups((v) => !v)}
                />
                チーム構成も取り込む（{pendingGroups.length}件）
              </label>
            )}
            <div class="modal-buttons">
              <button class="secondary" onClick={() => setImportRows(null)}>
                キャンセル
              </button>
              <button
                onClick={confirmImport}
                disabled={
                  !importRows.some((r) => r.selected && !r.exists) &&
                  !(includeGroups && pendingGroups.length > 0)
                }
              >
                {(() => {
                  const n = importRows.filter(
                    (r) => r.selected && !r.exists,
                  ).length
                  return n > 0 ? `${n}件を取り込む` : 'チーム構成を取り込む'
                })()}
              </button>
            </div>
          </div>
        </div>
      )}

      {groupDraft && (
        <div class="modal-overlay" onClick={() => setGroupDraft(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{groupDraft.id ? 'チームを編集' : 'チームを作成'}</h2>
            <input
              type="text"
              class="team-name-input"
              placeholder="チーム名"
              value={groupDraft.name}
              onInput={(e) =>
                setGroupDraft({
                  ...groupDraft,
                  name: (e.target as HTMLInputElement).value,
                })
              }
            />
            <p class="modal-hint">メンバーを選んでください。</p>
            <ul class="member-pick-list">
              {sources.map((s) => (
                <li key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={groupDraft.memberIds.includes(s.id)}
                      onChange={() => toggleDraftMember(s.id)}
                    />
                    <span class="dot" style={{ background: s.color }} />
                    <span class="source-name">{s.name}</span>
                  </label>
                </li>
              ))}
              {sources.length === 0 && (
                <li class="empty-note">先にカレンダーを追加してください</li>
              )}
            </ul>
            <div class="modal-buttons">
              <button class="secondary" onClick={() => setGroupDraft(null)}>
                キャンセル
              </button>
              <button
                onClick={saveGroupDraft}
                disabled={!groupDraft.name.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
