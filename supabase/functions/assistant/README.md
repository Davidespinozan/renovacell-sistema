# assistant — Asistente IA (modelo Claude)

Asistente conversacional con un **modelo real de Anthropic**, con la llave protegida en
el servidor. Dos modos con reglas de seguridad distintas:

- **`doctor`** — concierge de pedidos del médico verificado (info del catálogo que se le
  pasa; NO consejo clínico ni dosis; no inventa productos/precios).
- **`landing`** — orientación pública que informa y **siempre empuja a verificarse**
  (Renovacell vende solo a profesionales; nunca precios ni venta).

**SEAM:** sin `ANTHROPIC_API_KEY` responde **501** → el cliente usa su motor local:
- Portal del Doctor (`useAssistant`): el motor local resuelve estatus/reorden/descubrir
  y lo clínico (deterministas y seguros); solo la charla libre va a la IA. Si 501, se
  queda la respuesta local.
- Landing (widget `rncAi`): intenta la IA (modo landing) y cae a su respuesta canned si
  falla. Verificado en navegador.

## Activar (credencial)

```bash
supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
# opcional: modelo (default claude-haiku-4-5-20251001, rápido y económico)
supabase secrets set ANTHROPIC_MODEL="claude-haiku-4-5-20251001"
```

Endpoint Anthropic: `POST https://api.anthropic.com/v1/messages` (headers `x-api-key`,
`anthropic-version: 2023-06-01`). El catálogo se inyecta como contexto (el cliente lo
manda); no se guarda nada.

## Notas
- El modo `doctor` recibe el catálogo real (productos activos) para responder con base en
  él. El modo `landing` recibe solo nombres/categorías (informativo).
- Para conversación con memoria, el cliente puede mandar `messages: [{role, content}]`
  (se toman los últimos 12); si no, manda `text`.
