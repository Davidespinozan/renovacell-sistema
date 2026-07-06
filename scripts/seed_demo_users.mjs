// Siembra los usuarios demo en Supabase Auth + profiles (idempotente).
// Uso: `set -a; source supabase/.env.local; set +a; node scripts/seed_demo_users.mjs`
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (gitignoreados).
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const PASSWORD = 'demo1234'
const ACCOUNTS = [
  { email: 'direccion@renovacell.mx', role: 'admin',     verified: true,  name: 'Claudia · Dirección',               capabilities: [] },
  { email: 'almacen@renovacell.mx',   role: 'warehouse', verified: true,  name: 'Alberto · Almacén / Empaque',       capabilities: ['diseno', 'anuncios'] },
  { email: 'ventas1@renovacell.mx',   role: 'pos',       verified: true,  name: 'Lucía · Ventas',                    capabilities: ['eventos'] },
  { email: 'ventas2@renovacell.mx',   role: 'pos',       verified: true,  name: 'Diego · Ventas',                    capabilities: [] },
  { email: 'chofer@renovacell.mx',    role: 'driver',    verified: true,  name: 'Beto · Chofer',                     capabilities: [] },
  { email: 'chofer2@renovacell.mx',   role: 'driver',    verified: true,  name: 'Marta · Chofer',                    capabilities: [] },
  { email: 'laura.mendez@renova.mx',  role: 'doctor',    verified: true,  name: 'Dra. Laura Méndez',                 capabilities: [] },
  { email: 'mario.ruiz@dermamr.mx',   role: 'doctor',    verified: false, name: 'Dr. Mario Ruiz (en revisión)',      capabilities: [] },
]

const s = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Mapa email -> id de usuarios existentes (para idempotencia)
const existing = new Map()
let page = 1
for (;;) {
  const { data, error } = await s.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error('listUsers:', error.message); break }
  data.users.forEach((u) => existing.set(u.email, u.id))
  if (data.users.length < 200) break
  page += 1
}

for (const a of ACCOUNTS) {
  let id = existing.get(a.email)
  if (!id) {
    const { data, error } = await s.auth.admin.createUser({
      email: a.email, password: PASSWORD, email_confirm: true, user_metadata: { name: a.name },
    })
    if (error) { console.error(`createUser ${a.email}:`, error.message); continue }
    id = data.user.id
    console.log(`+ auth user: ${a.email}`)
  } else {
    // asegura la contraseña conocida en re-ejecuciones
    await s.auth.admin.updateUserById(id, { password: PASSWORD })
    console.log(`= auth user existe: ${a.email}`)
  }
  const { error: perr } = await s.from('profiles').upsert({
    id, email: a.email, full_name: a.name, role_id: a.role, verified: a.verified,
    meta: { capabilities: a.capabilities, name: a.name },
  })
  console.log(`  profile ${a.email}: ${perr ? 'ERROR ' + perr.message : 'ok'}`)
}
console.log('Listo.')
