// PRUEBA DE CARGA (2 nov 2026) contra el stack LOCAL: N doctores compran a la vez (login → catálogo → carrito → revisión
// → pedido) durante S segundos; luego todos compiten por las ÚLTIMAS piezas de un producto. Mide tiempos y errores y
// comprueba en la base que no se venda de más. Uso: SR=<service local> ANON=<anon local> node e2e/dia/carga.mjs [N] [S]
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
const URL = 'http://127.0.0.1:54321', N = Number(process.argv[2] || 20), S = Number(process.argv[3] || 60)
const db = (sql) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-At', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim()
const admin = createClient(URL, process.env.SR, { auth: { persistSession: false } })
const PASS = 'E2e-prueba-2026'
db('delete from rate_limit_buckets')

// ── preparación: N doctores verificados con ficha y domicilio en Culiacán
const ids = []
for (let i = 1; i <= N; i++) {
  const email = `carga${String(i).padStart(2, '0')}@e2e.mx`
  let { data, error } = await admin.auth.admin.createUser({ email, password: PASS, email_confirm: true, user_metadata: { name: `Dr. Carga ${i}` } })
  let id = data?.user?.id
  if (error) id = db(`select id from auth.users where email = '${email}'`)
  ids.push(id)
  db(`set app.trusted = 'on'; update profiles set role_id = 'doctor', verified = true, active = true, full_name = 'Dr. Carga ${i}' where id = '${id}';
      insert into customers (full_name, email, profile_id, source, active) select 'Dr. Carga ${i}', '${email}', '${id}', 'portal', true where not exists (select 1 from customers where profile_id = '${id}');
      insert into doctor_locations (doctor_id, customer_id, name, line1, postal_code, city, state, country, contact_phone, is_default, active)
        select '${id}', (select id from customers where profile_id = '${id}' limit 1), 'Consultorio', 'Av. Obregón 1', '80000', 'Culiacán', 'Sinaloa', 'MX', '6670000000', true, true
        where not exists (select 1 from doctor_locations where doctor_id = '${id}');`)
}
const prod = db(`select l.product_id from lots l join products p on p.id = l.product_id where l.quantity >= 20 and p.price > 0 and p.sellable order by p.price limit 1`)
console.log(`${N} doctores listos · producto ${prod.slice(0, 8)}`)

const lat = {}; const err = {}
const medir = async (op, fn) => { const t = performance.now(); try { const r = await fn(); if (r?.error) throw r.error; (lat[op] ||= []).push(performance.now() - t); return r } catch (e) {
  const ctx = e?.context; let det = String(e?.message ?? e).slice(0, 60)
  if (ctx && typeof ctx.status === 'number') { const b = await ctx.json?.().catch(() => null); det = `${ctx.status} ${b?.error ?? ''}` }
  (err[op] ||= []).push(det); return null } }
const PAUSA = Number(process.env.PAUSA_MS ?? 3000)   // un humano tarda segundos entre clics
const pausa = () => new Promise((r) => setTimeout(r, PAUSA * (0.5 + Math.random())))
const sesion = async (i) => {
  const c = createClient(URL, process.env.ANON, { auth: { persistSession: false } })
  await medir('login', () => c.auth.signInWithPassword({ email: `carga${String(i).padStart(2, '0')}@e2e.mx`, password: PASS }))
  return c
}
const comprar = async (c, producto, qty = 1) => {
  await medir('catalogo', () => c.from('products_safe').select('id, name, price').limit(200))
  const a = await medir('carrito_abrir', () => c.functions.invoke('cart', { body: { action: 'abrir' } }))
  const cart = a?.data?.cart_id; if (!cart) return null
  await pausa(); await medir('carrito_vaciar', () => c.functions.invoke('cart', { body: { action: 'vaciar', cart_id: cart, operation_id: crypto.randomUUID() } }))
  await medir('carrito_agregar', () => c.functions.invoke('cart', { body: { action: 'agregar', cart_id: cart, product_id: producto, cantidad: qty, operation_id: crypto.randomUUID() } }))
  await pausa(); const r = await medir('checkout_revisar', () => c.functions.invoke('cart', { body: { action: 'revisar_checkout', cart_id: cart, entrega: 'recoge' } }))
  const rv = r?.data; if (!rv?.review_id) { (err.checkout_revisar_no_listo ||= []).push(String(JSON.stringify(rv?.problemas ?? rv ?? null)).slice(0, 90)); return null }
  const k = await medir('checkout_confirmar', () => c.functions.invoke('cart', { body: { action: 'confirmar_checkout', review_id: rv.review_id, operation_id: crypto.randomUUID(), expected_cart_rev: rv.cart_rev ?? rv.rev } }))
  return k?.data?.order_id ?? null
}

// ── fase 1: carga sostenida
const antes = Number(db('select count(*) from orders'))
const clientes = await Promise.all(ids.map((_, i) => sesion(i + 1)))
const fin = Date.now() + S * 1000; let pedidos = 0
await Promise.all(clientes.map(async (c) => { while (Date.now() < fin) { if (await comprar(c, prod)) pedidos++; await pausa() } }))
const creados = Number(db('select count(*) from orders')) - antes
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
console.log(`\nFASE 1 · ${N} usuarios × ${S}s · pedidos confirmados ${pedidos} (en base: ${creados})`)
for (const [op, a] of Object.entries(lat)) console.log(`  ${op.padEnd(20)} n=${String(a.length).padStart(4)}  p50=${pct(a, .5)}ms  p95=${pct(a, .95)}ms  máx=${pct(a, 1)}ms`)
for (const [op, e] of Object.entries(err)) console.log(`  ERROR ${op}: ${e.length} · ${[...new Set(e)].slice(0, 3).join(' | ')}`)

// ── fase 2: últimas piezas — producto con 3 en existencia, todos piden 1 al mismo tiempo
db('delete from rate_limit_buckets')
const escaso = db(`select l.product_id from lots l join products p on p.id = l.product_id where p.price > 0 and p.sellable and l.product_id <> '${prod}' order by p.price limit 1`)
db(`set app.trusted = 'on'; set renovacell.purge = 'on'; update lots set quantity = 3 where product_id = '${escaso}'`)
for (const k of Object.keys(lat)) delete lat[k]; for (const k of Object.keys(err)) delete err[k]
process.env.PAUSA_MS = '0'
const res = await Promise.all(clientes.map((c) => comprar(c, escaso)))
const ok = res.filter(Boolean)
console.log(`\nFASE 2 · ${N} doctores piden la última pieza (existencia 3): pedidos creados ${ok.length}`)
for (const [op, e] of Object.entries(err)) console.log(`  rechazos ${op}: ${e.length} · ${[...new Set(e)].slice(0, 2).join(' | ')}`)
console.log('  disponible ahora:', db(`select coalesce(sum(disponible), 0) from v_stock_disponible where product_id = '${escaso}'`))
console.log(JSON.stringify({ escaso, pedidos: ok }))
