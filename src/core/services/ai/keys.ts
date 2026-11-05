import { deletePassword, getPassword, hasPassword, setPassword } from '../../accounts/vault.js'
import type { AiKeyOwner } from './types.js'

/**
 * AI keys live in the vault like account passwords: encrypted with the OS
 * keychain (safeStorage), never in SQLite, never sent back over IPC.
 */
export const keyRef = (p: AiKeyOwner): string => `ai-${p}`

const KEY_RE = /^[\x21-\x7e]{8,512}$/

export function saveAiKey(p: AiKeyOwner, key: string): void {
  const k = key.trim()
  if (!KEY_RE.test(k)) throw new Error('That does not look like an API key')
  setPassword(keyRef(p), k)
}

export function aiKey(p: AiKeyOwner): string | null {
  return getPassword(keyRef(p))
}

export function hasAiKey(p: AiKeyOwner): boolean {
  return hasPassword(keyRef(p))
}

export function clearAiKey(p: AiKeyOwner): void {
  deletePassword(keyRef(p))
}
