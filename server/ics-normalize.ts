/**
 * Google's "busy-only" ICS feeds export each instance of a recurring
 * meeting as a VEVENT carrying a RECURRENCE-ID but WITHOUT the parent
 * event (no VEVENT of the same UID holding the RRULE). iCalendar parsers
 * treat those as exceptions to a recurrence they never saw, and silently
 * drop them — in real feeds this can be most of the calendar.
 *
 * Rewrite such orphans into standalone events: strip RECURRENCE-ID and
 * make the UID unique per instance. VEVENTs whose parent IS present are
 * left untouched, so well-formed recurring feeds behave as before.
 */
export function normalizeIcs(text: string): string {
  // unfold RFC 5545 folded lines so properties are single lines
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)

  interface VEventBlock {
    uid?: string
    uidLine?: number
    recurrenceIdLine?: number
  }

  const blocks: VEventBlock[] = []
  let current: VEventBlock | null = null
  lines.forEach((line, i) => {
    if (line === 'BEGIN:VEVENT') {
      current = {}
    } else if (line === 'END:VEVENT') {
      if (current) blocks.push(current)
      current = null
    } else if (current) {
      if (/^UID[:;]/.test(line)) {
        current.uid = line.slice(line.indexOf(':') + 1)
        current.uidLine = i
      } else if (/^RECURRENCE-ID[:;]/.test(line)) {
        current.recurrenceIdLine = i
      }
    }
  })

  const parentUids = new Set(
    blocks.filter((b) => b.uid && b.recurrenceIdLine == null).map((b) => b.uid),
  )

  const dropLines = new Set<number>()
  for (const b of blocks) {
    if (
      b.uid &&
      b.uidLine != null &&
      b.recurrenceIdLine != null &&
      !parentUids.has(b.uid)
    ) {
      const recLine = lines[b.recurrenceIdLine]
      const instanceId = recLine.slice(recLine.indexOf(':') + 1)
      lines[b.uidLine] = `${lines[b.uidLine]}-${instanceId}`
      dropLines.add(b.recurrenceIdLine)
    }
  }

  return lines.filter((_, i) => !dropLines.has(i)).join('\r\n')
}
