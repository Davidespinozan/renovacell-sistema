// C360-0 · El checkout canónico persiste customers.id resuelto en el SERVIDOR por el perfil (uq_customers_profile);
// sin cliente vinculado falla cerrado. El cliente no manda cliente; la Edge traduce el rechazo sin detalles.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261103120000_c360_0_checkout_customer.sql?raw'
import down from '../../../../../supabase/rollback/c360_0/99_down.sql?raw'
import cartSrc from '../../../../../supabase/functions/cart/index.ts?raw'
import carritoShared from '../../../../../supabase/functions/_shared/carrito.ts?raw'
import { mapearErrorCarrito } from '../../../../../supabase/functions/_shared/carrito'
import { ETIQUETA_PROBLEMA } from './carrito'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/)/.test(l)).join('\n')

describe('C360-0', () => {
  it('resuelve el cliente por perfil (cliente activo) y lo pasa a crear_pedido; falla cerrado antes del pedido', () => {
    const c = codigo(mig)
    expect(c).toMatch(/\$\$ select c\.id from public\.customers c where c\.profile_id = p_profile and c\.active \$\$;/)
    expect(c).toMatch(/v_cust := public\._cc_chk_customer\(v_uid\);\n\s+if v_cust is null then\n\s+raise exception 'CLIENTE_NO_VINCULADO/)
    expect(c.indexOf("raise exception 'CLIENTE_NO_VINCULADO")).toBeLessThan(c.indexOf('w1 := public.crear_pedido('))
    expect(c).toMatch(/meta, coalesce\(p_factura, false\), v_cust\);/)
    expect(c).toMatch(/if v_cust is null then problemas := problemas \|\| '"CLIENTE_NO_VINCULADO"'::jsonb; end if;/)
    expect(c).not.toMatch(/email|seller_name/i)
  })
  it('rollback devuelve el texto de 119', () => { expect(codigo(down)).toMatch(/meta, coalesce\(p_factura, false\), null\);/) })
  it('el cliente no puede suplantar el cliente: la Edge no lee customer del cuerpo', () => {
    expect(codigo(cartSrc)).not.toMatch(/p\.customer|customer_id/)
    expect(codigo(carritoShared)).toMatch(/CLIENTE_NO_VINCULADO/)
  })
  it('rechazo traducido (409) y etiqueta para la revisión', () => {
    expect(mapearErrorCarrito('CLIENTE_NO_VINCULADO: tu cuenta no está ligada')).toMatchObject({ status: 409, body: { error: 'cliente_no_vinculado' } })
    expect(ETIQUETA_PROBLEMA.CLIENTE_NO_VINCULADO).toMatch(/expediente de cliente/)
  })
})
