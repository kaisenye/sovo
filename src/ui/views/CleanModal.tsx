import { useEffect, useRef, useState } from 'react'
import type { CleanGroupView } from '../../../electron/preload'

interface Props {
  folderId: number
  onDone: (senders: string[]) => void
  onCancel: () => void
}

const KIND: Record<string, string> = {
  newsletter: 'Newsletter',
  marketing: 'Marketing',
  notification: 'Notification',
  bulk: 'Mailing list'
}

/**
 * Auto-clean: newsletters, promotions and alerts in the Inbox, one row per
 * sender, all ticked. Done marks the ticked senders' conversations Done, with undo.
 */
export function CleanModal({ folderId, onDone, onCancel }: Props) {
  const [groups, setGroups] = useState<CleanGroupView[] | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const formRef = useRef<HTMLFormElement>(null)
  // Opened from ⌘K, focus would otherwise land on <body>, where Escape and Enter reach nothing.
  useEffect(() => formRef.current?.focus(), [])

  useEffect(() => {
    void window.api.cleanGroups(folderId).then(setGroups)
  }, [folderId])

  const picked = (groups ?? []).filter((g) => !off.has(g.sender))
  const count = picked.reduce((n, g) => n + g.count, 0)
  const toggle = (sender: string): void =>
    setOff((s) => {
      const next = new Set(s)
      if (!next.delete(sender)) next.add(sender)
      return next
    })

  return (
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Clean up noise"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <form
        ref={formRef}
        tabIndex={-1}
        className="picker clean-picker"
        onSubmit={(e) => {
          e.preventDefault()
          if (count) onDone(picked.map((g) => g.sender))
        }}
      >
        <div className="picker-title">Clean up noise</div>
        {groups === null ? (
          <p className="settings-note">…</p>
        ) : groups.length === 0 ? (
          <p className="settings-note">No newsletters, promotions or alerts in your Inbox. Nice.</p>
        ) : (
          <div className="clean-list">
            {groups.map((g) => (
              <label key={g.sender} className="picker-check clean-row">
                <input type="checkbox" checked={!off.has(g.sender)} onChange={() => toggle(g.sender)} />
                <span className="clean-sender" title={g.sender}>
                  {g.name || g.sender}
                </span>
                <span className="clean-kind">{KIND[g.kind] ?? g.kind}</span>
                <span className="clean-count">
                  {g.count}
                  {g.unread ? ` · ${g.unread} unread` : ''}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="settings-note">
          {groups?.length
            ? `${count} conversation${count === 1 ? '' : 's'} will be marked Done. You can undo. Important and starred mail is never included.`
            : ''}
        </p>
        <div className="settings-themes">
          <button type="submit" data-on="true" disabled={!count}>
            Mark Done
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
