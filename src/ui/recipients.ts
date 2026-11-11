/**
 * The recipient field's model. Compose keeps each line as one string
 * ("Ann <ann@x>, bob@y"), which is what drafts store and send reads; the
 * field shows the finished entries as pills and the one being typed as text.
 */

/** Entries in a recipient string, split on , and ; (names never hold either: see namedAddress). */
export function splitEntries(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** The address inside an entry, lowercased. */
export function entryAddress(entry: string): string {
  const m = /<([^>]+)>\s*$/.exec(entry)
  return (m ? m[1] : entry).trim().toLowerCase()
}

/** What a pill shows: the name when there is one, else the address. */
export function entryLabel(entry: string): string {
  const m = /^(.*?)<[^>]+>\s*$/.exec(entry)
  const name = m ? m[1].trim().replace(/^"|"$/g, '').trim() : ''
  return name || entryAddress(entry)
}

/** Loose check, only to mark a pill that will not send: something@something.something. */
export function looksLikeAddress(entry: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(entryAddress(entry))
}

/** The line's string: pills, then the text being typed. */
export function joinEntries(pills: string[], draft = ''): string {
  return [...pills, draft.trim()].filter(Boolean).join(', ')
}

/** Adds entries to the pills, skipping any address already there. */
export function addEntries(pills: string[], entries: string[]): string[] {
  const seen = new Set(pills.map(entryAddress))
  const out = [...pills]
  for (const e of entries) {
    const a = entryAddress(e)
    if (!a || seen.has(a)) continue
    seen.add(a)
    out.push(e)
  }
  return out
}

/**
 * Splits the line into pills and the text being typed. The draft is whatever
 * the field last emitted after its pills; any other value (a reply's
 * prefilled To, Instant Intro, a saved draft) is all pills.
 */
export function readLine(value: string, draft: string): { pills: string[]; draft: string } {
  const entries = splitEntries(value)
  const d = draft.trim()
  if (d && entries[entries.length - 1] === d) return { pills: entries.slice(0, -1), draft }
  return { pills: entries, draft: '' }
}
