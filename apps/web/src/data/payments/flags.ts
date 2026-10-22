// Banderas LOCALES de la integración de pagos con tarjeta (CyberSource / BanBajío).
// CS-1A.3 · Microform en el portal del doctor: APAGADO por defecto. Solo se enciende con VITE_CS_MICROFORM=on en el build
// (nunca desde el navegador ni desde el servidor). Con la bandera apagada, PaymentModal se comporta exactamente como antes.
export const CS_MICROFORM_HABILITADO: boolean = String(import.meta.env.VITE_CS_MICROFORM ?? '').trim().toLowerCase() === 'on'
