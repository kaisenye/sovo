import { getDb } from '../store/db.js'
import { threadKey } from '../pipeline/threadKey.js'
import { folderByRole, upsertMessage } from '../store/repo.js'
import { clearMessageAttachments, copyAttachment } from '../store/attachments.js'
import { splitAddresses } from './mime.js'
import type { OutboxRow } from './outbox.js'

/**
 * The Message-ID a queued send goes out with. Fixed when it is queued, so the
 * local Sent copy made then and the server's copy that syncs later carry the
 * same id.
 */
export function outboxMessageId(row: Pick<OutboxRow, 'id' | 'created_at'>): string {
  return `<sovo-${row.id}-${row.created_at}@local>`
}

/** "Ann <ann@x.test>, bob@y.test" → the JSON list messages.to_addrs holds. */
export function addressJson(list: string | null): string {
  if (!list?.trim()) return '[]'
  return JSON.stringify(
    splitAddresses(list).flatMap((raw) => {
      const a = raw.trim()
      if (!a) return []
      const m = /^(.*?)\s*<([^>]*)>$/.exec(a)
      return m
        ? [{ address: m[2].trim(), name: m[1].replace(/^"|"$/g, '').trim() || null }]
        : [{ address: a, name: null }]
    })
  )
}

const refsOf = (h: string | null): string[] => h?.match(/<[^<>\s]+>/g) ?? []

/**
 * Shows a send in Sent and in its thread straight away, before the server has
 * filed its copy. The row has no uid, like an optimistic move: when sync finds
 * the server's copy (same Message-ID, same folder) upsertMessage gives this row
 * that uid instead of storing a second one. Idempotent. Null when the account
 * has no Sent folder yet.
 */
export function addLocalSentCopy(row: OutboxRow, from: { email: string; name: string | null }, now = Date.now()): number | null {
  const sent = folderByRole(row.account_id, 'sent')
  if (!sent) return null
  const messageId = outboxMessageId(row)
  const existing = getDb()
    .prepare('SELECT id FROM messages WHERE account_id = ? AND folder_id = ? AND message_id = ?')
    .get(row.account_id, sent.id, messageId) as { id: number } | undefined
  if (existing) return existing.id
  const references = refsOf(row.references_header)
  const text = row.body_text ?? ''
  const files = attachedFiles(row.attachments)
  const db = getDb()
  return db.transaction(() => {
    const id = upsertMessage({
      account_id: row.account_id,
      folder_id: sent.id,
      uid: null,
      message_id: messageId,
      thread_id: threadKey(references, row.in_reply_to, messageId),
      in_reply_to: row.in_reply_to,
      references,
      from_addr: from.email,
      from_name: from.name,
      to_addrs: addressJson(row.to_addrs),
      cc_addrs: addressJson(row.cc_addrs),
      subject: row.subject,
      date: now,
      snippet: text.replace(/\s+/g, ' ').trim().slice(0, 200),
      body_text: row.body_text,
      body_html: row.body_html,
      flags: JSON.stringify(['\\Seen']),
      has_attachments: files.length ? 1 : 0,
      body_fetched: 1
    })
    // The files go into the store with the copy, so the thread shows and opens
    // them at once. One that could not be copied (moved, over the size cap)
    // leaves the body unfetched: the server copy's fetch fills it in once it
    // has a uid.
    if (files.length && !storeAttachments(id, files)) {
      db.prepare('UPDATE messages SET body_fetched = 0 WHERE id = ?').run(id)
    }
    return id
  })()
}

interface AttachedFile {
  path: string
  filename: string | null
  contentType: string | null
  size: number | null
}

/** The outbox's attachment JSON (ComposeAttachment[]); [] when unreadable. */
function attachedFiles(json: string | null): AttachedFile[] {
  if (!json) return []
  try {
    const list = JSON.parse(json) as unknown
    return Array.isArray(list) ? list.filter((a): a is AttachedFile => typeof a?.path === 'string') : []
  } catch {
    return []
  }
}

/** Rows plus copied bytes for each file; false when any file has no bytes. */
function storeAttachments(messageId: number, files: AttachedFile[]): boolean {
  const db = getDb()
  db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId)
  try {
    clearMessageAttachments(messageId)
  } catch {
    // Store not initialized (tests): the copies below fail too.
  }
  const ins = db.prepare(
    `INSERT INTO attachments (message_id, filename, mime, size, part_id, storage_path, inline)
     VALUES (?, ?, ?, ?, NULL, ?, 0)`
  )
  let complete = true
  files.forEach((f, i) => {
    let path: string | null = null
    try {
      path = copyAttachment(messageId, i, f.filename, f.path)
    } catch {
      // Gone since it was attached: the row still shows; the send reports it.
    }
    if (!path) complete = false
    ins.run(messageId, f.filename, f.contentType || null, f.size, path)
  })
  return complete
}

/** Takes the local copy back out: the send was undone, cancelled or failed. */
export function removeLocalSentCopy(row: Pick<OutboxRow, 'id' | 'account_id' | 'created_at'>): boolean {
  const where = 'account_id = ? AND message_id = ? AND uid IS NULL AND folder_id IS NOT NULL'
  const args = [row.account_id, outboxMessageId(row)]
  const ids = getDb().prepare(`SELECT id FROM messages WHERE ${where}`).all(...args) as { id: number }[]
  // Rows go with the message (ON DELETE CASCADE); the copied files do not.
  for (const { id } of ids) {
    try {
      clearMessageAttachments(id)
    } catch {
      // Store not initialized (tests): nothing was copied.
    }
  }
  return getDb().prepare(`DELETE FROM messages WHERE ${where}`).run(...args).changes > 0
}
