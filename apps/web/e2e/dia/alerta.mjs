// Captura la alerta comercial en vivo: abre Inicio de Dirección y, ya abierto, inserta un aviso de "sin vendedor".
import { execSync } from 'node:child_process'
import { browser, sesion, sleep } from './lib.mjs'
const b = await browser()
try {
  const p = await sesion(b, 'antonio@e2e.mx'); await sleep(2500)
  const conv = execSync(`${process.env.L} -Atc "select id from cc_conversations where modo='human_requested' and seller_profile_id is null order by asesoria_solicitada_at limit 1"`).toString().trim()
  execSync(`${process.env.L} -qc "insert into notifications(body, roles, screen, kind, conversation_id) values ('Visitante solicita asesor', array['admin'], 'av_atencion', '${process.env.KIND}', '${conv}')"`)
  await sleep(5000)
  await p.screenshot({ path: `${process.env.E2E_OUT}/alerta.png` })
  console.log('alerta visible:', await p.evaluate(() => !!document.querySelector('[data-testid=alerta-comercial]')))
} finally { await b.close() }
