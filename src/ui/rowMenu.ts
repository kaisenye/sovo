import type { MessageListRow } from '../core/store/types'
import { isFlagged, isUnread } from './format'
import { keyCaps, type Command, type CommandId } from './commands'

/** One line of a list row's right-click menu, or a divider between groups. */
export type RowMenuEntry =
  | { kind: 'item'; id: CommandId; label: string; keys: string[]; danger?: boolean }
  | { kind: 'divider' }

/** The command's first shortcut that works in the list (after remapping), as keycaps. */
export function listKeys(commands: Command[], id: CommandId): string[] {
  const spec = commands.find((c) => c.id === id)?.keys.find((k) => !k.modes || k.modes.includes('list'))
  return spec ? keyCaps(spec) : []
}

/**
 * What a right-click on a list row offers: every action the list can take on
 * it, each with its shortcut, so the menu doubles as a cheat sheet. Labels
 * follow the row (Star or Unstar), and Done or Move to Inbox follows the view.
 */
export function rowMenuEntries(row: MessageListRow, opts: { inInbox: boolean; commands: Command[] }): RowMenuEntry[] {
  const item = (id: CommandId, label: string, danger = false): RowMenuEntry => ({
    kind: 'item',
    id,
    label,
    keys: listKeys(opts.commands, id),
    ...(danger ? { danger } : {})
  })
  const divider: RowMenuEntry = { kind: 'divider' }
  const unread = (row.thread_unread ?? 0) > 0 || isUnread(row.flags)
  return [
    item('nav.open', 'Open'),
    divider,
    opts.inInbox ? item('msg.done', 'Done') : item('msg.notDone', 'Move to Inbox'),
    item('msg.remind', 'Remind me…'),
    item('msg.star', isFlagged(row.flags) ? 'Unstar' : 'Star'),
    item('msg.read', unread ? 'Mark as read' : 'Mark as unread'),
    divider,
    item('msg.label', 'Label…'),
    item('msg.move', 'Move to…'),
    ...(opts.inInbox ? [item('msg.mute', 'Mute conversation')] : []),
    item('msg.vip', 'Toggle VIP sender'),
    item('msg.unsubscribe', 'Unsubscribe'),
    divider,
    item('msg.select', 'Select'),
    item('msg.spam', 'Mark as spam', true),
    item('msg.trash', 'Trash', true)
  ]
}
