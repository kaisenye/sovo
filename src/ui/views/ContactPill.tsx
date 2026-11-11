import { useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { entryAddress, entryLabel, looksLikeAddress } from '../recipients'

/** Copies `text`, showing a tick for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      data-done={done}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(text).then(() => setDone(true))
      }}
    >
      {done ? <Check size={13} strokeWidth={2.25} /> : <Copy size={13} strokeWidth={2} />}
    </button>
  )
}

/** A pill's hover card: the full name and address, each one click to copy. */
function ContactCard({ entry }: { entry: string }) {
  const address = entryAddress(entry)
  const name = entryLabel(entry)
  return (
    <div className="recipient-card" role="tooltip" onDoubleClick={(e) => e.stopPropagation()}>
      {name !== address && (
        <div className="recipient-card-row recipient-card-name">
          <span>{name}</span>
          <CopyButton text={name} label="Copy name" />
        </div>
      )}
      <div className="recipient-card-row">
        <span className="recipient-card-addr">{address}</span>
        <CopyButton text={address} label="Copy email" />
      </div>
      {!looksLikeAddress(entry) && <div className="recipient-card-warn">Not a valid email address</div>}
    </div>
  )
}

/** When a card last closed: moving straight to the next pill opens its card at once. */
let lastClosed = 0

/**
 * One contact as a pill ("Name <addr>" or a bare address). Hovering opens a
 * card with the name and address to copy; it lingers so the pointer can reach
 * it. Compose's recipient field adds `onRemove` (×) and `onEdit` (double-click).
 */
export function ContactPill({
  entry,
  onRemove,
  onEdit
}: {
  entry: string
  onRemove?: () => void
  onEdit?: () => void
}) {
  const [card, setCard] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const later = (open: boolean, ms: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!open) lastClosed = Date.now()
      setCard(open)
    }, ms)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const name = entryLabel(entry)
  return (
    <span
      className="recipient-pill"
      data-bad={!looksLikeAddress(entry)}
      data-removable={!!onRemove}
      onMouseEnter={() => later(true, Date.now() - lastClosed < 400 ? 0 : 350)}
      onMouseLeave={() => later(false, 180)}
      onDoubleClick={
        onEdit &&
        (() => {
          setCard(false)
          onEdit()
        })
      }
    >
      <span className="recipient-pill-name">{name}</span>
      {onRemove && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Remove ${name}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setCard(false)
            onRemove()
          }}
        >
          <X size={11} strokeWidth={2.25} />
        </button>
      )}
      {card && <ContactCard entry={entry} />}
    </span>
  )
}
