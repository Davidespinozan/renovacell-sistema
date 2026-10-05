# Piloto: la primera operación real de Renovacell

Esta lista guía la **primera venta real de principio a fin** dentro del sistema. Hoy el
sistema nunca ha operado con datos reales: no tiene pedidos, lotes, cobros ni envíos.
El objetivo del piloto es recorrer el ciclo completo **una vez, con producto y dinero
reales pero en cantidad mínima**, con Dirección mirando cada paso.

Quién participa: **Dirección** (conduce y verifica), **Almacén**, **Ventas** y un
**chofer**. Tiempo estimado: una mañana.

## Reglas del piloto

1. **Una operación a la vez.** No avanzar al siguiente paso hasta verificar el anterior.
2. **Cantidades mínimas.** Un producto, pocas piezas, un cliente de confianza.
3. **Si aparece la franja roja o ámbar arriba de la pantalla, detenerse.** Roja ("No se
   guardó") significa que el sistema rechazó la operación. Ámbar ("Sin confirmar")
   significa que no se sabe si quedó: recargar la página y verificar antes de repetir.
4. **No usar lo que está marcado como compuerta** (sección final): depende de cuentas
   externas que todavía no se activan.
5. **Anotar cualquier cosa rara** con la hora y la pantalla. No corregir datos a mano.

## Antes de empezar (Dirección)

- [ ] *Mi bandeja* abre y no muestra pendientes que nadie reconozca.
- [ ] *Configuración*: los datos de la empresa y al menos una cuenta bancaria principal
      están capturados (es la cuenta a la que transferirá el cliente).
- [ ] *Catálogo*: el producto del piloto tiene precio y **presentación / unidad
      comercial** capturada.
- [ ] *Equipo*: cada participante entra con su propia cuenta y ve su propio menú.
- [ ] El cliente del piloto existe en *Clientes* o en *Doctores* y tiene correo.

## El recorrido

### 1. Recibir producto — Dirección y Almacén
- [ ] Dirección · *Inventario*: registrar una **compra** del producto (pocas piezas).
- [ ] Almacén · *Mi bandeja* muestra **"Compras por recibir"**.
- [ ] Almacén · *Compras* → **Recibir y dar de alta**: lote, caducidad y cantidad reales.
- [ ] **Verificar:** *Lo que hay en almacén* muestra el lote con la cantidad exacta.
- [ ] **Verificar:** Dirección · *Control de inventario* no reporta diferencias.

### 2. Crear el pedido — Ventas
- [ ] Ventas · *Clientes* → cliente del piloto → **Nuevo pedido** con 1–2 piezas.
- [ ] El botón dice "Creando pedido…" y **después** aparece el folio. Si aparece un
      mensaje "El pedido no se creó", no hay pedido: leer el motivo.
- [ ] **Verificar:** Almacén ve el aviso del pedido nuevo.
- [ ] **Verificar:** Dirección · *Mensajes al cliente* tiene un aviso **"Pedido recibido"**
      en estado *Por enviar* (no se envía solo: el correo aún no está activado).

### 3. Cobrar — Dirección
Elegir **una** vía:
- [ ] **Transferencia:** el cliente transfiere; Dirección · *Pagos por validar* confirma
      que el dinero cayó en el banco y registra el cobro.
- [ ] **Crédito:** Dirección autoriza crédito con fecha de pago.
- [ ] **Verificar:** el pedido aparece en Almacén · **"Pedidos por surtir"**. Un pedido sin
      cobro ni crédito **no** debe aparecer ahí.
- [ ] **Verificar:** *Mensajes al cliente* tiene **"Pago recibido"** (solo si se cobró).

### 4. Surtir y empacar — Almacén
- [ ] *Preparar pedidos*: surtir. El sistema propone el lote que caduca primero.
- [ ] **Verificar:** *Lo que hay en almacén* bajó exactamente las piezas surtidas.
- [ ] *Por empacar* → **asignar chofer**. Si aparece "No se asignó el chofer", repetir.

### 5. Despachar y entregar — Almacén y chofer
- [ ] Almacén · *Despacho* → **Despachar**. El aviso dice cuántos pedidos salieron
      **de verdad**.
- [ ] Chofer · **Confirmar que recibí mi carga**.
- [ ] Chofer · en el domicilio: foto de evidencia, nombre de quien recibe, **Entregar**.
      Con mala señal puede decir "Sin confirmar: inténtalo de nuevo" — reintentar es
      seguro, la entrega no se duplica.
- [ ] **Verificar:** Dirección · *Seguimiento* muestra el pedido como entregado.
- [ ] **Verificar:** *Mensajes al cliente* tiene **"Pedido en camino"** y **"Pedido entregado"**.

### 6. Rama de cancelación — con un segundo pedido de prueba
- [ ] Crear un pedido y **cancelarlo antes de pagar**. Verificar que desaparece de las
      colas y que el inventario no se movió.
- [ ] *(Opcional, solo si Dirección lo decide)* cancelar un pedido **ya pagado**:
      debe aparecer en *Mi bandeja* como **"Reembolsos por resolver"**.

### 7. Rama de devolución — con una pieza del pedido entregado
- [ ] Almacén · *Devoluciones y reingresos*: registrar la devolución e **inspeccionar**.
- [ ] Dirección · *Mi bandeja* muestra **"Devoluciones por resolver"** → decidir destino
      (regresa a venta o se da de baja).
- [ ] **Verificar:** el inventario refleja exactamente esa decisión.

### 8. Cierre y conciliación — Dirección
- [ ] *Control de inventario*: sin diferencias.
- [ ] *Cierre de caja* (si hubo efectivo): el esperado coincide con lo contado.
- [ ] *Finanzas*: la venta y el cobro del piloto aparecen con los montos correctos.
- [ ] *Mi bandeja* de cada rol: no queda nada que nadie sepa explicar.
- [ ] *Mensajes al cliente*: cada paso del pedido dejó su aviso.

## Compuertas: lo que NO se prueba en este piloto

| Qué | Por qué espera | Quién lo destraba |
|---|---|---|
| Envío de correos al cliente | Falta contratar el servicio de correo y verificar el dominio remitente | Renovacell |
| Guía de paquetería (DHL) | Falta la cuenta de producción de DHL | Renovacell |
| Cobro con tarjeta (Stripe) | Faltan las llaves de producción de Stripe | Renovacell |
| Factura (CFDI) | Falta la clasificación fiscal del catálogo y verificar el folio histórico en Facturama | Contador y Renovacell |
| Mensajes por WhatsApp | Faltan los activos de Meta | Renovacell |

Mientras una compuerta esté cerrada, su botón responde que el módulo no está activado.
**No intentar rodearlo**: la entrega con chofer propio y el cobro por transferencia
cubren el piloto completo.

## Cuándo detener el piloto

- La cantidad en almacén no coincide con lo recibido menos lo surtido.
- Un pedido aparece como cobrado sin que nadie haya registrado el cobro.
- Un aviso dice que algo salió bien y al recargar la página no es cierto.
- *Control de inventario* reporta una diferencia.

En cualquiera de esos casos: **no seguir operando**, anotar el folio y la hora, y avisar.
