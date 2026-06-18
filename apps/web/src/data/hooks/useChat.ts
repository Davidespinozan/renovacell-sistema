// Hook del chat interno. HOY store mock; MAÑANA Supabase (conversations/messages
// + Realtime) sin tocar la pantalla.
import { useSyncExternalStore } from 'react'
import { subscribe, getConversations, getMessages, sendMessage, CURRENT_USER } from '../store/chatStore'

export function useChat() {
  const conversations = useSyncExternalStore(subscribe, getConversations, getConversations)
  const messagesByConv = useSyncExternalStore(subscribe, getMessages, getMessages)
  return { conversations, messagesByConv, send: sendMessage, me: CURRENT_USER }
}
