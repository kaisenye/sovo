import { create } from 'zustand'
import type { Attachment } from '../../electron/preload'

export type PreviewKind = 'image' | 'svg' | 'pdf' | 'sheet' | 'video' | 'audio' | 'text' | 'markdown'

const EXT_KINDS: Record<string, PreviewKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image',
  svg: 'svg',
  pdf: 'pdf',
  csv: 'sheet', tsv: 'sheet', xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', numbers: 'sheet',
  mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
  txt: 'text', log: 'text', json: 'text', xml: 'text',
  md: 'markdown', markdown: 'markdown'
}

const SHEET_MIMES = new Set([
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet'
])

export function fileExt(name: string | null): string {
  const n = (name ?? '').toLowerCase()
  const dot = n.lastIndexOf('.')
  return dot > 0 ? n.slice(dot + 1) : ''
}

/**
 * How to preview, from the filename first (mail clients often send
 * application/octet-stream), then the mime. Null: no in-app preview.
 */
export function previewKind(a: Pick<Attachment, 'filename' | 'mime'>): PreviewKind | null {
  const byExt = EXT_KINDS[fileExt(a.filename)]
  if (byExt) return byExt
  const mime = (a.mime ?? '').toLowerCase().split(';')[0].trim()
  if (mime === 'image/svg+xml') return 'svg'
  if (mime === 'application/pdf') return 'pdf'
  if (SHEET_MIMES.has(mime)) return 'sheet'
  if (mime === 'text/markdown') return 'markdown'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  return null
}

/** CSV and TSV are text; everything else in 'sheet' is a workbook. */
export function sheetFormat(a: Pick<Attachment, 'filename' | 'mime'>): 'csv' | 'workbook' {
  const ext = fileExt(a.filename)
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  const mime = (a.mime ?? '').toLowerCase()
  return mime.startsWith('text/') ? 'csv' : 'workbook'
}

/** The badge on a card: PDF, XLSX, PNG… */
export function typeLabel(a: Pick<Attachment, 'filename' | 'mime'>): string {
  const ext = fileExt(a.filename)
  if (ext && ext.length <= 5) return ext.toUpperCase()
  const kind = previewKind(a)
  return kind ? kind.toUpperCase() : 'FILE'
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The open viewer: the files it steps through and which one shows. */
interface PreviewState {
  list: Attachment[]
  index: number
  open: (list: Attachment[], index: number) => void
  step: (delta: number) => void
  close: () => void
}

export const usePreview = create<PreviewState>((set, get) => ({
  list: [],
  index: 0,
  open: (list, index) => set({ list, index: Math.max(0, Math.min(index, list.length - 1)) }),
  step: (delta) => {
    const { list, index } = get()
    if (list.length < 2) return
    set({ index: (index + delta + list.length) % list.length })
  },
  close: () => set({ list: [], index: 0 })
}))
