// Store compartido del chat (mock). Al migrar a Supabase: conversations/messages
// con RLS + Realtime; el hook useChat no cambia.
import type { Conversation, Message } from '../types'
import { CURRENT_USER, MOCK_CONVERSATIONS, MOCK_MESSAGES } from '../mock/chat'

let conversations: Conversation[] = [...MOCK_CONVERSATIONS]
let messages: Record<string, Message[]> = { ...MOCK_MESSAGES }
let seq = 9000

const listeners = new Set<() => void>()

function sortedConvs(): Conversation[] {
  return [...conversations].sort((a, b) => {
    const ta = a.last_message_at ?? a.created_at
    const tb = b.last_message_at ?? b.created_at
    return ta < tb ? 1 : -1
  })
}

let snapConvs = sortedConvs()
let snapMsgs = messages

function emit() {
  snapConvs = sortedConvs()
  snapMsgs = { ...messages }
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getConversations = (): Conversation[] => snapConvs
export const getMessages = (): Record<string, Message[]> => snapMsgs

export function sendMessage(conversationId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return
  seq += 1
  const now = new Date().toISOString()
  const msg: Message = {
    id: `m-${seq}`,
    conversation_id: conversationId,
    sender_id: CURRENT_USER.id,
    sender_name: CURRENT_USER.name,
    body: trimmed,
    created_at: now,
  }
  messages = { ...messages, [conversationId]: [...(messages[conversationId] ?? []), msg] }
  conversations = conversations.map((c) => (c.id === conversationId ? { ...c, last_message_at: now } : c))
  emit()
}

export { CURRENT_USER }
