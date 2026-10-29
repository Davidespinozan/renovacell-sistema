// Siembra E2E local: cuentas espejo de producción (mismos roles y capacidades), dos doctores
// verificados con cliente, cartera y domicilio. Solo contra el stack local 127.0.0.1.
import { createClient } from '@supabase/supabase-js'
const URL = 'http://127.0.0.1:54321'
if (!process.env.SR) throw new Error('SR')
const s = createClient(URL, process.env.SR, { auth: { persistSession: false } })
const PASS = 'E2e-prueba-2026'
const A = [
  ['antonio@e2e.mx', 'admin', 'Antonio Gallardo', ['diseno','eventos','anuncios','conversaciones','nuevos_clientes','contenido']],
  ['alberto@e2e.mx', 'warehouse', 'Alberto Gutiérrez', ['anuncios','contenido','eventos','diseno']],
  ['blanca@e2e.mx', 'packing', 'Blanca Barraza', []],
  ['roberto@e2e.mx', 'pos', 'Roberto Ibarra', ['eventos','conversaciones','nuevos_clientes','jefe_ventas']],
  ['alejandra@e2e.mx', 'pos', 'Alejandra Carazarez', ['eventos','conversaciones','nuevos_clientes']],
  ['manuel@e2e.mx', 'driver', 'Manuel Octavio', []],
  ['beto@e2e.mx', 'driver', 'Beto Chofer', []],
  ['doctora@e2e.mx', 'doctor', 'Dra. Sofía Prueba', []],
  ['doctor2@e2e.mx', 'doctor', 'Dr. Jorge Prueba', []],
]
const ids = {}
for (const [email, role, name, caps] of A) {
  let { data, error } = await s.auth.admin.createUser({ email, password: PASS, email_confirm: true, user_metadata: { name } })
  if (error) { const l = await s.auth.admin.listUsers(); data = { user: l.data.users.find((u) => u.email === email) } }
  const id = data.user.id; ids[email] = id
  const { error: e2 } = await s.from('profiles').upsert({ id, email, full_name: name, role_id: role, verified: true, active: true, meta: { name, capabilities: caps } })
  if (e2) console.log('profile', email, e2.message)
}
console.log(JSON.stringify(ids))
