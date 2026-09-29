// op_id estable por INTENCIÓN del usuario (W1). Se genera al montar el formulario;
// los reintentos (respuesta ambigua, doble clic) reusan el mismo; tras un éxito
// confirmado se renueva para la siguiente intención.
import { useCallback, useState } from 'react'
import { newOpId } from '../ops/w1Command'

export function useOpId(): { opId: string; renew: () => void } {
  const [opId, setOpId] = useState<string>(() => newOpId())
  const renew = useCallback(() => setOpId(newOpId()), [])
  return { opId, renew }
}
