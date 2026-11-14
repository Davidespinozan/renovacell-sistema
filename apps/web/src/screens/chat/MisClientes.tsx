// MIS CLIENTES Y PROSPECTOS (3 nov 2026) · lo que atendí o es de mi cartera sigue en MI lista de Conversaciones cuando
// vuelve al asistente (al cerrarse la asesoría por inactividad ya no desaparece). CONV-WHATSAPP · van en la misma lista
// (Asesorias.tsx → FilaConversacion); tocar abre el chat y escribir lo retoma. Aquí: la carga.
import { useCallback, useEffect, useState } from 'react'
import { misConversaciones as cargarPorDefecto, type MiConversacion } from '../../data/ops/misConversaciones'

export function useMisClientes(version: number, cargar: typeof cargarPorDefecto = cargarPorDefecto) {
  const [lista, setLista] = useState<MiConversacion[]>([])
  const recargar = useCallback(async () => { const r = await cargar(); if (r) setLista(r) }, [cargar])
  useEffect(() => { void recargar() }, [recargar, version])
  return { lista, recargar }
}
