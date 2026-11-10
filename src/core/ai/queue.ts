import type { Ai } from '../services/ai/service.js'
import { keyOwnerFor, readAiSettings } from '../services/ai/settings.js'
import { AiError, type AiErrorCode } from '../services/ai/types.js'
import { listAiLabels } from '../store/aiLabels.js'
import { dueAiJobs, enqueueAiJob, expireAiJobs, finishAiJob, pruneAiJobs, retryAiJob, type AiJob, type AiJobKind } from '../store/ai.js'
import { refreshListRows } from '../store/listRows.js'
import { getSettings } from '../store/repo.js'
import { classifyMessage } from './classify.js'
import { labelMessage, labelsEligible } from './labels.js'
import { candidate, CLASSIFY_BACKFILL_MS, classifyEligible, FRESH_MS, inboxCopyOf, repliesEligible } from './eligibility.js'
import { getDb } from '../store/db.js'
import { suggestRepliesOnce } from './replies.js'

/** Background features, in the order a message is worked on. */
export const BACKGROUND_KINDS: AiJobKind[] = ['classify', 'replies', 'labels']

/** The settings switch each job kind runs under: custom labels go with the classifier. */
export const KIND_FEATURE: Record<AiJobKind, 'classify' | 'replies'> = {
  classify: 'classify',
  replies: 'replies',
  labels: 'classify'
}

const WEEK_MS = 7 * 24 * 3600_000
/** These stop the whole run and leave the job pending: nothing else would succeed either. */
const STOPPERS = new Set<AiErrorCode>(['budget', 'no-key', 'auth', 'rate'])

/**
 * Called by the pipeline after every stored message. Cheap: one settings read,
 * and one row read only when a background feature is on. Never calls a provider.
 */
export function enqueueForMessage(messageRowId: number, now = Date.now()): AiJobKind[] {
  const s = readAiSettings(getSettings())
  const kinds = BACKGROUND_KINDS.filter((k) => s.toggles[KIND_FEATURE[k]])
  if (!kinds.length) return []
  const c = candidate(messageRowId)
  if (!c?.message_id) return []
  // The fixed categories and replies skip bulk mail; an inbox's own labels
  // (if it has any) look at bulk mail too.
  const ok = (k: AiJobKind): boolean =>
    k === 'labels' ? labelsEligible(c, now) && listAiLabels(c.account_id).length > 0 : classifyEligible(c, now)
  return kinds.filter((k) => ok(k) && enqueueAiJob(c.account_id, c.message_id as string, k, now))
}

/**
 * Sorting catches up: the last 14 days of each account's Inbox mail that has
 * no verdict yet, from other people and not bulk (classifyEligible), queued
 * newest first like any job. Run when Sort new mail is switched on and at
 * start while it is on; mail already sorted (or labelled by hand) is skipped,
 * so a second run costs nothing. Returns how many were queued.
 */
export function queueClassifyBackfill(now = Date.now(), windowMs = CLASSIFY_BACKFILL_MS): number {
  if (!readAiSettings(getSettings()).toggles.classify) return 0
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT m.account_id, m.message_id, m.date FROM messages m
         JOIN folders f ON f.id = m.folder_id AND f.role = 'inbox'
         JOIN accounts a ON a.id = m.account_id
        WHERE m.message_id IS NOT NULL AND m.date >= ?
          AND COALESCE(m.bulk, 0) = 0 AND m.list_unsubscribe IS NULL
          AND lower(COALESCE(m.from_addr, '')) <> lower(a.email)
          AND NOT EXISTS (SELECT 1 FROM ai_classifications c
                           WHERE c.account_id = m.account_id AND c.message_id = m.message_id)
        ORDER BY m.date ASC`
    )
    .all(now - windowMs) as { account_id: number; message_id: string }[]
  // A job left from before (done, expired, failed) goes back to pending. The
  // queue runs the newest id first, so oldest-first inserts sort new mail first.
  const reset = db.prepare(
    `UPDATE ai_jobs SET status = 'pending', attempts = 0, next_at = 0, error = NULL, created_at = ?
      WHERE account_id = ? AND message_id = ? AND kind = 'classify' AND status <> 'pending'`
  )
  let queued = 0
  db.transaction(() => {
    for (const r of rows)
      if (reset.run(now, r.account_id, r.message_id).changes || enqueueAiJob(r.account_id, r.message_id, 'classify', now)) queued++
  })()
  return queued
}

export interface QueueDeps {
  ai: Ai
  /** Fetches a body that is not stored yet (ensureBody in main). */
  ensureBody: (accountId: number, messageRowId: number) => Promise<void>
  now?: () => number
}

type Handler = (deps: QueueDeps, rowId: number, now: number) => Promise<boolean>

const HANDLERS: Record<AiJobKind, Handler> = {
  // The catch-up window: a job is either fresh mail (48 h) or the catch-up queued when sorting was switched on.
  classify: async (deps, rowId, now) => {
    const c = candidate(rowId)
    if (!c || !classifyEligible(c, now, CLASSIFY_BACKFILL_MS)) return false
    return classifyMessage(deps.ai, rowId)
  },
  // Re-checked here: classifyEligible let it into the queue, but robots,
  // mail not addressed to me and threads I answered get no suggestions.
  replies: async (deps, rowId, now) => {
    const c = candidate(rowId)
    if (!c || !repliesEligible(c, now, { fresh: true })) return false
    await suggestRepliesOnce(deps.ai, rowId, { background: true })
    return true
  },
  labels: async (deps, rowId, now) => {
    const c = candidate(rowId)
    if (!c || !labelsEligible(c, now)) return false
    return labelMessage(deps.ai, rowId)
  }
}

/** Works through due jobs, newest mail first. Returns what was done and why it stopped early, if it did. */
export async function runAiJobs(
  deps: QueueDeps,
  limit = 5
): Promise<{ done: { accountId: number; kind: AiJobKind }[]; stopped: AiErrorCode | null }> {
  const now = deps.now?.() ?? Date.now()
  expireAiJobs(now - FRESH_MS)
  pruneAiJobs(now - WEEK_MS)
  const done: { accountId: number; kind: AiJobKind }[] = []
  const due = dueAiJobs(now, limit)
  if (!due.length) return { done, stopped: null }
  const st = deps.ai.status()
  // Nothing switched on has its key (the main provider's, or TypeSafe's for sorting on Jev).
  const owners = BACKGROUND_KINDS.filter((k) => st.toggles[KIND_FEATURE[k]]).map((k) => keyOwnerFor(KIND_FEATURE[k], st))
  if (!owners.some((o) => st.hasKey[o])) return { done, stopped: 'no-key' }
  refreshListRows()
  for (const job of due) {
    const stop = await runOne(deps, job, st.features[KIND_FEATURE[job.kind]], now)
    if (stop) return { done, stopped: stop }
    if (stop === null) done.push({ accountId: job.account_id, kind: job.kind })
  }
  return { done, stopped: null }
}

/** null = done; undefined = skipped or retried; a code = stop the run. */
async function runOne(deps: QueueDeps, job: AiJob, on: boolean, now: number): Promise<AiErrorCode | null | undefined> {
  const handler = HANDLERS[job.kind]
  if (!on) {
    finishAiJob(job.id, 'skipped', 'feature off')
    return undefined
  }
  const rowId = inboxCopyOf(job.account_id, job.message_id)
  if (!rowId) {
    finishAiJob(job.id, 'skipped', 'no longer in the Inbox')
    return undefined
  }
  try {
    // A body that cannot be fetched (reauth, expunged, timeout) is no reason to
    // fail: the classifier works from the stored snippet instead.
    await deps.ensureBody(job.account_id, rowId).catch(() => undefined)
    const ran = await handler(deps, rowId, now)
    finishAiJob(job.id, ran ? 'done' : 'skipped')
    return ran ? null : undefined
  } catch (e) {
    const code: AiErrorCode = e instanceof AiError ? e.code : 'failed'
    if (STOPPERS.has(code)) return code
    retryAiJob(job.id, e instanceof Error ? e.message : String(e), now)
    return undefined
  }
}
