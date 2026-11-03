// Simulador LOCAL de la API de DHL (solo para el ensayo E2E; nunca toca DHL real).
import http from 'node:http'
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')
let n = 0
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    console.log(new Date().toISOString(), req.method, req.url)
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.method === 'POST' && req.url.endsWith('/rates')) return send(200, { products: [
      { productCode: 'N', productName: 'EXPRESS DOMESTIC', totalPrice: [{ price: 330.62, priceCurrency: 'MXN' }], deliveryCapabilities: { totalTransitDays: 2, estimatedDeliveryDateAndTime: '2026-11-05T23:59:00' } },
      { productCode: '1', productName: 'EXPRESS DOMESTIC 12:00', totalPrice: [{ price: 421.68, priceCurrency: 'MXN' }], deliveryCapabilities: { totalTransitDays: 2, estimatedDeliveryDateAndTime: '2026-11-05T12:00:00' } },
    ] })
    if (req.method === 'POST' && req.url.endsWith('/shipments')) { n++; return send(201, { shipmentTrackingNumber: `99000000${n}`, documents: [{ typeCode: 'label', imageFormat: 'PDF', content: pdf }] }) }
    if (req.method === 'GET' && /tracking|shipments/.test(req.url)) return send(404, { status: 404, detail: 'no data' })
    send(404, { detail: 'stub: ruta no simulada ' + req.url })
  })
}).listen(4999, () => console.log('dhl stub :4999'))
