# Diseño — Sistema de ventas y consignación

Spec de diseño (no de implementación) para dejar bien pensado el sistema de ventas
antes de construir. Fecha: 6 de agosto de 2026.

## Principio rector
Toda existencia vive en una **ubicación**: central (Almacén), la **consignación de un
vendedor**, o un **evento**. Una venta descuenta de una ubicación; cada movimiento queda
en el **ledger inmutable** (trazabilidad lote → cliente, requisito COFEPRIS). **No se
re-arquitecta el inventario**: se extiende el modelo de consignación + corte que ya existe.

## Canales de venta (orígenes)
1. **Mostrador / Tienda (POS)** — vende desde central (o desde su propia ubicación).
2. **Evento** — Caja en contexto de evento; vende del stock asignado al evento.
3. **Ambulante (visita)** — el vendedor vende de **su** consignación, en mano.
4. **Portal del doctor** — desde central; se **envía a domicilio** (usa la dirección de entrega).

## Dos tipos de vendedor (flag en el perfil)
La diferencia de raíz que define todo el flujo:

- **Diario (ambulante).** Recibe producto en la mañana, vende en visitas y **cierra al final
  del día**: rinde efectivo y **devuelve el sobrante**. No conserva producto de un día a otro.
- **Permanente (almacén propio / sucursal).** Mantiene un saldo continuo, se reabastece y
  regresa lo no vendido cuando quiere. Es una mini-central. **← es lo que el sistema hace hoy.**

## Ciclo del vendedor DIARIO (jornada)
Es el mismo patrón del corte de caja del POS, pero sobre su consignación:

1. **Apertura / manifiesto de salida** — Almacén le entrega X por lote (sale de central →
   su consignación). Queda registrado quién autorizó y a qué hora.
2. **Ventas del día** — cada venta descuenta de su carga (trazabilidad lote → doctor).
3. **Cierre del día (obligatorio):**
   - **Arqueo de efectivo** (como el corte de caja).
   - **Devolución del sobrante** → regresa a central; su saldo vuelve a **cero**.
   - **Diferencias visibles**: faltante de producto o de efectivo, con responsable.
4. No puede abrir una nueva jornada con una anterior sin cerrar (obliga a rendir).

## Vendedor PERMANENTE
- Saldo continuo. Se reabastece (asignación) y regresa cuando quiere. Arqueo por **periodo**,
  no por día. **= lo actual** (`consignment_stock`, saldo permanente). No cambia.

## Eventos
- Se modelan como una **jornada por evento**: stock asignado al evento, ventas por Caja con
  contexto de evento (**ya existe** el arqueo por evento), y **cierre del evento** que devuelve
  el sobrante. Reusa el mismo ciclo del vendedor diario.

## Qué EXISTE hoy vs qué FALTA
**Existe:** consignación permanente por vendedor; POS con contexto de evento; arqueo por
cajero y por evento; trazabilidad de consignación (lote→cliente); dirección de entrega base
(en construcción).

**Falta:**
- **Flag de tipo de vendedor** (diario / permanente) en el perfil.
- **Ciclo de jornada del diario:** manifiesto de salida + **cierre obligatorio** con arqueo y
  devolución del sobrante (saldo→0).
- **Reportes por jornada / por canal / por vendedor** y conciliación.

## Fases de construcción (orden sugerido)
1. **Dirección de entrega del cliente** (base + por-pedido). *(en curso — commit abfb1a5)*
2. **Tipo de vendedor** (flag) + capturarlo al dar de alta/editar al vendedor.
3. **Jornada del vendedor diario:** manifiesto de salida (Almacén) → ventas → **cierre**
   (arqueo + devolución del sobrante). Reusa `consignment_stock` + el patrón de corte de caja.
4. **Reportes:** ventas por canal / vendedor / jornada; conciliación de efectivo y producto.
5. **Eventos como jornada** (si se decide unificar).

## Nota de alcance (honesta)
El Anexo A (Quincena 1) incluye **"consignación por vendedor"** — el modelo **permanente**, ya
entregado. El modelo **diario con ciclo de jornada** es una **extensión/refinamiento**. Si
resulta un refinamiento acotado, entra sin fricción; si crece a un módulo nuevo (manifiestos,
cierres, conciliación completa), conviene registrarlo como **control de cambios** (cláusula 16)
para dejar claro su impacto — sin sorpresas para ninguna de las partes.

## Lo único que solo el cliente puede confirmar
- ¿El **cierre diario** del ambulante devuelve el sobrante **físicamente al almacén** cada día,
  o solo lo **concilia** (cuenta) y lo conserva para el día siguiente?
- ¿Los **eventos** se cierran igual que una jornada (sobrante de vuelta), o tienen su propia regla?
- ¿Un vendedor puede ser **de los dos tipos** según el día, o es fijo?