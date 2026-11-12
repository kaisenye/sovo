import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import type { Attachment } from '../../../electron/preload'
import { formatSize, previewKind, typeLabel, usePreview } from '../attachmentKind'
import { kindIcon } from './AttachmentPreview'

interface Props {
  attachments: Attachment[]
}

/** Thumbnails are worth asking for only where the OS draws the content. */
const THUMB_KINDS = new Set(['image', 'svg', 'pdf', 'sheet', 'video'])

/** One card per file: a thumbnail, its name, type and size. A click opens the viewer. */
export function AttachmentList({ attachments }: Props) {
  const open = usePreview((s) => s.open)
  return (
    <ul className="attachments">
      {attachments.map((a, i) => (
        <AttachmentCard key={a.id} a={a} onOpen={() => open(attachments, i)} />
      ))}
    </ul>
  )
}

function AttachmentCard({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  const kind = previewKind(a)
  const [thumb, setThumb] = useState<string | null>(null)
  const name = a.filename ?? 'untitled'
  const Icon = kindIcon(kind)

  // Fetched once the card is near the screen, never for the whole thread.
  useEffect(() => {
    const el = ref.current
    if (!el || !kind || !THUMB_KINDS.has(kind)) return
    let live = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      void window.api.attachmentThumb(a.id).then((t) => live && setThumb(t))
    })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [a.id, kind])

  return (
    <li ref={ref} className="attachment-card" data-kind={kind ?? 'none'}>
      <button type="button" className="attachment-hit" title={`Preview ${name}`} onClick={onOpen}>
        <span className="attachment-thumb" data-has={!!thumb}>
          {thumb ? (
            <img src={thumb} alt="" draggable={false} onLoad={(e) => e.currentTarget.setAttribute('data-ready', '')} />
          ) : (
            <Icon size={22} strokeWidth={1.5} />
          )}
        </span>
        <span className="attachment-text">
          <span className="attachment-name">{name}</span>
          <span className="attachment-meta">
            <span className="attachment-badge">{typeLabel(a)}</span>
            {formatSize(a.size)}
          </span>
        </span>
      </button>
      <span className="attachment-actions">
        <button type="button" title="Save" aria-label={`Save ${name}`} onClick={() => void window.api.saveAttachment(a.id)}>
          <Download size={13} strokeWidth={1.75} />
        </button>
        <button type="button" title="Open in default app" aria-label={`Open ${name}`} onClick={() => void window.api.openAttachment(a.id)}>
          <ExternalLink size={13} strokeWidth={1.75} />
        </button>
      </span>
    </li>
  )
}
