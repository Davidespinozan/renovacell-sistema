// W2-C · Blindaje de la custodia verificado EN EL FUENTE:
//  - la custodia no crea un segundo stock físico: vive dentro de lots.quantity;
//  - entregar no mueve inventario, no genera COGS, revenue ni deuda;
//  - la venta va por la ÚNICA ruta económica (vender_pos), no por un motor paralelo;
//  - los tres sitios que comprometen existencia respetan el piso de custodia;
//  - la pérdida es atómica y nunca infiere deuda del tenedor;
//  - el tenedor es una referencia estable, no un correo;
//  - la custodia legacy quedó inerte y su DROP es una migración aparte (C6).
// Sin llamadas reales a la base.
import { describe, it, expect } from 'vitest'
import c1Src from '../../../../../supabase/migrations/20261014120000_w2c_c1_schema.sql?raw'
import c2Src from '../../../../../supabase/migrations/20261014120100_w2c_c2_constraints.sql?raw'
import c3Src from '../../../../../supabase/migrations/20261014120200_w2c_c3_commands.sql?raw'
import c4Src from '../../../../../supabase/migrations/20261014120300_w2c_c4_authority.sql?raw'
import c6Src from '../../../../../supabase/migrations/20261015120000_w2c_c6_legacy_cleanup.sql?raw'
import surtirSrc from './surtir.ts?raw'
import posSrc from './pos.ts?raw'
import finanzasSrc from './finanzas.ts?raw'
import kpisSrc from '../kpis.ts?raw'

// El cuerpo de una función del fuente SQL, para aislar aserciones.
const cuerpo = (src: string, cabecera: string, largo = 3000): string => {
  const i = src.indexOf(cabecera)
  expect(i, `no encontré ${cabecera}`).toBeGreaterThan(-1)
  return src.slice(i, i + largo)
}
// Quita comentarios (SQL `--` y TS `//`) para afirmar sobre CÓDIGO, no sobre la prosa
// que explica por qué algo se quitó. Las URLs (`https://`) no se tocan: el `//` tiene
// que venir precedido de espacio o de inicio de línea.
const codigo = (s: string): string => s
  .split('\n')
  .map((l) => l.replace(/(^|\s)--.*$/, '').replace(/(^|\s)\/\/.*$/, ''))
  .join('\n')

describe('W2-C · un solo stock físico', () => {
  it('la existencia en custodia es DERIVADA del libro, no una columna', () => {
    expect(c1Src).toMatch(/create function public\.custody_held\(p_lot uuid\)/)
    expect(c1Src).toMatch(/select coalesce\(sum\(l\.held_delta\), 0\)/)
    // No existe una tabla paralela de stock de custodia
    expect(c1Src).not.toMatch(/create table public\.custody_stock/)
  })
  it('la disponibilidad es propio − en custodia, en una sola vista', () => {
    expect(c1Src).toMatch(/create view public\.v_stock_disponible/)
    expect(c1Src).toMatch(/greatest\(l\.quantity - public\.custody_held\(l\.id\), 0\)\s+as disponible/)
  })
  it('la aritmética del saldo está fijada por constraint, no por convención', () => {
    expect(c2Src).toMatch(/ck_custody_line_held_delta/)
    expect(c2Src).toMatch(/kind = 'entrega' and held_delta = qty/)
  })
})

describe('W2-C · entregar no es vender ni prestar', () => {
  const entregar = cuerpo(c3Src, 'create function public.entregar_custodia(')
  it('la entrega NO escribe inventory_movements', () => {
    expect(codigo(entregar)).not.toMatch(/insert into public\.inventory_movements/)
  })
  it('la entrega NO toca lots.quantity', () => {
    expect(codigo(entregar)).not.toMatch(/update public\.lots/)
  })
  it('la entrega NO crea dinero, crédito ni reembolso', () => {
    expect(codigo(entregar)).not.toMatch(/payment_entries|payment_claims|credit_grants|refunds|_w2_asiento/)
  })
  it('la entrega valida contra la DISPONIBILIDAD, agregada por lote', () => {
    expect(entregar).toMatch(/DISPONIBILIDAD_INSUFICIENTE/)
    expect(entregar).toMatch(/group by x\.lot_id/)
  })
  it('no se entrega producto caducado (hoy_local, no current_date)', () => {
    expect(entregar).toMatch(/public\.lote_caducado/)
    expect(entregar).toMatch(/LOTE_CADUCADO/)
  })
})

describe('W2-C · una sola ruta económica para la venta', () => {
  it('no hay un segundo comando de venta: la venta es vender_pos con p_custody_id', () => {
    expect(c3Src).toMatch(/p_custody_id uuid default null/)
    expect(c3Src).not.toMatch(/create function public\.vender_de_custodia/)
    expect(c3Src).not.toMatch(/create function public\.vender_custodia/)
  })
  it('la venta desde custodia valida custodia abierta, tenedor, saldo y lote', () => {
    const v = cuerpo(c3Src, 'create or replace function public.vender_pos(', 14000)
    expect(v).toMatch(/CUSTODIA_CERRADA/)
    expect(v).toMatch(/NO_AUTORIZADO: solo el tenedor de la custodia/)
    expect(v).toMatch(/CUSTODIA_SALDO_INSUFICIENTE/)
    expect(v).toMatch(/for update/)                       // cerrojo de la custodia
    expect(v).toMatch(/public\.precio_de/)                // precio del servidor
    expect(v).toMatch(/insert into public\.custody_lines/) // línea de venta en el libro
    expect(v).toMatch(/_w2_asiento/)                      // dinero por la ruta de W2
  })
  it('las líneas de venta se escriben ANTES del descuento, para una sola semántica', () => {
    const v = cuerpo(c3Src, 'create or replace function public.vender_pos(', 14000)
    expect(v.indexOf("insert into public.custody_lines")).toBeLessThan(v.indexOf('update public.lots set quantity'))
  })
  it('el libro exige que toda venta tenga pedido, renglón y precio', () => {
    expect(c2Src).toMatch(/ck_custody_line_venta/)
  })
})

describe('W2-C · los tres sitios que comprometen existencia respetan la custodia', () => {
  it('S-1 surtir_pedido', () => {
    const s = cuerpo(c3Src, 'create or replace function public.surtir_pedido(', 5000)
    expect(s).toMatch(/quantity - a\.qty >= public\.custody_held\(a\.lot_id\)/)
    expect(s).toMatch(/CUSTODIA_EN_PODER/)
  })
  it('S-2 vender_pos', () => {
    const v = cuerpo(c3Src, 'create or replace function public.vender_pos(', 14000)
    expect(v).toMatch(/quantity - a\.qty >= public\.custody_held\(a\.lot_id\)/)
    expect(v).toMatch(/CUSTODIA_EN_PODER/)
  })
  it('S-3 ajustar_lote (una merma no se come lo que trae el vendedor)', () => {
    const a = cuerpo(c3Src, 'create or replace function public.ajustar_lote(', 5000)
    expect(a).toMatch(/quantity \+ p_delta >= public\.custody_held\(p_lot\)/)
    expect(a).toMatch(/CUSTODIA_EN_PODER/)
  })
  it('P-1 product_stock descuenta custodia y usa la zona del negocio', () => {
    expect(c3Src).toMatch(/create or replace view public\.product_stock/)
    const v = cuerpo(c3Src, 'create or replace view public.product_stock', 800)
    expect(v).toMatch(/greatest\(l\.quantity - public\.custody_held\(l\.id\), 0\)/)
    expect(v).toMatch(/public\.lote_caducado/)
    expect(v).not.toMatch(/current_date/)
  })
  it('P-2/P-3 el frontend asigna contra disponibilidad, no contra lo propio', () => {
    expect(surtirSrc).toMatch(/export function mapaEnCustodia/)
    expect(surtirSrc).toMatch(/disponibleDeLote/)
    expect(surtirSrc).toMatch(/planSurtido\(order, getSnapshotLots\(\), mapaEnCustodia\(\)\)/)
    expect(posSrc).toMatch(/allocateFEFO\(l\.product_id, l\.qty, lots, mapaEnCustodia\(\)\)/)
    expect(posSrc).toMatch(/allocateDesdeCustodia/)
  })
})

describe('W2-C · pérdida: atómica y sin deuda inferida', () => {
  const perdida = cuerpo(c3Src, 'create function public._w2c_perdida(', 2500)
  it('registra la línea y DESPUÉS da de baja por la autoridad de W1', () => {
    expect(perdida).toMatch(/insert into public\.custody_lines/)
    expect(perdida).toMatch(/perform public\.ajustar_lote\(/)
    expect(perdida.indexOf('insert into public.custody_lines')).toBeLessThan(perdida.indexOf('public.ajustar_lote('))
  })
  it('NO crea deuda, claim, asiento ni venta', () => {
    expect(codigo(perdida)).not.toMatch(/payment_entries|payment_claims|credit_grants|refunds|insert into public\.orders/)
  })
  it('no existe pérdida sin su baja de inventario ni sin motivo', () => {
    expect(c2Src).toMatch(/ck_custody_line_perdida/)
    expect(c2Src).toMatch(/ck_custody_line_motivo/)
  })
  it('el comando lo dice explícito al operador', () => {
    expect(c3Src).toMatch(/NO genera deuda del tenedor/)
  })
})

describe('W2-C · devolución y cierre', () => {
  it('la devolución limpia no mueve inventario; la dañada sí se da de baja', () => {
    const d = cuerpo(c3Src, 'create function public.devolver_de_custodia(', 4000)
    expect(codigo(d)).not.toMatch(/update public\.lots/)
    expect(d).toMatch(/_w2c_perdida/)
    expect(d).toMatch(/INSPECCION_REQUERIDA/)
    expect(d).toMatch(/lote_caducado/)   // vencido no vuelve a estar disponible
  })
  it('no se cierra una custodia con producto en la calle', () => {
    const c = cuerpo(c3Src, 'create function public.cerrar_custodia(', 3000)
    expect(c).toMatch(/CUSTODIA_CON_SALDO/)
    expect(c).toMatch(/en_poder <> 0/)
  })
  it('la liquidación lee el dinero del libro de W2, no lo recalcula', () => {
    expect(c1Src).toMatch(/from public\.v_order_money/)
  })
})

describe('W2-C · tenedor estable y autoridad', () => {
  it('el tenedor es una referencia, nunca un correo ni texto libre', () => {
    expect(c1Src).toMatch(/holder_user_id\s+uuid references auth\.users/)
    expect(c1Src).toMatch(/holder_customer_id uuid references public\.customers/)
    expect(c1Src).not.toMatch(/holder_email|vendor\s+text/)
    expect(c2Src).toMatch(/ck_custody_holder_unico/)
  })
  it('las tablas de custodia nacen de solo lectura para los clientes', () => {
    expect(c1Src).toMatch(/revoke insert, update, delete, truncate on[\s\S]{0,120}custody_lines from anon, authenticated/)
    expect(c1Src).toMatch(/trg_custody_lines_append_only/)
    expect(c1Src).toMatch(/CUSTODIA_SOLO_POR_COMANDO/)
  })
  it('event_sell se revoca y los contadores legacy quedan inertes', () => {
    expect(c4Src).toMatch(/revoke all on function public\.event_sell/)
    expect(c4Src).toMatch(/drop policy if exists events_all/)
    expect(c4Src).toMatch(/revoke insert, update, delete, truncate on public\.events, public\.consignment_stock/)
  })
  it('C4 NO elimina las tablas legacy: el DROP es C6, y va aparte y después', () => {
    expect(c4Src).not.toMatch(/drop table/)
    expect(c6Src).toMatch(/drop table public\.consignment_stock/)
    expect(c6Src).toMatch(/drop table public\.events/)
    expect(c6Src).toMatch(/drop function public\.event_sell/)
  })
  it('C6 es IDEMPOTENTE: la ausencia del legacy no es un error', () => {
    expect(c6Src).toMatch(/already_applied/)
    expect(c6Src).toMatch(/if not v_events and not v_consig and not v_sell then/)
    expect(c6Src).toMatch(/raise notice/)
  })
  it('C6 ABORTA antes de borrar si hay historia o falta la arquitectura nueva', () => {
    expect(c6Src).toMatch(/W2C_C6_PRECONDICION: events tiene/)
    expect(c6Src).toMatch(/W2C_C6_PRECONDICION: consignment_stock tiene/)
    expect(c6Src).toMatch(/W2C_C6_PRECONDICION: falta la custodia nueva/)
    expect(c6Src).toMatch(/vista\(s\) dependen todavía/)
    // cada drop va condicionado a que la pieza siga existiendo
    expect(c6Src).toMatch(/if v_sell   then execute 'drop function/)
  })
  it('C6 no toca nada de la arquitectura nueva', () => {
    expect(c6Src).not.toMatch(/drop table public\.custod/)
    expect(c6Src).not.toMatch(/drop view public\.v_custody/)
    expect(c6Src).not.toMatch(/drop function public\.custody_held/)
  })
})

describe('W2-C · el COGS de custodia dejó de mentir', () => {
  it('ya no se reconoce costo de ventas al transferir', () => {
    // W5 movió el COGS a data/kpis.ts (espejo de kpi_resultado); la regla es la misma.
    expect(kpisSrc).toMatch(/const SALIDA = new Set\(\['surtido', 'venta'\]\)/)
    // sobre CÓDIGO, no sobre los comentarios que explican por qué se quitaron
    expect(codigo(kpisSrc)).not.toMatch(/'evento'|'consigna'|'evento-regreso'|'consigna-regreso'/)
    expect(codigo(finanzasSrc)).not.toMatch(/'evento'|'consigna'|'evento-regreso'|'consigna-regreso'/)
  })
  it('no quedan razones de movimiento imposibles bajo el vocabulario de W1', () => {
    expect(codigo(finanzasSrc)).not.toMatch(/'baja'/)
    expect(codigo(kpisSrc)).not.toMatch(/'baja'/)
  })
})
