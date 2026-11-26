import { describe, it, expect } from 'vitest'
import { esRepetido, fijarRolDeUso } from './usoPantallas'
import mig from '../../../../../supabase/migrations/20270408050000_uso_pantallas.sql?raw'

describe('medidor de uso de pantallas', () => {
  it('no cuenta dos veces el mismo destino seguido; cambiar de pestaña o de rol sí cuenta', () => {
    fijarRolDeUso('warehouse')
    const a = esRepetido('g_pedidos', 'surtido', '')
    expect(a.repetido).toBe(false)
    expect(esRepetido('g_pedidos', 'surtido', a.clave).repetido).toBe(true)
    expect(esRepetido('g_pedidos', 'cola', a.clave).repetido).toBe(false)
    fijarRolDeUso('admin')
    expect(esRepetido('g_pedidos', 'surtido', a.clave).repetido).toBe(false)
  })
  it('servidor: solo conteos del personal, el doctor no se mide, lo lee Dirección y nadie finge otro rol', () => {
    expect(mig).toMatch(/v_real = 'doctor' then return/)
    expect(mig).toMatch(/when v_real = 'admin' and p_rol in/)
    expect(mig).toMatch(/if public\.auth_role\(\) <> 'admin' then raise exception 'NO_AUTORIZADO'/)
    expect(mig).toMatch(/revoke all on function public\.uso_registrar\(text, text, text\) from public, anon/)
  })
})
