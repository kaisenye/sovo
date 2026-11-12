/// <reference lib="webworker" />
// Parses spreadsheets off the UI thread, and away from window.api: a workbook
// is attacker-controlled bytes, and this worker has no DOM and no IPC.
import { csvSheet, workbookSheets, type SheetData } from './sheet'

export type SheetRequest = { bytes: Uint8Array; format: 'csv' | 'workbook'; name: string }
export type SheetReply = { ok: true; sheets: SheetData[] } | { ok: false; error: string }

self.onmessage = (e: MessageEvent<SheetRequest>) => {
  const { bytes, format, name } = e.data
  let reply: SheetReply
  try {
    reply = { ok: true, sheets: format === 'csv' ? [csvSheet(bytes, name)] : workbookSheets(bytes) }
  } catch (err) {
    reply = { ok: false, error: (err as Error).message || 'Could not read this spreadsheet' }
  }
  ;(self as unknown as Worker).postMessage(reply)
}
