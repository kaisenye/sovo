import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Minus,
  Plus,
  X
} from 'lucide-react'
import type { Attachment } from '../../../electron/preload'
import { formatSize, previewKind, sheetFormat, typeLabel, usePreview, type PreviewKind } from '../attachmentKind'
import { PdfView, type Zoom } from './preview/PdfView'
import { ImageView } from './preview/ImageView'
import { SheetView } from './preview/SheetView'

export { previewKind } from '../attachmentKind'

type Bytes = { bytes: Uint8Array; mime: string }

/**
 * Bytes arrive over IPC only when a file is shown, so opening a thread never
 * pays for a 20 MB PDF. The last few stay cached so ← → feels instant, and the
 * next file is fetched while you read this one.
 */
const cache = new Map<number, Promise<Bytes>>()
function load(id: number): Promise<Bytes> {
  const hit = cache.get(id)
  if (hit) {
    cache.delete(id)
    cache.set(id, hit)
    return hit
  }
  const p = window.api.attachmentData(id).then((r) => {
    if (!r.ok) throw new Error(r.error)
    const bin = atob(r.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, mime: r.mime }
  })
  p.catch(() => cache.delete(id))
  cache.set(id, p)
  while (cache.size > 6) cache.delete(cache.keys().next().value as number)
  return p
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

export function kindIcon(kind: PreviewKind | null) {
  switch (kind) {
    case 'pdf':
    case 'text':
    case 'markdown':
      return FileText
    case 'sheet':
      return FileSpreadsheet
    case 'image':
    case 'svg':
      return FileImage
    case 'video':
      return FileVideo
    case 'audio':
      return FileAudio
    default:
      return File
  }
}

/** The open attachment viewer; App mounts it while `usePreview` holds a list. */
export function AttachmentViewer() {
  const list = usePreview((s) => s.list)
  const index = usePreview((s) => s.index)
  const step = usePreview((s) => s.step)
  const close = usePreview((s) => s.close)
  const a = list[index]
  if (!a) return null
  return <Viewer key="viewer" a={a} index={index} total={list.length} next={list[(index + 1) % list.length]} step={step} close={close} />
}

function Viewer({
  a,
  index,
  total,
  next,
  step,
  close
}: {
  a: Attachment
  index: number
  total: number
  next: Attachment | undefined
  step: (d: number) => void
  close: () => void
}) {
  const kind = previewKind(a)
  const zoomable = kind === 'pdf' || kind === 'image' || kind === 'svg'
  const [data, setData] = useState<{ id: number; bytes?: Bytes; error?: string } | null>(null)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const [meta, setMeta] = useState('')
  const [viewError, setViewError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setZoom('fit')
    setMeta('')
    setViewError(null)
    if (!kind) return setData({ id: a.id })
    let live = true
    setData(null)
    load(a.id).then(
      (bytes) => live && setData({ id: a.id, bytes }),
      (e: Error) => live && setData({ id: a.id, error: e.message })
    )
    return () => {
      live = false
    }
  }, [a.id, kind])

  // Prefetch the next file once this one is in.
  useEffect(() => {
    if (data?.bytes && next && next.id !== a.id && previewKind(next)) void load(next.id).catch(() => {})
  }, [data, next, a.id])

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const cur = zoom === 'fit' ? scale : zoom
      const z = dir > 0 ? ZOOMS.find((s) => s > cur + 0.001) : [...ZOOMS].reverse().find((s) => s < cur - 0.001)
      if (z) setZoom(z)
    },
    [zoom, scale]
  )

  const save = useCallback(() => void window.api.saveAttachment(a.id), [a.id])
  const open = useCallback(() => void window.api.openAttachment(a.id), [a.id])

  // The viewer owns the keyboard while open (App's mode is 'modal').
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      let handled = true
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft' && !mod) step(-1)
      else if (e.key === 'ArrowRight' && !mod) step(1)
      else if (zoomable && (e.key === '+' || e.key === '=')) zoomBy(1)
      else if (zoomable && e.key === '-') zoomBy(-1)
      else if (zoomable && e.key === '0') setZoom('fit')
      else if (zoomable && e.key === '1' && !mod) setZoom(1)
      else if (mod && e.key.toLowerCase() === 's') save()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, step, zoomBy, zoomable, save])

  // Scroll keys (↑ ↓ space, page up/down) reach the file without a click first.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('[data-preview-scroll]')?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(id)
  }, [data])

  const name = a.filename ?? 'untitled'
  const Icon = kindIcon(kind)
  const label = [typeLabel(a), formatSize(a.size), meta].filter(Boolean).join(' · ')
  const error = data?.error ?? viewError

  return (
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${name}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="preview" ref={panelRef} data-kind={kind ?? 'none'}>
        <header className="preview-head">
          <span className="preview-icon" data-kind={kind ?? 'none'}>
            <Icon size={15} strokeWidth={1.75} />
          </span>
          <div className="preview-titles">
            <span className="preview-title" title={name}>
              {name}
            </span>
            <span className="preview-meta">{label}</span>
          </div>
          {zoomable && (
            <div className="preview-group" aria-label="Zoom">
              <button type="button" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
                <Minus size={14} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="preview-zoom"
                title={zoom === 'fit' ? 'Actual size (1)' : 'Fit (0)'}
                onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
              >
                {Math.round(scale * 100)}%
              </button>
              <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(1)}>
                <Plus size={14} strokeWidth={2} />
              </button>
            </div>
          )}
          {total > 1 && (
            <div className="preview-group" aria-label="Attachments">
              <button type="button" title="Previous (←)" aria-label="Previous attachment" onClick={() => step(-1)}>
                <ChevronLeft size={15} strokeWidth={2} />
              </button>
              <span className="preview-count">
                {index + 1} of {total}
              </span>
              <button type="button" title="Next (→)" aria-label="Next attachment" onClick={() => step(1)}>
                <ChevronRight size={15} strokeWidth={2} />
              </button>
            </div>
          )}
          <div className="preview-group">
            <button type="button" title="Open in default app" aria-label="Open in default app" onClick={open}>
              <ExternalLink size={14} strokeWidth={1.75} />
            </button>
            <button type="button" title="Save (⌘S)" aria-label="Save" onClick={save}>
              <Download size={14} strokeWidth={1.75} />
            </button>
          </div>
          <button type="button" className="preview-close" title="Close (Esc)" aria-label="Close preview" onClick={close}>
            <X size={15} strokeWidth={2} />
          </button>
        </header>
        <div className="preview-stage" key={a.id}>
          {error ? (
            <Fallback icon={Icon} title="Can't preview this file" detail={error} onOpen={open} />
          ) : !kind ? (
            <Fallback
              icon={Icon}
              title={`No preview for ${typeLabel(a)} files`}
              detail="Open it in its default app. It came by email, so only open files you trust."
              onOpen={open}
            />
          ) : !data?.bytes ? (
            <div className="preview-note preview-loading">Loading…</div>
          ) : kind === 'pdf' ? (
            <PdfView bytes={data.bytes.bytes} zoom={zoom} onScale={setScale} onMeta={setMeta} onError={setViewError} />
          ) : kind === 'image' || kind === 'svg' ? (
            <ImageView
              src={dataUrl(data.bytes, kind)}
              zoom={zoom}
              onZoom={setZoom}
              onScale={setScale}
              onMeta={setMeta}
              onError={setViewError}
            />
          ) : kind === 'sheet' ? (
            <SheetView bytes={data.bytes.bytes} format={sheetFormat(a)} name={name} onMeta={setMeta} onError={setViewError} />
          ) : (
            <FrameView kind={kind} bytes={data.bytes} />
          )}
        </div>
      </div>
    </div>
  )
}

function Fallback({
  icon: Icon,
  title,
  detail,
  onOpen
}: {
  icon: typeof File
  title: string
  detail: string
  onOpen: () => void
}) {
  return (
    <div className="preview-fallback">
      <Icon size={40} strokeWidth={1.25} />
      <span className="preview-fallback-title">{title}</span>
      <span className="preview-fallback-detail">{detail}</span>
      <button type="button" onClick={onOpen}>
        <ExternalLink size={13} strokeWidth={1.75} /> Open in default app
      </button>
    </div>
  )
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function dataUrl(b: Bytes, kind: PreviewKind): string {
  // mime is checked in main; an SVG must say so to render as an image.
  const mime = kind === 'svg' ? 'image/svg+xml' : b.mime.startsWith('image/') ? b.mime : 'image/png'
  return `data:${mime};base64,${base64(b.bytes)}`
}

/** Text, markdown and media in an opaque sandboxed frame with no network. */
function FrameView({ kind, bytes }: { kind: PreviewKind; bytes: Bytes }) {
  const srcDoc = useMemo(() => {
    const text = kind === 'text' || kind === 'markdown' ? new TextDecoder().decode(bytes.bytes) : ''
    const url = kind === 'video' || kind === 'audio' ? `data:${bytes.mime};base64,${base64(bytes.bytes)}` : ''
    return buildPreviewDoc(kind, url, text)
  }, [kind, bytes])
  return (
    <iframe
      className="preview-frame"
      // No allow-scripts, no allow-same-origin: the bytes can't run code or
      // reach window.api, and the frame's CSP blocks every network request.
      sandbox=""
      srcDoc={srcDoc}
      title="Attachment preview"
      data-preview-scroll
    />
  )
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Minimal markdown: headings, bold/italic, code and links. Everything is
 * escaped before any tag is added, so the source can never inject HTML.
 */
function markdownHtml(text: string): string {
  const inline = (s: string): string =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(block.trim())
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`
      return `<p>${inline(block).replace(/\n/g, '<br />')}</p>`
    })
    .join('')
}

function buildPreviewDoc(kind: PreviewKind, dataUrl: string, text: string): string {
  // The frame can't read our CSS vars, so the theme is resolved and inlined.
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
  const fg = dark ? '#ececed' : '#16161a'
  const css = `
    html,body { margin:0; padding:0; background:transparent; }
    body { font-family: 'Inter', -apple-system, sans-serif; font-size: 13px; line-height: 1.6; color: ${fg};
      overflow-wrap: anywhere; padding: 24px 32px; max-width: 760px; margin: 0 auto; box-sizing: border-box; }
    .fit { display:block; max-width:100%; max-height: calc(100vh - 48px); margin:0 auto; }
    pre { white-space: pre-wrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; margin:0; }
    a { color: #6b8aff; }`
  let inner: string
  switch (kind) {
    case 'video':
      inner = `<video class="fit" controls src="${dataUrl}"></video>`
      break
    case 'audio':
      inner = `<audio controls src="${dataUrl}" style="width:100%"></audio>`
      break
    case 'markdown':
      inner = markdownHtml(text)
      break
    default:
      inner = `<pre>${esc(text)}</pre>`
  }
  return `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<style>${css}</style>
</head><body>${inner}</body></html>`
}
