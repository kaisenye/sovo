import type { AiInsights } from '../../../electron/preload'
import type { ReplyPick } from '../aiInsights'
import type { AiBusy } from '../hooks/useAiInsights'

interface Props {
  insights: AiInsights | null
  busy: AiBusy
  error: string | null
  /** A muted line such as "Too short to summarize". */
  note?: string | null
}

/**
 * The summary line, in the toolbar under the subject (Thread.tsx): while it
 * is being written, the summary, or a muted note. Null when there is none.
 */
export function ThreadSummaryLine({ insights, busy, note }: Omit<Props, 'error'>) {
  if (busy === 'summary')
    return (
      <p className="thread-toolbar-summary" aria-live="polite">
        <span className="ai-thinking">Summarizing…</span>
      </p>
    )
  const summary = insights?.summary
  if (summary)
    return (
      <>
        {/* Keyed, so a new summary fades in again. */}
        <p key={summary} className="thread-toolbar-summary ai-rise">
          {summary}
        </p>
        {/* The whole summary on hover: the line above is cut to one line. */}
        <div className="thread-summary-tip" role="tooltip">
          {summary}
        </div>
      </>
    )
  if (note) return <p className="thread-toolbar-summary ai-muted ai-rise">{note}</p>
  return null
}

/** An AI error for this thread, under the thread header. */
export function ThreadInsightsBar({ error }: Pick<Props, 'error'>) {
  if (!error) return null
  return (
    <div className="ai-insights">
      <p className="ai-error ai-rise">{error}</p>
    </div>
  )
}

/** Instant Reply: three suggestions above the reply bar; 1–3 or a click opens a reply with one. */
export function ReplySuggestions({
  insights,
  busy,
  onUse
}: {
  insights: AiInsights | null
  busy: AiBusy
  onUse: (pick: ReplyPick) => void
}) {
  const replies = insights?.replies
  const options = replies?.options ?? []
  if (busy === 'replies' && !options.length)
    return (
      <div className="ai-replies" aria-busy="true" aria-label="Suggesting replies">
        {[148, 212, 176].map((w, i) => (
          <span key={i} className="ai-reply-ghost" style={{ width: w, ['--i' as string]: i }} />
        ))}
      </div>
    )
  if (!options.length) return null
  return (
    <div className="ai-replies" aria-label="Instant replies">
      {options.map((o, i) => (
        <button
          key={`${i}:${o}`}
          type="button"
          title={o}
          className="ai-rise"
          style={{ ['--i' as string]: i }}
          onClick={() => replies && onUse({ text: o, messageRowId: replies.messageRowId })}
        >
          <span className="thread-reply-hint">{i + 1}</span>
          <span className="ai-reply-text">{o}</span>
        </button>
      ))}
    </div>
  )
}
