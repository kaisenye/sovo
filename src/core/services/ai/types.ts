/** Providers a user can bring a key for. */
export type AiProviderId = 'anthropic' | 'openai' | 'deepseek'
export const AI_PROVIDERS: AiProviderId[] = ['anthropic', 'openai', 'deepseek']

/** Each feature has its own switch in Settings → AI. */
export type AiFeature = 'write' | 'replies' | 'summary' | 'classify' | 'ask'
export const AI_FEATURES: AiFeature[] = ['write', 'replies', 'summary', 'classify', 'ask']

export interface AiRequest {
  system: string
  prompt: string
  /** Includes any thinking the model does; keep it roomy. */
  maxTokens: number
  /**
   * Structured output: the reply must be JSON matching this schema. Write it
   * strict: every property required, `additionalProperties: false`.
   */
  schema?: { name: string; schema: Record<string, unknown> }
}

export interface AiResult {
  text: string
  /** The model that answered, as the provider reports it (prices the call). */
  model: string
  inputTokens: number
  outputTokens: number
}

export interface AiCallOptions {
  apiKey: string
  model: string
  signal?: AbortSignal
}

/** One provider SDK behind the smallest surface the features need. */
export interface AiProvider {
  id: AiProviderId
  complete(req: AiRequest, opts: AiCallOptions): Promise<AiResult>
}

export type AiErrorCode =
  | 'disabled'
  | 'no-key'
  | 'budget'
  | 'auth'
  | 'rate'
  | 'refused'
  | 'network'
  | 'bad-output'
  | 'invalid'
  | 'failed'

/** Tokens a provider billed for a response it then rejected (refusal, cut off, empty). */
export interface AiUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

/** Every AI failure the UI sees. The message is safe to show and never holds the key. */
export class AiError extends Error {
  readonly code: AiErrorCode
  /** Set when the provider answered (and billed) before the answer was rejected, so the budget still counts it. */
  readonly usage?: AiUsage
  constructor(code: AiErrorCode, message: string, usage?: AiUsage) {
    super(message)
    this.name = 'AiError'
    this.code = code
    if (usage) this.usage = usage
  }
}

/**
 * Sorting (the classifier and an inbox's own labels) can run on the main
 * provider or on TypeSafe's Jev, a model that only answers typed questions.
 */
export type SortEngine = 'provider' | 'jev'
export const SORT_ENGINES: SortEngine[] = ['provider', 'jev']

/** Whose key it is: a text provider, or TypeSafe (Jev). Each has its own vault entry. */
export type AiKeyOwner = AiProviderId | 'typesafe'
export const AI_KEY_OWNERS: AiKeyOwner[] = [...AI_PROVIDERS, 'typesafe']

/** A Jev question. `noul` answers a probability of yes; `choice` picks one named option. */
export type SortQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export interface SortRequest {
  /** What every question is about: here, one email. */
  state: string
  questions: Record<string, SortQuestion>
}

export type SortAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }

export interface SortResult {
  answers: Record<string, SortAnswer>
  model: string
  inputTokens: number
  outputTokens: number
}

export interface SortClient {
  sort(req: SortRequest, opts: AiCallOptions): Promise<SortResult>
}
