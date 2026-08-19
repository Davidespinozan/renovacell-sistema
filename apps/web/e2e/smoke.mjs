// SMOKE E2E (portado de la disciplina de CuboPolar): levanta la app en MODO MOCK
// (vite --mode test, que ignora .env.local), entra con CADA rol y recorre TODAS sus
// pantallas, verificando que ninguna ROMPE (ErrorBoundary) ni tira errores de consola.
// Atrapa roturas de auth/routing/render que los tests unitarios no ven. Read-only: solo
// navega, no escribe. Necesita Chrome (CHROME_PATH para apuntarlo).
//   Mock (default):  npm run e2e
//   Backend real:    E2E_EMAIL=... E2E_PASSWORD=... npm run e2e:backend
//                    (vite normal → usa .env.local; READ-ONLY contra Supabase real; verifica
//                     que RLS/lecturas responden. Si faltan credenciales, se OMITE sin fallar.)
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const PORT = Number(process.env.E2E_PORT || 4188)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// MODO: 'mock' (default, determinista, sin backend) o 'backend' (contra Supabase real,
// READ-ONLY). En backend las credenciales llegan por env (E2E_EMAIL/E2E_PASSWORD) — nunca
// se hardcodean ni se commitean. Si faltan, el backend smoke se OMITE (no rompe CI).
const MODE = process.env.E2E_MODE === 'backend' ? 'backend' : 'mock'

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find((p) => existsSync(p))

// Un rol representativo por cada tipo (mock; contraseña demo).
const ROLES = [
  { role: 'Dirección', email: 'direccion@renovacell.mx' },
  { role: 'Almacén', email: 'almacen@renovacell.mx' },
  { role: 'Ventas', email: 'ventas1@renovacell.mx' },
  { role: 'Chofer', email: 'chofer@renovacell.mx' },
  { role: 'Doctor', email: 'laura.mendez@renova.mx' },
]

// Errores de consola benignos que NO son fallas reales de la app.
const BENIGN = [/favicon/i, /net::ERR/i, /React DevTools/i, /Download the React/i]
const isReal = (t) => !BENIGN.some((re) => re.test(t))

async function waitServer(ms = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE); if (r.ok) return true } catch { /* aún no */ }
    await sleep(500)
  }
  throw new Error('el dev server no respondió en ' + BASE)
}

// Devuelve el estado tras el submit: 'ok' (entró al shell), 'gated' (doctor sin verificar
// → pantalla de cédula, comportamiento correcto), 'bad-credentials', o 'unknown'.
async function login(page, email, password) {
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.$eval('input[type=email]', (e) => (e.value = ''))
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', password)
  await page.click('button[type=submit]')
  try {
    await page.waitForSelector('nav.nav a', { timeout: MODE === 'backend' ? 25000 : 15000 })
    await sleep(MODE === 'backend' ? 1200 : 600)
    return 'ok'
  } catch {
    const body = await page.evaluate(() => document.body.innerText)
    if (/Verifica tu c[eé]dula/i.test(body)) return 'gated'
    if (/incorrect/i.test(body)) return 'bad-credentials'
    return 'unknown'
  }
}

async function run() {
  if (!CHROME) { console.error('No encontré Chrome. Define CHROME_PATH.'); process.exit(2) }

  // Cuentas a probar según el modo.
  let accounts
  if (MODE === 'backend') {
    if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
      console.log('⏭  Backend smoke OMITIDO: faltan E2E_EMAIL / E2E_PASSWORD (read-only contra Supabase real).')
      process.exit(0)
    }
    accounts = [{ role: process.env.E2E_ROLE || 'Backend', email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD }]
  } else {
    accounts = ROLES.map((r) => ({ ...r, password: 'demo' }))
  }

  // mock → vite --mode test (ignora .env.local); backend → vite normal (usa .env.local real).
  const viteArgs = MODE === 'backend'
    ? ['vite', '--port', String(PORT), '--strictPort']
    : ['vite', '--mode', 'test', '--port', String(PORT), '--strictPort']
  console.log(`▶ Levantando app (${MODE}) en :${PORT}`)
  const vite = spawn('npx', viteArgs, { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' })
  const kill = () => { try { vite.kill('SIGTERM') } catch { /* */ } }
  process.on('exit', kill); process.on('SIGINT', () => { kill(); process.exit(1) })

  const failures = []
  let browser
  try {
    await waitServer()
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } })

    for (const { role, email, password } of accounts) {
      const page = await browser.newPage()
      let bucket = []
      page.on('console', (m) => { if (m.type() === 'error' && isReal(m.text())) bucket.push(m.text().slice(0, 160)) })
      page.on('pageerror', (e) => { if (isReal(String(e))) bucket.push('PAGEERROR ' + String(e).slice(0, 160)) })

      await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 })
      const status = await login(page, email, password)
      if (status === 'gated') { console.log(`  ${role}: portal bloqueado por verificación de cédula (correcto)`); await page.close(); continue }
      if (status === 'bad-credentials') { failures.push(`${role}: login rechazado (credenciales incorrectas)`); await page.close(); continue }
      if (status === 'unknown') { failures.push(`${role}: no cargó el shell tras el login`); await page.close(); continue }

      const labels = await page.$$eval('nav.nav a', (els) =>
        els.map((e) => e.querySelector('span')?.textContent?.trim()).filter(Boolean))
      let screens = 0
      for (const label of labels) {
        bucket = []
        const clicked = await page.evaluate((t) => {
          const a = [...document.querySelectorAll('nav.nav a')].find((e) => e.querySelector('span')?.textContent?.trim() === t)
          if (a) { a.click(); return true } return false
        }, label)
        if (!clicked) continue
        await sleep(700)
        screens++
        const crashed = await page.evaluate(() => document.body.innerText.includes('Algo salió mal en esta pantalla'))
        if (crashed) failures.push(`${role} › ${label}: ErrorBoundary (crash de render)`)
        for (const e of [...new Set(bucket)]) failures.push(`${role} › ${label}: ${e}`)
      }
      console.log(`  ${role}: ${screens} pantallas recorridas`)
      await page.close()
    }
  } catch (e) {
    failures.push('FATAL ' + String(e))
  } finally {
    if (browser) await browser.close()
    kill()
  }

  console.log('\n' + '─'.repeat(52))
  if (failures.length === 0) {
    console.log('✅ SMOKE OK — todas las pantallas de todos los roles cargan sin crash ni error.')
    process.exit(0)
  } else {
    console.log(`❌ SMOKE: ${failures.length} problema(s):`)
    for (const f of failures) console.log('  • ' + f)
    process.exit(1)
  }
}

run()
