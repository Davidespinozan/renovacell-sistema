// Edge Function · CS-1A.4 · returnUrl del reto 3DS (step-up). El ACS del banco redirige aquí DENTRO del iframe al terminar
// (POST con TransactionId y MD). Esta página NO decide nada: no lee, no guarda ni reenvía el TransactionId; solo avisa al padre
// (postMessage) para que el portal pida al servidor la VALIDACIÓN con el authenticationTransactionId que ya tiene guardado.
// Pública por naturaleza (la llama el banco): desplegar con --no-verify-jwt. Sin secretos, sin base de datos, sin red.
import { htmlRetorno3ds } from '../cs-3ds/contrato.ts'

Deno.serve((req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('method not allowed', { status: 405 })
  return new Response(htmlRetorno3ds(), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
  })
})
