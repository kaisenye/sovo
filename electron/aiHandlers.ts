import { transcript, type TranscriptMessage } from '../src/core/ai/mailText.js'
import { WRITE_ACTIONS, writeWithAi, type WriteAction } from '../src/core/ai/write.js'
import { aiConfigPatch, AI_KEYS, keyOwnerFor, readAiSettings, type AiConfigInput } from '../src/core/services/ai/settings.js'
import type { Ai, AiStatus } from '../src/core/services/ai/service.js'
import { AI_FEATURES, AI_KEY_OWNERS, AiError, type AiErrorCode, type AiKeyOwner } from '../src/core/services/ai/types.js'

/** How an AI failure crosses IPC: a code and a message, never the key (the service scrubs it). */
export function aiFail(e: unknown): { ok: false; code: AiErrorCode; error: string } {
  return e instanceof AiError
    ? { ok: false, code: e.code, error: e.message }
    : { ok: false, code: 'failed', error: e instanceof Error ? e.message : String(e) }
}

const isKeyOwner = (p: unknown): p is AiKeyOwner => AI_KEY_OWNERS.includes(p as AiKeyOwner)

export interface AiHandlerDeps {
  status(): AiStatus
  settings(): Record<string, string>
  setSetting(key: string, value: string): void
  saveKey(p: AiKeyOwner, key: string): void
  clearKey(p: AiKeyOwner): void
  /** Deletes every stored verdict (store/ai.ts clearClassifications). */
  clearClassifications(): void
}

type Result = { ok: true; status: AiStatus } | ReturnType<typeof aiFail>

/**
 * The `ai:*` handler bodies, free of Electron so they can be tested. The key
 * arrives once, in `setKey`, and goes straight to the vault; nothing returns it.
 */
export function createAiHandlers(deps: AiHandlerDeps) {
  // Off means off: a classifier switched off, directly or by a key or provider
  // change, stops its stored verdicts steering the splits at once.
  const classifyOn = (): boolean => readAiSettings(deps.settings()).toggles.classify
  const dropVerdictsIfOff = (wasOn: boolean): void => {
    if (wasOn && !classifyOn()) deps.clearClassifications()
  }

  return {
    setKey(provider: AiKeyOwner, key: string): Result {
      try {
        if (!isKeyOwner(provider)) throw new Error('Unknown AI provider')
        deps.saveKey(provider, String(key ?? ''))
        return { ok: true, status: deps.status() }
      } catch (e) {
        return aiFail(e)
      }
    },

    // Removing a key switches off every feature that used it, so nothing turns
    // itself back on when a key is added later.
    clearKey(provider: AiKeyOwner): Result {
      if (!isKeyOwner(provider)) return aiFail(new Error('Unknown AI provider'))
      const wasOn = classifyOn()
      deps.clearKey(provider)
      const s = readAiSettings(deps.settings())
      for (const f of AI_FEATURES) if (keyOwnerFor(f, s) === provider) deps.setSetting(AI_KEYS.feature(f), '0')
      dropVerdictsIfOff(wasOn)
      return { ok: true, status: deps.status() }
    },

    // A provider change switches every feature off (see aiConfigPatch).
    setConfig(input: AiConfigInput): Result {
      try {
        const st = deps.status()
        const patch = aiConfigPatch(input ?? {}, { provider: st.provider, hasKey: st.hasKey, sortEngine: st.sortEngine })
        const wasOn = classifyOn()
        for (const [k, v] of Object.entries(patch)) deps.setSetting(k, v)
        dropVerdictsIfOff(wasOn)
        return { ok: true, status: deps.status() }
      } catch (e) {
        return aiFail(e)
      }
    }
  }
}

export interface AiWriteInput {
  action: WriteAction
  text: string
  instruction?: string
  scope?: 'selection' | 'message'
  sourceMessageId?: number | null
}

export interface AiWriteDeps {
  ai: Ai
  message(id: number): { id: number; account_id: number; thread_id: string | null; from_addr: string | null } | undefined
  /** Newest first, as getThread returns it. */
  thread(accountId: number, threadId: string): TranscriptMessage[]
  displayName(accountId: number): string | null
  /** Earlier conversations with a person (core/ai/history.ts pastThreads). */
  history?(accountId: number, address: string | null, excludeThreadKey: string): string
}

/**
 * `ai:write`. The thread a draft answers comes from the message being replied
 * to; the renderer sends only its row id, and only a draft carries the thread.
 */
export async function aiWrite(
  deps: AiWriteDeps,
  input: AiWriteInput
): Promise<{ ok: true; text: string } | ReturnType<typeof aiFail>> {
  try {
    if (!WRITE_ACTIONS.includes(input?.action)) throw new AiError('invalid', 'Unknown action')
    let thread: string | undefined
    let history: string | undefined
    let myName: string | null = null
    const src = input.sourceMessageId ? deps.message(input.sourceMessageId) : undefined
    if (src) {
      myName = deps.displayName(src.account_id)
      if (input.action === 'draft' && src.thread_id)
        thread = transcript(deps.thread(src.account_id, src.thread_id).slice(0, 8))
      if (input.action === 'draft')
        history = deps.history?.(src.account_id, src.from_addr, src.thread_id ?? `#${src.id}`) || undefined
    }
    const text = await writeWithAi(deps.ai, {
      action: input.action,
      text: String(input.text ?? ''),
      instruction: input.instruction,
      scope: input.scope === 'selection' ? 'selection' : 'message',
      thread,
      history,
      myName
    })
    return { ok: true, text }
  } catch (e) {
    return aiFail(e)
  }
}
