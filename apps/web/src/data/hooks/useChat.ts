// Hook del chat interno. La identidad ("me") viene de la SESIÓN REAL: id =
// auth.uid() (o el id mock) y nombre = el del usuario logueado. Así los mensajes
// distinguen bien remitente/lado y se firman con el nombre correcto.
import { useSyncExternalStore, useEffect } from 'react'
import { subscribe, getConversations, getMessages, sendMessage, ensureDirect, deleteMessage, deleteConversation, setCurrentUser, CURRENT_USER } from '../store/chatStore'
import { useRole } from '../../auth/RoleContext'
import { currentUserId } from '../../lib/supabase'

export function useChat() {
  const { user } = useRole()
  const uid = currentUserId()
  const meId = uid ?? CURRENT_USER.id
  const meName = user?.name ?? CURRENT_USER.name

  // Mantiene sincronizada la identidad del store (para firmar los envíos).
  useEffect(() => { setCurrentUser({ id: uid, name: user?.name }) }, [uid, user?.name])

  const conversations = useSyncExternalStore(subscribe, getConversations, getConversations)
  const messagesByConv = useSyncExternalStore(subscribe, getMessages, getMessages)
  return { conversations, messagesByConv, send: sendMessage, ensureDirect, deleteMessage, deleteConversation, me: { id: meId, name: meName } }
}
