# Auditoría operativa — Renovacell

6 auditores independientes recorrieron el sistema **con la mente de cada operador**
(Almacén, Empaque/Chofer, POS/Caja, Doctor, Dirección/Finanzas, Comunicación/Ventas),
buscando flujos truncos, información en el limbo, cálculos errados, interfaces
incómodas y diseños frágiles. Hallazgos deduplicados y priorizados por impacto real.

> Nota de honestidad: algunos tocan código de la última sesión (cobranza, doctores en
> riesgo, efectivo esperado) — van marcados. La mayoría es deuda previa.

---

## P0 · CRÍTICOS — arreglar antes de operar de verdad

**C1 · Seguridad — el KYC se salta solo.** `verify-cedula/index.ts:188` pone
`verified=true` cuando la cédula da `auto`, **sin mirar `meta.identity.status`**. Un
doctor que quedó "en revisión" biométrica inicia sesión, teclea solo su cédula y entra —
anulando justo la verificación de identidad (selfie/INE) que lo tenía en revisión.
→ *Fix:* no auto-verificar si `identity.status==='pending'`; dejar ese caso a Dirección.

**C2 · Venta POS no es atómica.** `pos.ts:37-54` crea la orden pagada y descuenta
inventario por **caminos separados fire-and-forget** (solo `console.warn` si falla). Dos
tablets en un evento venden lo mismo → cobras al cliente, la venta queda pagada, **el
inventario nunca baja**, y el cajero ve el modal verde de éxito. → *Fix:* una sola RPC
`vender_pos(...)` transaccional (como `surtir_pedido`/`importar_lote`).

**C3 · `markPaid` no avanza el estado → sobreventa repetible.**
`ordersStore.ts:285` solo pone `payment_status:'paid'` y deja `status='pending_payment'`.
El pedido sigue apareciendo como "por surtir" y **se puede surtir una y otra vez,
descontando inventario cada vez**, con falso éxito (muerde permanente en modo demo).
→ *Fix:* `markPaid` avanza `status` a `'paid'` (como `payOrder`); `surtirPedido` devuelve
`ok` según el `markPacked` real, no incondicional.

**C4 · Corte de caja usa el día UTC, no el local.** `finanzas.ts` + `CierreCaja.tsx`:
`today = toISOString().slice(0,10)` y el filtro por `created_at` UTC. La frontera del
"día" cae a las **18:00 hora de México** → un corte a las 8pm **pierde casi todas las
ventas del día** y marca un faltante gigante por algo que cuadra. → *Fix:* calcular el
día en zona local (America/Mexico_City) para `today` y el filtro.

**C5 · Utilidad y margen FALSOS presentados como reales.** Con `product_costs` en 0,
`costoVentas=0` → el estado de resultados muestra **margen 100%**, los tiles salen en
verde como dato firme, y el **export a Excel se va al contador con margen 100% sin una
sola advertencia**. → *Fix:* con lotes a costo 0, suprimir/marcar "no confiable" utilidad
y márgenes, e incluir la leyenda en el propio export.

---

## P1 · ALTOS — limbo, cálculos rotos, flujos truncos

### Cadena de prueba de entrega (rota de punta a punta)
- **H1 · Los envíos por paquetería nunca se cierran** (`Cola.tsx`, `Seguimiento.tsx`): no
  hay ningún botón para marcar entregado un envío que no es de chofer propio → el pedido
  queda "enviado" para siempre y se acumula como falso atorado. *(el RPC `confirmar_entrega`
  ya autoriza a staff; falta el botón.)*
- **H2 · Se marca entregado ANTES de que la foto suba** (`MisEntregas.tsx:247`): el botón
  se habilita con el *preview* local, no con la ruta subida (`proofPath`). Con mala señal
  → entrega **sin evidencia**, en silencio.
- **H3 · La prueba de entrega no se puede ver** (`uploads.ts:42` `signedProofUrl` sin usar):
  la foto se guarda en el bucket privado y **ninguna pantalla la muestra**. Ante una
  disputa, evidencia inútil.

### Cálculos financieros
- **H4 · COGS y ventas de periodos distintos** (`finanzas.ts` vs `Finanzas.tsx`): ventas
  por `order.created_at`, costo por `movement.created_at`. Un pedido creado fin de mes y
  surtido el siguiente **infla un mes (margen 100%) y hunde el otro (pérdida fantasma)**.
- **H5 · Devoluciones no reintegran inventario ni revierten COGS** (`finanzas.ts:37-57`):
  una devolución de producto baja las ventas **y** deja el COGS contado **y** el stock no
  regresa al almacén → doble castigo + fuga de inventario. Además `devolucion` (producto
  volvió) y `correccion` (nunca entró dinero) reciben el mismo trato contable.
- **H6 · Cobranza no cuadra: Vendido ≠ Cobrado + Por cobrar** (`finanzas.ts:82-91`, *código
  de esta sesión*): el reembolso sobre pedidos pagados no aparece en ningún tile →
  faltan renglones sin explicar. → *Fix:* tile "Devuelto" y reconciliar.

### Doctor y leads en el limbo
- **H7 · El doctor aprobado nunca recibe aviso** (`register-doctor`, `doctorsStore`): se le
  promete "te avisamos por correo" pero todas las notificaciones van a `admin`; al aprobar
  no le llega nada. No sabe si puede comprar.
- **H8 · Los leads del sitio no llegan al vendedor** (`capture-lead:88`, `Bandeja.tsx:60`):
  se asignan a un vendedor pero solo notifican a `admin`; y "Mi bandeja" filtra por email
  mientras `assigned_to` es UUID → siempre "todo al día" aunque tenga leads.
- **H9 · Convertir prospecto sin correo crea un doctor fantasma** (`doctorsStore:149`):
  sale del pipeline como "convertido" apuntando a un doctor local que desaparece al
  recargar. Lead perdido sin rastro.
- **H10 · Doctor rechazado se ve idéntico a "pendiente"** (`Doctores.tsx`): sin pill ni
  aviso; queda en la lista para siempre y nadie lo re-canaliza.

### Truncos / precios
- **H11 · El registro dentro de la app es incoherente con la landing** (`Login.tsx`): no
  captura INE/selfie; en producción puede dejar al doctor **sin cuenta** pese a decir
  "entras al instante".
- **H12 · Asignar lista de precios no persiste** (`pricingStore:72`): en mock no hace nada;
  en live no refresca. Dirección cree que asignó "Mayoreo" y **el doctor paga el precio
  equivocado**.
- **H13 · El checkout se declara "de demostración" al cliente** (`PaymentModal`): rompe la
  confianza; y "transferencia" marca `paid` sin comprobante.

### Almacén
- **H14 · Existencias suma lotes caducados; otras pantallas los excluyen** (`Existencias.tsx:64`):
  el mismo producto reporta cifras distintas → el operador cree tener más de lo vendible.
- **H15 · Cero alertas de caducidad** (pull-only): hay que abrir la pantalla para
  enterarse. Para producto médico regulado, el "por vencer" es un punto ciego total.
- **H16 · Trazabilidad por pedido no ve las salidas de consignación** (`Trazabilidad.tsx:209`):
  usa el folio, pero consignación registra por vendedor → ante un recall, no responde con
  qué lote se surtió.

---

## P2 · MEDIOS

**Caja/POS:** sin **fondo de caja inicial** (arqueo nunca cuadra); comparación de flotantes
`!== 0` pide motivo por sub-centavo; `event_id` nunca se asigna → **arqueo por evento en $0**;
el corte **mezcla todos los cajeros** del día; sin cálculo de **cambio**; sin corregir la
última venta desde la Caja (existe la RPC para rol `pos`, falta el botón).

**Chofer:** incidencias solo "reintentar" (un rechazado vuelve al mismo chofer, sin devolver
a almacén/reasignar/cancelar); direcciones vacías `—, —` envenenan la ruta; cierre optimista
oculta fallos del RPC (divergencia pedido/envío); confirmar carga sin conteo vs manifiesto.

**Finanzas:** **CFDI simulado mostrado como timbrado** (UUID falso exportado sin marca);
**tres definiciones distintas de "cuentas por cobrar"** en la misma app; cambios de
**precio/lista no se auditan** en Bitácora; ventas/LTV/top/riesgo **no restan devoluciones**
(no cuadran con el P&L).

**Doctor:** botón **"Agregar" vivo pero muerto** en productos "a consultar"; productos con
precio **sin lote = incomprables** (indistinguible de agotado); reintento en bucle sin salida
cuando no hay proveedor de cédula.

**Comunicación:** **UUIDs en vez de nombres** en Prospectos (interfaz inservible para
repartir); **doctores en riesgo no registra el contacto** (*código de esta sesión* — el
mismo doctor reaparece cada día) y **solo lo ve admin**, no el vendedor dueño; el
**multicanal** (WhatsApp/IG/FB con "rayo ⚡") está **prometido pero no existe** la ingesta;
las notifs de lead por `roles:['pos']` → **todos los vendedores ven la asignación de todos**;
solicitud de recurso entregada **no notifica** al solicitante.

**Almacén:** caducidad **no obligatoria** al dar entrada; FEFO ambiguo el **día de
vencimiento** (aún surtible) y con criterio de fecha distinto al de la UI; "dar de baja"
siempre el **lote completo** (sin merma parcial); reabasto marca "recibido" **sin confirmar**
que el lote se creó; alertas de stock bajo van solo a `admin`, no a Almacén.

---

## P3 · Ergonomía / pulido

POS sin **buscador ni escáner** de código (scroll sobre 64 productos en un evento con fila),
sin **pago mixto**, sin **reimprimir** recibo del turno; chofer reordena con flechitas ▲▼
(mover la parada 8 al 1 = 7 toques), su ruta vive **solo en localStorage** (se pierde al
cambiar de equipo), despacho **por-pedido** en vez de por-carga (N confirmaciones);
umbrales de "stock bajo" **inconsistentes** (10 vs 20); entrada manual sin idempotencia
(dos lotes con el mismo código); `lots.quantity` sin `CHECK (>= 0)` en BD.

---

## Recomendación de orden
1. **P0 completo** — son dinero, datos y seguridad que muerden en producción/demo.
2. **Cadena de prueba de entrega (H1–H3)** — riesgo legal/operativo alto y acotado.
3. **Cálculos financieros (H4–H6)** — para que los números que ve Dirección sean ciertos.
4. **Limbo de leads/doctores (H7–H10)** — cada uno es una venta o un cliente que se pierde.
5. El resto por severidad.

Muchos P0/P1 comparten raíz: **atomicidad en el servidor** (venta/pago/inventario en una
RPC) y **matching correcto de periodo/dinero**. Atacarlas resuelve varios de un golpe.