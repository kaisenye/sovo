import OpenAI from 'openai'
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'
import { AiError, type AiProvider, type AiRequest } from './types.js'

/** Explicit, so an OPENAI_BASE_URL in the environment cannot redirect mail text. */
export const DEEPSEEK_API = 'https://api.deepseek.com'

/** The provider writes the schema after this line; the mock server reads it back from there. */
export const SCHEMA_MARK = 'Reply with one JSON object that matches this JSON schema:'

function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError)
    return new AiError('auth', 'DeepSeek rejected the API key')
  if (e instanceof OpenAI.RateLimitError) return new AiError('rate', 'DeepSeek is rate limiting this key; try again shortly')
  // 402: the account has no balance left.
  if (e instanceof OpenAI.APIError && e.status === 402)
    return new AiError('auth', 'Your DeepSeek balance is empty; top it up on platform.deepseek.com')
  if (e instanceof OpenAI.APIConnectionError) return new AiError('network', 'Could not reach DeepSeek')
  if (e instanceof OpenAI.APIError) return new AiError('failed', `DeepSeek error ${e.status ?? ''}: ${e.message}`)
  return new AiError('failed', e instanceof Error ? e.message : String(e))
}

/**
 * DeepSeek's JSON mode takes no schema (only `json_object`), so the schema
 * goes into the system prompt, which must mention JSON anyway. Features
 * validate what comes back, as they do for every provider.
 */
export function deepseekSystem(req: AiRequest): string {
  if (!req.schema) return req.system
  return `${req.system}\n\n${SCHEMA_MARK}\n${JSON.stringify(req.schema.schema)}`
}

/** `baseURL` points tests and dev QA at the local mock; production leaves it unset. */
export function createDeepSeekProvider(opts: { baseURL?: string } = {}): AiProvider {
  return {
    id: 'deepseek',
    async complete(req, { apiKey, model, signal }) {
      const client = new OpenAI({
        apiKey,
        adminAPIKey: null,
        organization: null,
        project: null,
        baseURL: opts.baseURL ?? DEEPSEEK_API,
        maxRetries: 2,
        timeout: 60_000,
        logLevel: 'off'
      })
      const params: ChatCompletionCreateParamsNonStreaming & { thinking: { type: 'disabled' } } = {
        model,
        messages: [
          { role: 'system', content: deepseekSystem(req) },
          { role: 'user', content: req.prompt }
        ],
        max_tokens: req.maxTokens,
        // Mail chores need no reasoning pass: off is faster and bills fewer tokens.
        thinking: { type: 'disabled' }
      }
      if (req.schema) params.response_format = { type: 'json_object' }
      let r
      try {
        r = await client.chat.completions.create(params, { signal })
      } catch (e) {
        throw toAiError(e)
      }
      const usage = {
        model: r.model,
        inputTokens: r.usage?.prompt_tokens ?? 0,
        outputTokens: r.usage?.completion_tokens ?? 0
      }
      const choice = r.choices[0]
      if (choice?.finish_reason === 'content_filter') throw new AiError('refused', 'The model declined this request', usage)
      // Partial text is not an answer: a cut-off summary or draft must not pass as complete.
      if (choice?.finish_reason === 'length')
        throw new AiError('bad-output', 'The model ran out of room before answering', usage)
      // JSON mode answers with only spaces when it could not produce JSON.
      const text = (choice?.message?.content ?? '').trim()
      if (!text) throw new AiError('bad-output', 'The model returned no text', usage)
      return { text, ...usage }
    }
  }
}
