import { costMicros } from './pricing.js'
import { JEV_MODEL } from './jev.js'
import { DEFAULT_MODELS, keyOwnerFor, readAiSettings } from './settings.js'
import {
  AI_FEATURES,
  AI_KEY_OWNERS,
  AiError,
  type AiFeature,
  type AiKeyOwner,
  type AiProvider,
  type AiProviderId,
  type AiRequest,
  type AiResult,
  type AiUsage,
  type SortClient,
  type SortEngine,
  type SortRequest,
  type SortResult
} from './types.js'

export interface UsageRecord {
  day: string
  provider: AiKeyOwner
  model: string
  feature: AiFeature
  inputTokens: number
  outputTokens: number
  costMicros: number
}

/** Where spend is kept (src/core/store/ai.ts in the app, a stub in tests). */
export interface UsageStore {
  spentMicros(day: string): number
  record(u: UsageRecord): void
}

export interface AiDeps {
  settings: () => Record<string, string>
  /** Reads the vault. Null when no key is saved. */
  key: (owner: AiKeyOwner) => string | null
  providers: Record<AiProviderId, AiProvider>
  /** Jev, for sorting when Settings → AI picks it. */
  sorter?: SortClient
  usage: UsageStore
  now?: () => number
}

export interface AiStatus {
  provider: AiProviderId
  models: Record<AiProviderId, string>
  defaultModels: Record<AiProviderId, string>
  hasKey: Record<AiKeyOwner, boolean>
  /** Where the classifier and own labels run. */
  sortEngine: SortEngine
  budgetUsd: number
  spentTodayUsd: number
  /** What the user switched on. */
  toggles: Record<AiFeature, boolean>
  /** What actually runs: switched on, and the key it needs is saved. */
  features: Record<AiFeature, boolean>
}

export interface RunOptions {
  /** Precomputed work: stops at BACKGROUND_SHARE of the budget. */
  background?: boolean
  signal?: AbortSignal
}

export interface Ai {
  status(): AiStatus
  run(feature: AiFeature, req: AiRequest, opts?: RunOptions): Promise<AiResult>
  /** Typed questions on Jev; only sorting (classify) runs there. Same gates and budget as run. */
  sort(feature: 'classify', req: SortRequest, opts?: RunOptions): Promise<SortResult>
}

/** Background work leaves the last 20 % of the day's budget to what the user asks for. */
export const BACKGROUND_SHARE = 0.8

const PROVIDER_LABEL: Record<AiKeyOwner, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  typesafe: 'TypeSafe'
}
const FEATURE_LABEL: Record<AiFeature, string> = {
  write: 'Write with AI',
  replies: 'Instant Reply',
  summary: 'Summaries',
  classify: 'Important / Other sorting',
  ask: 'Ask AI'
}

/** Local calendar day, YYYY-MM-DD: the budget resets at local midnight. */
export function localDay(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Why a feature cannot run, or null when it can. The one place the
 * disabled / no-key errors are worded, so a cached result can be refused the
 * same way a provider call is.
 */
export function featureGate(
  toggles: Record<AiFeature, boolean>,
  owner: AiKeyOwner,
  hasKey: boolean,
  feature: AiFeature
): AiError | null {
  if (!toggles[feature]) return new AiError('disabled', `${FEATURE_LABEL[feature]} is off in Settings → AI`)
  if (!hasKey) return new AiError('no-key', `Add your ${PROVIDER_LABEL[owner]} key in Settings → AI`)
  return null
}

/** The gate for a status snapshot. */
export function statusGate(st: AiStatus, feature: AiFeature): AiError | null {
  const owner = keyOwnerFor(feature, st)
  return featureGate(st.toggles, owner, st.hasKey[owner], feature)
}

/** Removes the key from any text that might reach the UI or a log. */
export function scrub(text: string, secret: string | null): string {
  return secret && secret.length >= 8 ? text.split(secret).join('[key]') : text
}

export function createAi(deps: AiDeps): Ai {
  const now = deps.now ?? Date.now

  const status = (): AiStatus => {
    const s = readAiSettings(deps.settings())
    const hasKey = Object.fromEntries(AI_KEY_OWNERS.map((p) => [p, deps.key(p) !== null])) as Record<
      AiKeyOwner,
      boolean
    >
    const features = Object.fromEntries(
      AI_FEATURES.map((f) => [f, s.toggles[f] && hasKey[keyOwnerFor(f, s)]])
    ) as Record<AiFeature, boolean>
    return {
      provider: s.provider,
      models: s.models,
      defaultModels: DEFAULT_MODELS,
      hasKey,
      sortEngine: s.sortEngine,
      budgetUsd: s.budgetUsd,
      spentTodayUsd: deps.usage.spentMicros(localDay(now())) / 1e6,
      toggles: s.toggles,
      features
    }
  }

  /**
   * Gates, budget and usage around one call to `owner`. `call` gets the key;
   * whatever it returns or throws is counted, and the key is scrubbed from errors.
   */
  async function metered<R extends AiUsage>(
    feature: AiFeature,
    owner: AiKeyOwner,
    model: string,
    opts: RunOptions,
    call: (apiKey: string) => Promise<R>
  ): Promise<R> {
    const s = readAiSettings(deps.settings())
    const key = deps.key(owner)
    const blocked = featureGate(s.toggles, owner, key !== null, feature)
    if (blocked || !key) throw blocked ?? new AiError('no-key', 'No key')
    const day = localDay(now())
    const cap = Math.round(s.budgetUsd * 1e6 * (opts.background ? BACKGROUND_SHARE : 1))
    if (deps.usage.spentMicros(day) >= cap)
      throw new AiError('budget', 'Today’s AI budget is used up. Raise it in Settings → AI, or wait until tomorrow.')
    const record = (u: AiUsage): void => {
      const used = u.model || model
      deps.usage.record({
        day,
        provider: owner,
        model: used,
        feature,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        costMicros: costMicros(owner, used, u.inputTokens, u.outputTokens)
      })
    }
    let r: R
    try {
      r = await call(key)
    } catch (e) {
      if (e instanceof AiError) {
        // A refused or cut-off answer was still billed: count it, or retries spend past the cap.
        if (e.usage) record(e.usage)
        throw new AiError(e.code, scrub(e.message, key), e.usage)
      }
      throw new AiError('failed', scrub(e instanceof Error ? e.message : String(e), key))
    }
    record(r)
    return r
  }

  return {
    status,
    async run(feature, req, opts = {}) {
      const s = readAiSettings(deps.settings())
      const model = s.models[s.provider]
      return metered(feature, s.provider, model, opts, (apiKey) =>
        deps.providers[s.provider].complete(req, { apiKey, model, signal: opts.signal })
      )
    },
    async sort(feature, req, opts = {}) {
      const s = readAiSettings(deps.settings())
      if (s.sortEngine !== 'jev') throw new AiError('invalid', 'Sorting is not set to Jev')
      const sorter = deps.sorter
      if (!sorter) throw new AiError('failed', 'Jev is not available')
      return metered(feature, 'typesafe', JEV_MODEL, opts, (apiKey) =>
        sorter.sort(req, { apiKey, model: JEV_MODEL, signal: opts.signal })
      )
    }
  }
}
