# Checklist de seguridad — GO-LIVE (bloqueante)

> Estas casillas son **bloqueo obligatorio** antes de operar Renovacell en producción.
> El código ya no embarca contraseñas demo en el bundle (P0-C, `data/mock/accounts.ts`
> gateado por `import.meta.env.PROD`), pero **las cuentas creadas en Supabase Auth siguen
> usando la contraseña demo compartida hasta que se cambie manualmente**. Esto no se puede
> hacer desde el repo: es una acción en el panel de Supabase / con la service role.

## Contraseñas y cuentas (P0-C — acción manual del cliente)

- [ ] **Cambiar la contraseña de TODAS las cuentas demo** existentes en Supabase Auth
      (`direccion@`, `almacen@`, `ventas1@`, `ventas2@`, `chofer@`, `chofer2@`,
      `laura.mendez@`, `mario.ruiz@` y cualquier otra sembrada en pruebas).
- [ ] **Verificar que la(s) contraseña(s) demo ya no autentican ninguna cuenta.**
      Prueba: intentar iniciar sesión con la contraseña demo debe fallar en las 8 cuentas.
- [ ] **Probar la recuperación de contraseña** (flujo real de Supabase Auth: correo →
      enlace → nueva contraseña) end-to-end con al menos una cuenta.
- [ ] **Verificar cuentas y roles del personal real**: que cada persona real tenga su
      propia cuenta con el `role_id` correcto en `profiles`, y eliminar/deshabilitar las
      cuentas demo que no correspondan a una persona real.
- [ ] **Revocar sesiones activas** de las cuentas demo si aplica (Supabase Auth →
      "sign out all sessions" / invalidar refresh tokens) para cortar accesos abiertos.

## Verificación de que el bundle está limpio (P0-C — ya hecho en código)

- [x] `MOCK_ACCOUNTS` gateado por `import.meta.env.PROD` (vacío en `vite build`).
- [ ] Confirmar tras el build de release: `grep -R "@renovacell.mx\|password" apps/web/dist` (más el valor demo que se haya usado)
      no debe devolver correos de staff ni contraseñas demo.

## Precios (P0-A / P0-B — ya corregido en código; requiere deploy del backend)

- [ ] **Desplegar la migración `20260915120000_p0_precio_servidor.sql`** (`supabase db push`)
      **junto con** el nuevo cliente. Su self-test aborta el deploy si el precio no lo
      calcula la BD.
- [ ] **Importante — orden de deploy**: la migración endurece la RLS (el doctor ya no puede
      insertar `orders` directo). Debe desplegarse **al mismo tiempo o después** del nuevo
      cliente que usa el RPC `crear_pedido`; si se aplica antes, el cliente viejo (insert
      directo) dejaría de poder crear pedidos de doctor.
- [ ] Verificar en producción: un pedido de doctor guarda el **total calculado por el
      servidor**, no el enviado por el navegador (ver informe P0-A).

## Integraciones (recordatorio — no es P0 de seguridad de este lote)

- [ ] Cargar los secretos server-side (Stripe, Facturama, paquetería, Anthropic, Meta,
      Nubarium) como Supabase Function Secrets antes de habilitar cada cobro/flujo real.
