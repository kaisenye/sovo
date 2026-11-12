import * as XLSX from 'xlsx'

/** One sheet as display text, ready for the grid. */
export interface SheetData {
  name: string
  rows: string[][]
  /** Widest row, so every row renders the same number of cells. */
  cols: number
  /** Rows in the file, which can exceed `rows.length` when truncated. */
  totalRows: number
  truncated: boolean
}

/** Rows past this stay in the file: Open shows them. Virtualized, so it is about memory, not paint. */
export const MAX_SHEET_ROWS = 50_000
export const MAX_SHEET_COLS = 200

/**
 * Text from a CSV's bytes. Mail from China often carries GBK CSVs (Excel's
 * default there), which read as mojibake through UTF-8, so a file that is not
 * valid UTF-8 falls back to GB18030, a superset of GBK.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

/** Tab when the first line has more tabs than commas, so a .csv saved as TSV still splits. */
export function sniffDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r?\n/) >>> 0 || 4096)
  const tabs = first.split('\t').length
  const commas = first.split(',').length
  const semis = first.split(';').length
  if (tabs > commas && tabs >= semis) return '\t'
  return semis > commas ? ';' : ','
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. Values stay text. */
export function parseDelimited(text: string, delim = sniffDelimiter(text), max = MAX_SHEET_ROWS): { rows: string[][]; total: number } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let total = 0
  const push = (): void => {
    row.push(field)
    if (rows.length < max) rows.push(row)
    total += 1
    row = []
    field = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      push()
    } else field += c
  }
  if (field || row.length) push()
  return { rows, total }
}

function finish(name: string, rows: string[][], total: number): SheetData {
  const cols = Math.min(MAX_SHEET_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0))
  const clipped = rows.map((r) => (r.length > cols ? r.slice(0, cols) : r))
  return { name, rows: clipped, cols, totalRows: total, truncated: total > rows.length }
}

export function csvSheet(bytes: Uint8Array, name = 'Sheet'): SheetData {
  const { rows, total } = parseDelimited(decodeText(bytes))
  return finish(name, rows, total)
}

/**
 * Every visible sheet of a workbook (xlsx, xls, ods, numbers) as the text
 * Excel would show: formatted numbers and dates, not raw serials.
 */
export function workbookSheets(bytes: Uint8Array): SheetData[] {
  const wb = XLSX.read(bytes, { type: 'array', dense: true, cellDates: true, sheetRows: MAX_SHEET_ROWS })
  const hidden = new Set(
    (wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name)
  )
  return wb.SheetNames.filter((n) => !hidden.has(n)).map((name) => {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
    // sheetRows cuts the read; !fullref keeps the real extent.
    const full = ws['!fullref'] ?? ws['!ref']
    const total = full ? XLSX.utils.decode_range(full).e.r + 1 : rows.length
    return finish(name, rows.map((r) => r.map((c) => (c == null ? '' : String(c)))), Math.max(total, rows.length))
  })
}

/** A, B, … Z, AA, AB … like every spreadsheet. */
export function columnName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Numbers, money and percentages right-align, like a spreadsheet. */
export function looksNumeric(s: string): boolean {
  return /^[-+(]?\s?[$€£¥]?\s?\d[\d,\s]*(\.\d+)?\s?%?\)?$/.test(s.trim())
}

/** Visual width of text: CJK and other wide glyphs count double. */
function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
  return w
}

/** Column widths in px from the first rows' content, clamped so one long cell can't take the screen. */
export function columnWidths(rows: string[][], cols: number, sample = 400): number[] {
  const out = Array.from({ length: cols }, () => 0)
  for (const r of rows.slice(0, sample)) for (let c = 0; c < cols; c++) out[c] = Math.max(out[c], textWidth(r[c] ?? ''))
  return out.map((w) => Math.min(360, Math.max(64, Math.round(w * 7.2 + 20))))
}
