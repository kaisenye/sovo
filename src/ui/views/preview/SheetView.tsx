import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { columnName, columnWidths, looksNumeric, type SheetData } from '../../sheet'
import type { SheetReply, SheetRequest } from '../../sheetWorker'

interface Props {
  bytes: Uint8Array
  format: 'csv' | 'workbook'
  name: string
  onMeta: (meta: string) => void
  onError: (error: string) => void
}

const ROW_H = 26
const HEAD_H = 26

/** Parses in a worker: no DOM, no window.api, and a big workbook never freezes the window. */
function parse(req: SheetRequest): { promise: Promise<SheetData[]>; cancel: () => void } {
  const worker = new Worker(new URL('../../sheetWorker.ts', import.meta.url), { type: 'module' })
  const promise = new Promise<SheetData[]>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<SheetReply>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.sheets)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Could not read this spreadsheet'))
    }
  })
  // A copy, so the cached bytes stay usable for the next open.
  const copy = req.bytes.slice()
  worker.postMessage({ ...req, bytes: copy }, [copy.buffer])
  return { promise, cancel: () => worker.terminate() }
}

const count = (n: number): string => n.toLocaleString()

export function SheetView({ bytes, format, name, onMeta, onError }: Props) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    setSheets(null)
    setActive(0)
    const job = parse({ bytes, format, name })
    let live = true
    job.promise.then(
      (s) => live && setSheets(s),
      (e: Error) => live && onError(e.message)
    )
    return () => {
      live = false
      job.cancel()
    }
  }, [bytes, format, name, onError])

  const sheet = sheets?.[active]
  useEffect(() => {
    if (!sheets || !sheet) return
    const size = `${count(sheet.totalRows)} rows × ${count(sheet.cols)} columns`
    onMeta(sheets.length > 1 ? `${sheets.length} sheets · ${size}` : size)
  }, [sheets, sheet, onMeta])

  if (!sheets) return <div className="preview-note">Reading…</div>
  if (!sheet) return <div className="preview-note">This workbook has no visible sheets.</div>

  return (
    <div className="sheet-view">
      <SheetGrid key={active} sheet={sheet} />
      {(sheets.length > 1 || sheet.truncated) && (
        <div className="sheet-foot">
          {sheets.length > 1 && (
            <div className="sheet-tabs" role="tablist">
              {sheets.map((s, i) => (
                <button
                  key={s.name + i}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className="sheet-tab"
                  onClick={() => setActive(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {sheet.truncated && (
            <span className="sheet-note">
              First {count(sheet.rows.length)} of {count(sheet.totalRows)} rows · Open for the rest
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function SheetGrid({ sheet }: { sheet: SheetData }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const widths = useMemo(() => columnWidths(sheet.rows, sheet.cols), [sheet])
  const gutter = Math.max(40, String(sheet.rows.length).length * 8 + 22)
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)

  const rows = useVirtualizer({
    count: sheet.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    paddingStart: HEAD_H
  })
  const cols = useVirtualizer({
    horizontal: true,
    count: sheet.cols,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => widths[i],
    overscan: 4
  })
  const totalW = gutter + cols.getTotalSize()
  const vCols = cols.getVirtualItems()

  // ⌘C with a cell selected copies its text (no text selection to copy otherwise).
  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      if (!sel || window.getSelection()?.toString()) return
      e.clipboardData?.setData('text/plain', sheet.rows[sel.r]?.[sel.c] ?? '')
      e.preventDefault()
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [sel, sheet])

  const value = sel ? (sheet.rows[sel.r]?.[sel.c] ?? '') : ''

  return (
    <>
      <div className="sheet-scroll" ref={scrollRef} tabIndex={-1} data-preview-scroll>
        <div style={{ width: totalW, height: rows.getTotalSize(), position: 'relative' }}>
          <div className="sheet-head" style={{ width: totalW, height: HEAD_H }}>
            <div className="sheet-corner" style={{ width: gutter }} />
            {vCols.map((c) => (
              <div
                key={c.key}
                className="sheet-colhead"
                data-active={sel?.c === c.index}
                style={{ left: gutter + c.start, width: c.size }}
              >
                {columnName(c.index)}
              </div>
            ))}
          </div>
          {rows.getVirtualItems().map((r) => {
            const row = sheet.rows[r.index]
            return (
              <div
                key={r.key}
                className="sheet-row"
                data-first={r.index === 0}
                style={{ top: r.start, height: ROW_H, width: totalW }}
              >
                <div className="sheet-rowhead" data-active={sel?.r === r.index} style={{ width: gutter }}>
                  {r.index + 1}
                </div>
                {vCols.map((c) => {
                  const v = row[c.index] ?? ''
                  return (
                    <div
                      key={c.key}
                      className="sheet-cell"
                      data-num={v !== '' && looksNumeric(v)}
                      data-selected={sel?.r === r.index && sel?.c === c.index}
                      style={{ left: gutter + c.start, width: c.size }}
                      title={v.length > 24 ? v : undefined}
                      onMouseDown={() => setSel({ r: r.index, c: c.index })}
                    >
                      {v}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="sheet-cellbar" data-empty={!sel}>
        <span className="sheet-ref">{sel ? `${columnName(sel.c)}${sel.r + 1}` : ''}</span>
        <span className="sheet-value">{sel ? value || ' ' : 'Click a cell to see its full value · ⌘C copies it'}</span>
      </div>
    </>
  )
}
