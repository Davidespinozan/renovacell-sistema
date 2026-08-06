# Auditoría del flujo: pedido → pago → cobro → surtido → empaque → despacho → entrega

Trazado con el código en mano (no de memoria). Enfocado en la compra del Portal del
Doctor y su entrega a domicilio. Fecha: 6 de agosto de 2026.

## Cómo funciona hoy (la cadena real)
1. **Doctor arma el pedido** (`Catalogo` → checkout) → `createOrder`: nace `status: pending_payment`, `payment_method: contra_pedido`, `payment_status: pending`.
2. **Doctor paga** (`PaymentModal`): tarjeta (Stripe, seam) o transferencia.
3. **Se cobra** → `payment_status: paid`. Almacén **solo surte lo pagado** (`isSurtible` exige `paid`). El cobro ES la compuerta del despacho.
4. **Se surte** (Almacén → Preparar pedidos, FEFO) → **empaca** → **despacha** → **chofer** → **entrega** (con foto).

La dirección de entrega **NO vive en el pedido**: el chofer/logística la leen del **perfil del doctor** (`profiles.meta.address` + `city`).

---

## P0 · Rompe la operación real (invisible en el demo)

**F1 · Sin dirección de entrega.** Ni `orders` ni `shipments` tienen campo de domicilio. El chofer lo lee de `profiles.meta.address`, pero **el registro del doctor NUNCA lo captura** y el **checkout NO lo pide**. En el demo se ve bien porque los doctores de muestra traen dirección; con un **doctor real, la dirección sale `'—'`** → la guía de paquetería y la ruta del chofer se rompen. (`profiles.ts`: `address: m.address ?? '—'`.)

**F2 · El reporte de transferencia es inerte.** Cuando el doctor da "Ya realicé la transferencia", `PaymentModal` **solo llama `notify()`** — (a) no escribe nada en el pedido, y (b) su aviso a Dirección **lo bloquea el RLS**: `notifications_insert WITH CHECK (auth_role() <> 'doctor')`. **Dirección nunca se entera.** El pedido solo queda como "Pendiente" sin señal de que hay una transferencia esperando.

---

## P1 · Huecos claros de flujo

**F3 · "Marcar cobrado" enterrado en Facturación.** Es la compuerta que libera el despacho, pero vive escondido entre la gestión de CFDI. Debería ser una **cola visible "Pagos por confirmar"** (Bandeja + vista propia), al inicio de la cadena, no en contabilidad.

**F4 · Sin comprobante de transferencia.** El doctor no adjunta captura; Dirección coteja el banco a ciegas. La infra ya existe (bucket privado `proofs`, `uploadPrivate`/`signedProofUrl`, la misma de la prueba de entrega del chofer).

**F5 · El doctor no recibe ningún aviso.** El RLS de `notifications_read` excluye a los doctores por completo (`auth_role() <> 'doctor'`). "Pago confirmado", "en camino", "cuenta aprobada" **nunca le llegan**; solo lo ve entrando a *Mis pedidos*. Requiere abrir el RLS a avisos dirigidos por `user_ids`.

**F6 · Datos fiscales del doctor no se capturan.** El CFDI necesita RFC + uso de CFDI + domicilio fiscal (`profiles.meta.fiscal`), pero el registro no los pide → "Emitir CFDI" fallará por datos faltantes con doctores reales.

---

## P2 · Completitud / calidad

**F7 · Dirección de texto libre.** `address` + `city` sueltos no bastan para una guía real: falta calle, número, colonia, CP, estado y referencias (estructurados). El CP es obligatorio para cotizar/timbrar guía.

**F8 · Sin opción de entrega en el checkout.** No se elige paquetería vs chofer local vs recoger en sede; ni dirección alterna (enviar a otra clínica).

**F9 · Merma parcial en almacén.** Hoy la baja es del lote completo; no se puede dar de baja solo una parte (5 de 20 por daño).

**F10 · markPaid no pingaba a Almacén.** ✅ **Arreglado** (commit b13f372): ahora avisa a Almacén al confirmar, como el pago con tarjeta.

---

## Raíz común y orden sugerido
La mayoría cuelga de **dos raíces**:
1. **No se capturan los datos del doctor** (domicilio estructurado + fiscales) ni en el registro ni en el checkout, y **no viajan con el pedido** → rompe entrega y CFDI (F1, F6, F7, F8).
2. **El cobro por transferencia no es un flujo de servidor** (no marca el pedido, el aviso lo bloquea el RLS) → Dirección no lo ve (F2, F3, F4), y el doctor no recibe nada (F5).

**Orden recomendado:**
1. **Datos y dirección del doctor** (F1, F6, F7): capturarlos en el registro/checkout, guardarlos estructurados, y que el pedido lleve su dirección de entrega. Desbloquea entrega y CFDI de golpe.
2. **Cobro por transferencia como flujo real** (F2, F3, F4): el reporte escribe en el pedido + sube comprobante vía función servidor (evita el bloqueo RLS), y una cola "Pagos por confirmar" visible.
3. **Avisos al doctor** (F5): abrir el RLS a avisos dirigidos y avisarle en los hitos.
4. **Merma parcial** (F9) y **opciones de entrega** (F8).