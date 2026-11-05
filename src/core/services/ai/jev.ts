import { AiError, type SortAnswer, type SortClient, type SortRequest, type SortResult } from './types.js'

/** TypeSafe's API. Explicit, so nothing in the environment can redirect mail text. */
export const TYPESAFE_API = 'https://api.typesafe.ai'
/** Pinned, so an alias moving to a new version never changes verdicts unannounced. */
export const JEV_MODEL = 'jev-1.14.0'

const TIMEOUT_MS = 30_000
const RETRIES = 2

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new AiError('failed', 'Cancelled'))), { once: true })
  })

function httpError(status: number, detail: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth', 'TypeSafe rejected the API key')
  if (status === 429) return new AiError('rate', 'TypeSafe is rate limiting this key; try again shortly')
  if (status === 529) return new AiError('rate', 'TypeSafe is overloaded; try again shortly')
  if (status === 400 || status === 413 || status === 422) return new AiError('invalid', `TypeSafe refused the request: ${detail}`)
  return new AiError('failed', `TypeSafe error ${status}: ${detail}`)
}

const isProb = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

/** Each asked question, answered with the type it was asked as. Anything else is bad output. */
export function readAnswers(req: SortRequest, body: unknown): Record<string, SortAnswer> {
  const answers = (body as { answers?: Record<string, unknown> } | null)?.answers
  if (!answers || typeof answers !== 'object') throw new AiError('bad-output', 'TypeSafe returned no answers')
  const out: Record<string, SortAnswer> = {}
  for (const [name, q] of Object.entries(req.questions)) {
    const a = answers[name] as Record<string, unknown> | undefined
    if (q.type === 'noul' && a?.type === 'noul' && isProb(a.noul)) out[name] = { type: 'noul', noul: a.noul }
    else if (q.type === 'choice' && a?.type === 'choice' && typeof a.choice === 'string' && a.choice in q.criteria)
      out[name] = {
        type: 'choice',
        choice: a.choice,
        confidence: isProb(a.confidence) ? a.confidence : 0,
        probabilities: (a.probabilities as Record<string, number>) ?? {}
      }
    else throw new AiError('bad-output', `TypeSafe gave no usable answer to "${name}"`)
  }
  return out
}

/** `baseURL` points tests and dev QA at the local mock; production leaves it unset. */
export function createJevClient(opts: { baseURL?: string; fetch?: typeof fetch } = {}): SortClient {
  const doFetch = opts.fetch ?? fetch
  return {
    async sort(req, { apiKey, model, signal }): Promise<SortResult> {
      const url = `${opts.baseURL ?? TYPESAFE_API}/v1/systemone`
      const body = JSON.stringify({ model, state: req.state, questions: req.questions })
      for (let attempt = 0; ; attempt++) {
        let res: Response
        try {
          const timeout = AbortSignal.timeout(TIMEOUT_MS)
          res = await doFetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body,
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
          })
        } catch (e) {
          if (signal?.aborted) throw new AiError('failed', 'Cancelled')
          if (attempt < RETRIES) {
            await wait(500 * 2 ** attempt, signal)
            continue
          }
          throw new AiError('network', 'Could not reach TypeSafe')
        }
        if ((res.status === 429 || res.status === 529) && attempt < RETRIES) {
          await wait(500 * 2 ** attempt, signal)
          continue
        }
        const text = await res.text()
        if (!res.ok) {
          let detail = text.slice(0, 200)
          try {
            const j = JSON.parse(text) as { error?: { message?: string }; message?: string }
            detail = j.error?.message ?? j.message ?? detail
          } catch {
            // not JSON: keep the text
          }
          throw httpError(res.status, detail)
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          throw new AiError('bad-output', 'TypeSafe returned malformed JSON')
        }
        const p = parsed as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
        const usage = {
          model: p.model ?? model,
          inputTokens: p.usage?.input_tokens ?? 0,
          outputTokens: p.usage?.output_tokens ?? 0
        }
        try {
          return { answers: readAnswers(req, parsed), ...usage }
        } catch (e) {
          // Billed even though unusable, so the budget still counts it.
          throw new AiError((e as AiError).code, (e as AiError).message, usage)
        }
      }
    }
  }
}
