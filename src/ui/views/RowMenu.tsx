import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CommandId } from '../commands'
import type { RowMenuEntry } from '../rowMenu'

interface Props {
  /** Where the right-click landed, in viewport pixels. */
  x: number
  y: number
  entries: RowMenuEntry[]
  onPick: (id: CommandId) => void
  onClose: () => void
}

/**
 * A list row's right-click menu: every action with its shortcut. The backdrop
 * catches the pointer so hovering rows behind it can't move the cursor the
 * actions will apply to. Keys are local, like the pickers': ↑ ↓ ↵ Esc.
 */
export function RowMenu({ x, y, entries, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const items = entries.flatMap((e, i) => (e.kind === 'item' ? [i] : []))
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState({ left: x, top: y })

  // Open at the pointer, flipped or nudged so the whole menu stays on screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const m = 8
    const left = x + width + m > innerWidth ? Math.max(m, x - width) : x
    const top = y + height + m > innerHeight ? Math.max(m, innerHeight - height - m) : y
    setPos({ left, top })
  }, [x, y])

  useEffect(() => ref.current?.focus(), [])
  useEffect(() => {
    const close = (): void => onClose()
    addEventListener('blur', close)
    addEventListener('resize', close)
    return () => {
      removeEventListener('blur', close)
      removeEventListener('resize', close)
    }
  }, [onClose])

  const step = (dir: 1 | -1): void => {
    const at = items.indexOf(active)
    const next = at === -1 ? (dir === 1 ? 0 : items.length - 1) : (at + dir + items.length) % items.length
    setActive(items[next])
  }

  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[active]
      if (entry?.kind === 'item') onPick(entry.id)
    }
  }

  return (
    <div
      className="row-menu-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        className="row-menu"
        role="menu"
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
      >
        {entries.map((e, i) =>
          e.kind === 'divider' ? (
            <div key={i} className="row-menu-divider" role="separator" />
          ) : (
            <button
              key={e.id}
              type="button"
              role="menuitem"
              className="row-menu-item"
              data-active={i === active}
              data-danger={e.danger ? 'true' : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(e.id)}
            >
              <span className="row-menu-label">{e.label}</span>
              {e.keys.length > 0 && (
                <span className="row-menu-keys">
                  {e.keys.map((k, j) => (
                    <kbd key={j}>{k}</kbd>
                  ))}
                </span>
              )}
            </button>
          )
        )}
      </div>
    </div>
  )
}
