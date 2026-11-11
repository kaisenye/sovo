import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactPill } from './ContactPill'
import { addEntries, joinEntries, readLine, splitEntries } from '../recipients'

interface Contact {
  address: string
  name: string | null
}

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  /** Lets compose's ⌘⇧O / ⌘⇧C / ⌘⇧B jump straight to this field. */
  inputId?: string
}

function formatContact(c: Contact): string {
  return c.name ? `${c.name} <${c.address}>` : c.address
}

/**
 * A recipient line: finished addresses as pills, then the one being typed.
 * ↵, Tab, comma or leaving the field turns the typed text into a pill;
 * ⌫ in an empty field removes the last pill whole; double-click a pill to edit it.
 * Hovering a pill shows its full name and address, ready to copy.
 * The value stays the plain "a, b" string compose stores and sends.
 */
export function RecipientField({ label, value, onChange, autoFocus, inputId }: Props) {
  const [typed, setTyped] = useState('')
  const { pills, draft } = readLine(value, typed)
  const [matches, setMatches] = useState<Contact[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setMatches([])
    setActive(0)
  }, [])

  const emit = useCallback(
    (nextPills: string[], nextDraft: string) => {
      setTyped(nextDraft)
      onChange(joinEntries(nextPills, nextDraft))
    },
    [onChange]
  )

  /** The typed text becomes a pill (or pills, for a pasted list). */
  const commit = useCallback(() => {
    if (!draft.trim()) return
    emit(addEntries(pills, splitEntries(draft)), '')
    close()
  }, [draft, pills, emit, close])

  // Debounced: a query per keystroke would thrash the main process.
  useEffect(() => {
    if (!open) return
    const q = draft.trim()
    if (q.length < 2) {
      setMatches([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      void window.api.searchContacts(q, 6).then((r) => {
        if (cancelled) return
        setMatches(r)
        setActive(0)
      })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [draft, open])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [close])

  const choose = useCallback(
    (c: Contact) => {
      emit(addEntries(pills, [formatContact(c)]), '')
      close()
    },
    [pills, emit, close]
  )

  const remove = (i: number): void => emit(pills.filter((_, j) => j !== i), draft)

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    const menu = open && matches.length > 0
    if (menu && e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (menu && e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (menu && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      choose(matches[active])
    } else if (e.key === 'Enter' && draft.trim()) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Tab' && draft.trim()) {
      // Pill it and let focus move on.
      commit()
    } else if (e.key === 'Backspace' && !draft && pills.length && e.currentTarget.selectionStart === 0) {
      e.preventDefault()
      remove(pills.length - 1)
    } else if (menu && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className="compose-field" ref={boxRef}>
      <span>{label}</span>
      <div
        className="recipient-wrap"
        onMouseDown={(e) => {
          // A click on the empty part of the line goes to the input.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        {pills.map((entry, i) => (
          <ContactPill
            key={`${entry}-${i}`}
            entry={entry}
            onRemove={() => remove(i)}
            onEdit={() => {
              emit(pills.filter((_, j) => j !== i), entry)
              inputRef.current?.focus()
            }}
          />
        ))}
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          onChange={(e) => {
            setOpen(true)
            const v = e.target.value
            // A comma or semicolon finishes an address; a pasted list becomes pills.
            if (/[,;]/.test(v)) {
              const parts = v.split(/[,;]/)
              const rest = parts.pop() ?? ''
              emit(addEntries(pills, parts.map((p) => p.trim()).filter(Boolean)), rest.trimStart())
            } else emit(pills, v)
          }}
          onFocus={() => setOpen(true)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {open && matches.length > 0 && (
          <ul className="recipient-menu" role="listbox">
            {matches.map((c, i) => (
              <li key={c.address}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  // mousedown would blur the input before the click lands.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(c)
                  }}
                >
                  {c.name && <span className="recipient-name">{c.name}</span>}
                  <span className="recipient-addr">{c.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
