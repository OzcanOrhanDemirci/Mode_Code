// SPDX-License-Identifier: Apache-2.0
/**
 * A fixed list of connected services' tool names (neutral and made up, in the shape real ones have: mail, files, chat,
 * calendars, a bank, a team), with what each does by the words in its name, for the tests of the belt, of the restricted
 * modes and of the footer, which read the words from one place (src/core/belt/tool-words.ts).
 */

/** What the belt asks about a tool, by the rule's id: a payment, a send (a message, a share, a person added, an event), a delete. */
export type Asked = 'outbound.payment' | 'outbound.send' | 'outbound.delete' | null;

/** [snake_case name, what the belt asks, whether the restricted modes and the footer count it as outward]. */
export const NAMES: [string, Asked, boolean][] = [
  // What the belt asks about: outward for the modes too.
  ['send_money', 'outbound.payment', true],
  ['schedule_transaction', 'outbound.payment', true],
  ['update_scheduled_transaction', 'outbound.payment', true],
  ['create_refund', 'outbound.payment', true],
  ['cancel_subscription', 'outbound.payment', true],
  ['confirm_payment_intent', 'outbound.payment', true],
  ['send_email', 'outbound.send', true],
  ['share_file', 'outbound.send', true],
  ['invite_user', 'outbound.send', true],
  ['respond_to_event', 'outbound.send', true],
  ['create_calendar_event', 'outbound.send', true],
  ['add_user_to_channel', 'outbound.send', true],
  ['grant_member_access', 'outbound.send', true],
  ['add_event_participants', 'outbound.send', true],
  ['delete_file', 'outbound.delete', true],
  ['trash_thread', 'outbound.delete', true],
  ['remove_member_note', 'outbound.delete', true],
  ['destroy_session', 'outbound.delete', true],
  ['purge_cache', 'outbound.delete', true],
  ['wipe_data', 'outbound.delete', true],
  // What only the modes count: a write by a broader word.
  ['create_file', null, true],
  ['update_document', null, true],
  ['write_note', null, true],
  ['upload_asset', null, true],
  ['label_thread', null, true],
  ['mark_as_read', null, true],
  // The belt leaves account and credential data alone, by decision; the modes still count the word update.
  ['update_password', null, true],
  // Reads, and writes by no word of either list: neither.
  ['get_users_in_channel', null, false],
  ['list_members', null, false],
  ['get_scheduled_transactions', null, false],
  ['list_transactions', null, false],
  ['list_payment_intents', null, false],
  ['search_threads', null, false],
  ['read_file', null, false],
  ['get_balance', null, false],
  ['add_item', null, false],
  ['grant_permission', null, false],
  ['reserve_hotel', null, false],
];

/** A snake_case name written in each of the other styles: kebab, camel, Pascal and upper case. */
export function styles(snake: string): string[] {
  const parts = snake.split('_');
  const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
  return [snake, parts.join('-'), parts.map((w, i) => (i ? cap(w) : w)).join(''), parts.map(cap).join(''), snake.toUpperCase()];
}

/** The tool as Claude Code names it, for a server called `shop`. */
export const asTool = (name: string): string => `mcp__shop__${name}`;
