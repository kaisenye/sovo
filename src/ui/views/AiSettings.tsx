import { useEffect, useRef, useState } from 'react'
import type { AccountSummary, AiFailure, AiFeature, AiKeyOwner, AiProviderId, AiStatus } from '../../../electron/preload'
import { budgetEdit, modelEdit } from '../aiSettingsInput'
import { AiLabelSettings } from './AiLabelSettings'

const PROVIDERS: { id: AiProviderId; label: string; keyHint: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', keyHint: 'sk-…' },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'sk-…' }
]

const FEATURES: { id: AiFeature; label: string }[] = [
  { id: 'write', label: 'Write with AI (⌘J)' },
  { id: 'summary', label: 'One-line summaries' },
  { id: 'replies', label: 'Instant Reply: three replies, ready before you open' },
  { id: 'classify', label: 'Sort new mail into Important, Other and labels' },
  { id: 'ask', label: 'Ask AI from ⌘K (⇥)' }
]

const NAME: Record<AiProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek' }

/** The key a feature needs: sorting on Jev uses TypeSafe's, everything else the main provider's. */
const ownerFor = (s: AiStatus, f: AiFeature): AiKeyOwner =>
  f === 'classify' && s.sortEngine === 'jev' ? 'typesafe' : s.provider

/** A saved key with Remove, or a write-only field to save one. */
function KeyField({
  owner,
  label,
  hint,
  saved,
  apply
}: {
  owner: AiKeyOwner
  label: string
  hint: string
  saved: boolean
  apply: (r: { ok: true; status: AiStatus } | AiFailure) => void
}) {
  const [key, setKey] = useState('')
  if (saved)
    return (
      <div className="settings-split-form">
        <span className="ai-key-saved">{label} key saved in your keychain</span>
        <button type="button" onClick={async () => apply(await window.api.aiClearKey(owner))}>
          Remove key
        </button>
      </div>
    )
  return (
    <form
      className="settings-split-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await window.api.aiSetKey(owner, key)
        setKey('')
        apply(r)
      }}
    >
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={`${label} API key (${hint})`}
        aria-label={`${label} API key`}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit" disabled={!key.trim()}>
        Save key
      </button>
    </form>
  )
}

/** The model field's text: the model in use, the default included, so a saved model never looks lost. */
const shownModel = (s: AiStatus): string => s.models[s.provider]

/** ↵ commits a settings field the way leaving it does. */
const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
}

/** Settings → AI. Reads and writes through window.api; the key is write-only. */
export function AiSettings({ accounts, activeAccountId }: { accounts: AccountSummary[]; activeAccountId: number | null }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [model, setModel] = useState('')
  const [budget, setBudget] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Bumps on each saved field edit, so "Saved" shows again. */
  const [saved, setSaved] = useState(0)

  const show = (s: AiStatus): void => {
    setStatus(s)
    setModel(shownModel(s))
    setBudget(String(s.budgetUsd))
  }

  useEffect(() => {
    void window.api.aiStatus().then(show)
  }, [])

  const apply = (r: { ok: true; status: AiStatus } | AiFailure): void => {
    if (!r.ok) return setError(r.error)
    setError(null)
    show(r.status)
  }

  const saveModel = async (st: AiStatus, field: string): Promise<void> => {
    const m = modelEdit(field, shownModel(st))
    if (m === null) return setModel(shownModel(st))
    const r = await window.api.aiSetConfig({ model: { provider: st.provider, model: m } })
    apply(r)
    if (r.ok) setSaved((n) => n + 1)
  }
  const saveBudget = async (st: AiStatus, field: string): Promise<void> => {
    const b = budgetEdit(field, st.budgetUsd)
    if (b === null) return setBudget(String(st.budgetUsd))
    const r = await window.api.aiSetConfig({ budgetUsd: b })
    apply(r)
    if (r.ok) setSaved((n) => n + 1)
  }

  // Closing Settings (Esc, Back) unmounts the fields without a blur: save what was typed.
  const pending = useRef({ status, model, budget })
  pending.current = { status, model, budget }
  useEffect(
    () => () => {
      const { status: st, model: m, budget: b } = pending.current
      if (!st) return
      if (modelEdit(m, shownModel(st)) !== null)
        void window.api.aiSetConfig({ model: { provider: st.provider, model: modelEdit(m, shownModel(st))! } })
      const nb = budgetEdit(b, st.budgetUsd)
      if (nb !== null) void window.api.aiSetConfig({ budgetUsd: nb })
    },
    []
  )

  if (!status) return null
  const p = status.provider
  const hasKey = status.hasKey[p]

  return (
    <section className="settings-section ai-settings">
      <p className="settings-note">
        Bring your own key. Everything is off until you flip it on.
      </p>

      <div className="settings-themes" role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((x) => (
          <button
            key={x.id}
            type="button"
            data-on={p === x.id}
            onClick={async () => apply(await window.api.aiSetConfig({ provider: x.id }))}
          >
            {x.label}
          </button>
        ))}
      </div>

      <KeyField
        key={p}
        owner={p}
        label={NAME[p]}
        hint={PROVIDERS.find((x) => x.id === p)?.keyHint ?? ''}
        saved={hasKey}
        apply={apply}
      />

      <div className="settings-split-form">
        <input
          aria-label="Model"
          title={`Clear it to go back to ${status.defaultModels[p]}`}
          placeholder={`Model (default ${status.defaultModels[p]})`}
          value={model}
          spellCheck={false}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={commitOnEnter}
          onBlur={() => void saveModel(status, model)}
        />
        <input
          aria-label="Daily budget in US dollars"
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          onKeyDown={commitOnEnter}
          onBlur={() => void saveBudget(status, budget)}
        />
      </div>
      <p className="settings-note">
        ${status.spentTodayUsd.toFixed(2)} of ${status.budgetUsd.toFixed(2)} spent today. Background work naps at 80%.
        {saved > 0 && (
          <span key={saved} className="ai-saved" role="status">
            Saved
          </span>
        )}
      </p>

      {FEATURES.map((f) => {
        const can = status.hasKey[ownerFor(status, f.id)]
        return (
          <label key={f.id} className="picker-check" data-disabled={!can}>
            <input
              type="checkbox"
              disabled={!can}
              checked={status.toggles[f.id] && can}
              onChange={async (e) => apply(await window.api.aiSetConfig({ feature: { feature: f.id, on: e.target.checked } }))}
            />
            {f.label}
          </label>
        )
      })}

      <p className="settings-note">Sort with</p>
      <div className="settings-themes" role="radiogroup" aria-label="Sorting engine">
        <button
          type="button"
          data-on={status.sortEngine === 'provider'}
          onClick={async () => apply(await window.api.aiSetConfig({ sortEngine: 'provider' }))}
        >
          {NAME[p]}
        </button>
        <button
          type="button"
          data-on={status.sortEngine === 'jev'}
          onClick={async () => apply(await window.api.aiSetConfig({ sortEngine: 'jev' }))}
        >
          TypeSafe Jev
        </button>
      </div>
      {status.sortEngine === 'jev' && (
        <>
          <KeyField owner="typesafe" label="TypeSafe" hint="from console.typesafe.ai" saved={status.hasKey.typesafe} apply={apply} />
          <p className="settings-note">
            Jev only sorts, for about $0.04 per million tokens. Best on English; spot-check Chinese mail. Switching
            engines pauses sorting.
          </p>
        </>
      )}

      <AiLabelSettings
        accounts={accounts}
        activeAccountId={activeAccountId}
        classifyOn={status.hasKey[ownerFor(status, 'classify')] && status.toggles.classify}
      />

      {error && <p className="settings-error">{error}</p>}
    </section>
  )
}
