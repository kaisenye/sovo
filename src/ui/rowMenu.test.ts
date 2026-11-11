import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import { applyKeymap } from './keymap'
import { listKeys, rowMenuEntries } from './rowMenu'
import type { MessageListRow } from '../core/store/types'

const row = (over: Partial<MessageListRow> = {}): MessageListRow => ({
  id: 1,
  account_id: 1,
  thread_id: 't',
  from_addr: 'a@b.c',
  from_name: 'A',
  to_addrs: null,
  subject: 'Hi',
  date: 0,
  snippet: '',
  flags: '["\\\\Seen"]',
  has_attachments: 0,
  ...over
})

const labels = (entries: ReturnType<typeof rowMenuEntries>): string[] =>
  entries.map((e) => (e.kind === 'item' ? e.label : '—'))

describe('rowMenuEntries', () => {
  it('lists the Inbox actions with their shortcuts', () => {
    const entries = rowMenuEntries(row(), { inInbox: true, commands: COMMANDS })
    expect(labels(entries)).toEqual([
      'Open', '—', 'Done', 'Remind me…', 'Star', 'Mark as unread', '—',
      'Label…', 'Move to…', 'Mute conversation', 'Toggle VIP sender', 'Unsubscribe', '—',
      'Select', 'Mark as spam', 'Trash'
    ])
    const keys = Object.fromEntries(entries.flatMap((e) => (e.kind === 'item' ? [[e.id, e.keys.join(' ')]] : [])))
    expect(keys['nav.open']).toBe('↵')
    expect(keys['msg.done']).toBe('e')
    expect(keys['msg.trash']).toBe('⌫')
    expect(keys['msg.unsubscribe']).toBe('⌘ U')
    expect(keys['msg.vip']).toBe('')
  })

  it('follows the row and the view', () => {
    const starredUnread = row({ flags: '["\\\\Flagged"]' })
    const entries = labels(rowMenuEntries(starredUnread, { inInbox: false, commands: COMMANDS }))
    expect(entries).toContain('Unstar')
    expect(entries).toContain('Mark as read')
    expect(entries).toContain('Move to Inbox')
    expect(entries).not.toContain('Done')
    expect(entries).not.toContain('Mute conversation')
  })

  it('counts a thread with unread replies as unread', () => {
    expect(labels(rowMenuEntries(row({ thread_unread: 2 }), { inInbox: true, commands: COMMANDS }))).toContain('Mark as read')
  })
})

describe('listKeys', () => {
  it('shows a remapped key', () => {
    const commands = applyKeymap(COMMANDS, { 'msg.done': { kind: 'key', key: 'y' } })
    expect(listKeys(commands, 'msg.done')).toEqual(['y'])
  })
})
