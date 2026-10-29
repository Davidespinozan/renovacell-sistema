// VINCULAR-CLIENTE · caso María de Lourdes: le cae a Alejandra por reparto; el panel la sugiere; Alejandra la vincula y
// la conversación pasa a Roberto (su vendedor), que ve la ficha y puede mandarle el acceso al portal.
import { browser, sesion, ir, clic, sleep } from './lib.mjs'
const OUT = process.env.E2E_OUT
const abrirWA = async (p) => {
  const h = await p.evaluateHandle(() => {
    const filas = [...document.querySelectorAll('[data-testid=asesorias] li, [data-testid=asesorias] .card, [data-testid=asesorias] article, [data-testid=asesorias] div')]
      .filter((e) => /Visitante|WhatsApp|Lourdes|LOURDES/i.test(e.innerText) && e.querySelector('button'))
    filas.sort((x, y) => x.innerText.length - y.innerText.length)
    return filas[0]?.querySelector('[data-testid=btn-atender], [data-testid=btn-abrir], button') ?? null })
  const el = h.asElement(); if (!el) throw new Error('sin fila de WhatsApp'); await el.click(); await sleep(3000)
}
const b = await browser()
try {
  const a = await sesion(b, 'alejandra@e2e.mx')
  await ir(a, 'Conversaciones'); await sleep(1500)
  await clic(a, '^Atender ahora$'); await sleep(3500)
  await a.screenshot({ path: `${OUT}/vinc-1-alejandra.png` })
  await clic(a, 'Es este cliente'); await sleep(2500)
  await a.screenshot({ path: `${OUT}/vinc-2-vinculada.png` })
  console.log('mensaje:', await a.evaluate(() => document.querySelector('[data-testid=pc-msg]')?.textContent))
  const r = await sesion(b, 'roberto@e2e.mx')
  await ir(r, 'Conversaciones'); await sleep(1500)
  await r.screenshot({ path: `${OUT}/vinc-3-roberto-lista.png` })
  await clic(r, '^Atender ahora$|^Abrir$'); await sleep(3500)
  await r.screenshot({ path: `${OUT}/vinc-4-roberto-ficha.png` })
  for (const p of [a, r]) if (p.errores.length) console.log(p.email, p.errores.slice(0, 6))
} finally { await b.close() }
