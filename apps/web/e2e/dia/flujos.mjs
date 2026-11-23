// ENSAYO E2E PROFUNDO (2 nov 2026) contra el stack LOCAL: cada paso se hace en la app real y se comprueba en la base.
// Uso: node e2e/dia/flujos.mjs <paso>   (pasos: doctor_local, doctor_foraneo, …)
import { execFileSync } from 'node:child_process'
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT || '/tmp/claude-501/shots'
export const db = (sql) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-At', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALLA'} · ${msg}`); if (!cond) process.exitCode = 1 }
const modal = (p) => p.evaluate(() => document.querySelector('[data-testid=checkout-canonico]')?.innerText.replace(/\n+/g, ' | ') ?? '(sin modal)')
const sinRuido = (e) => e.filter((x) => !/429|visitor|Too Many/.test(x))

async function compraPortal(b, email, { buscar, horario = false, servicio = null, foto }) {
  const p = await sesion(b, email)
  await ir(p, 'Catálogo'); await sleep(1500)
  await p.click('[data-testid=puerta-ahora-no]').catch(() => {})
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Vaciar')?.click()); await sleep(1200)
  await p.type('[data-testid=catalogo-buscar]', buscar); await sleep(1000)
  await clic(p, '^Agregar$'); await sleep(1500)
  await clic(p, 'Revisar y crear pedido'); await sleep(4000)
  if (horario) { await p.evaluate(() => document.querySelector('[data-testid=horario-picker] [role=radio]:not([disabled])')?.click()); await sleep(2500) }
  if (servicio) {   // PAQ-SIMPLE · ya no hay lista de servicios: se espera la fecha de DHL en su tarjeta
    await p.waitForFunction(() => /Llega el/.test(document.querySelector('[data-testid=entrega-foraneo_dhl]')?.textContent ?? ''), { timeout: 15000 }).catch(() => console.log('sin fecha de DHL'))
  }
  console.log('checkout:', (await modal(p)).slice(0, 700))
  await p.screenshot({ path: `${OUT}/${foto}-1.png` })
  await p.click('[data-testid=checkout-crear]'); await sleep(5000)
  console.log('resultado:', (await modal(p)).slice(0, 500))
  await p.screenshot({ path: `${OUT}/${foto}-2.png` })
  console.log('errores:', sinRuido(p.errores).slice(0, 6))
  return p
}

const paso = process.argv[2]
const b = await browser()
try {
  if (paso === 'doctor_local') {
    await compraPortal(b, 'doctora@e2e.mx', { buscar: 'golden placenta', horario: true, foto: 'f1' })
    const o = db(`select left(o.id::text, 8) || '|' || total || '|' || shipping_cost || '|' || (shipping_meta->'entrega'->>'tipo') || '|' || coalesce(shipping_meta->'entrega'->'horario'->>'inicio','-') || '|' || status || '|' || payment_status from orders o join profiles p on p.id = o.doctor_id where p.email = 'doctora@e2e.mx' order by o.created_at desc limit 1`)
    console.log('pedido:', o); const [, total, flete, tipo, ini] = o.split('|')
    ok(Number(total) === 15000 && Number(flete) === 0 && tipo === 'local' && ini !== '-', 'doctor Culiacán: pedido 15,000 con chofer gratis y horario reservado')
  }
  if (paso === 'doctor_foraneo') {
    await compraPortal(b, 'doctor2@e2e.mx', { buscar: 'golden placenta', foto: 'f2' })
    const o = db(`select left(o.id::text, 8) || '|' || total || '|' || shipping_cost || '|' || (shipping_meta->'entrega'->>'opcion') || '|' || coalesce(shipping_meta->'entrega'->'servicio'->>'codigo','sin servicio') from orders o join profiles p on p.id = o.doctor_id where p.email = 'doctor2@e2e.mx' order by o.created_at desc limit 1`)
    console.log('pedido:', o); const [, total, flete, opcion] = o.split('|')
    ok(Number(total) === 15000 && Number(flete) === 0 && opcion === 'foraneo_dhl', 'doctor Mazatlán ≥ 5,000: DHL gratis (sin llaves de DHL: regla de siempre)')
  }
  if (paso === 'doctor_servicio') {
    await compraPortal(b, 'doctor2@e2e.mx', { buscar: 'golden placenta', servicio: true, foto: 'f3' })
    const o = db(`select left(o.id::text, 8) || '|' || total || '|' || shipping_cost || '|' || coalesce(shipping_meta->'entrega'->'servicio'->>'llega_fecha','-') || '|' || coalesce(shipping_meta->'entrega'->>'llega_hasta','-') from orders o join profiles p on p.id = o.doctor_id where p.email = 'doctor2@e2e.mx' order by o.created_at desc limit 1`)
    console.log('pedido:', o); const [, total, flete, prometida, llega] = o.split('|')
    ok(Number(flete) === 0 && Number(total) === 15000 && prometida !== '-' && llega === prometida, 'PAQ-SIMPLE · DHL: solo la regla (gratis desde 5,000, sin recargo) y la fecha más tardía de la cotización')
  }
} finally { await b.close() }
