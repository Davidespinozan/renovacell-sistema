// PAGO-DESDE-CONVERSACIÓN · Roberto, en la conversación de su clienta, marca la foto que ella mandó como comprobante y
// reporta el pago de su pedido; Dirección lo ve en Pagos por validar con la foto. (Fase 2, ya validado: mandar recibo.)
import { browser, sesion, ir, clic, sleep, texto } from './lib.mjs'
const OUT = process.env.E2E_OUT
const FASE = process.env.FASE || '1'
const b = await browser()
try {
  if (FASE === 'dir') {
    // Dirección: lo ve en Cobros › Pagos por validar con la foto, la abre y confirma.
    const a = await sesion(b, 'antonio@e2e.mx')
    await ir(a, 'Cobros'); await sleep(2500)
    console.log('cola:', (await texto(a)).split('\n').filter((l) => /S1000|12,000|Ver/.test(l)).slice(0, 8))
    await a.screenshot({ path: `${OUT}/pago-3.png` })
    const abierta = new Promise((res) => b.once('targetcreated', (t) => res(t.url())))
    await clic(a, 'Ver'); console.log('comprobante abre:', String(await Promise.race([abierta, sleep(4000).then(() => 'sin pestaña')])).replace(/token=.*/, 'token=…'))
    a.on('dialog', (d) => d.accept())
    await clic(a, 'Confirmar'); await sleep(3000)
    await a.screenshot({ path: `${OUT}/pago-3b.png` })
    console.log('errores dir:', a.errores.filter((e) => !/cart|ERR_NAME/.test(e)).slice(0, 5))
    process.exit(0)
  }
  const r = await sesion(b, 'roberto@e2e.mx')
  await ir(r, 'Conversaciones'); await sleep(1500)
  await clic(r, '^Atender ahora$|^Abrir$|^Continuar$'); await sleep(3500)
  if (FASE === '1') {
    await clic(r, 'Reportar pago'); await sleep(600)
    await clic(r, 'Usar como comprobante de pago'); await sleep(600)
    await r.screenshot({ path: `${OUT}/pago-1.png` })
    await clic(r, 'Reportar a Dirección'); await sleep(3000)
    console.log('msg:', await r.evaluate(() => document.querySelector('[data-testid=pc-msg]')?.textContent))
    await r.screenshot({ path: `${OUT}/pago-2.png` })
  } else {
    await clic(r, 'Mandar recibo'); await sleep(2500)
    console.log('msg:', await r.evaluate(() => document.querySelector('[data-testid=pc-msg]')?.textContent))
    await r.screenshot({ path: `${OUT}/pago-4.png` })
  }
  console.log('errores:', r.errores.filter((e) => !/cart|ERR_NAME/.test(e)).slice(0, 5))
} finally { await b.close() }
