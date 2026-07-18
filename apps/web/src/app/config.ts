// Add-ons del paquete (propuesta: "Módulos adicionales — fuera del paquete base,
// se cotizan por separado"). Se activan según lo que el cliente haya contratado.
//
//  - comunicacionInterna ($18k): habilita la VISTA COMÚN (anuncios/avisos/biblioteca)
//    como home del staff (anuncios/avisos/biblioteca + chat). La gestiona Administración.
//  - chofer ($12k): habilita el módulo "Chofer / Seguimiento" y el rol Chofer.
//
// En el PAQUETE BASE ambos serían `false` (el hub base es neutro: "una base,
// varias puertas"). Aquí, en dev, los dejamos activos para previsualizar.
// Más adelante esto puede venir de la configuración de la organización (Supabase).
export interface Features {
  comunicacionInterna: boolean
  chofer: boolean
}

// Se configuran por VARIABLE DE ENTORNO, para poder entregar el paquete base sin
// los add-ons SIN recompilar ni tocar código:
//   VITE_FEATURE_COMUNICACION=false   apaga la Vista Común y el Chat
//   VITE_FEATURE_CHOFER=false         apaga el módulo y el rol Chofer
// Por defecto quedan ENCENDIDOS (comportamiento actual). Para una entrega del
// paquete base, ponerlos en 'false' en las variables del despliegue.
const flag = (v: string | undefined, fallback: boolean): boolean =>
  v == null || v === '' ? fallback : v !== 'false' && v !== '0'

export const FEATURES: Features = {
  comunicacionInterna: flag(import.meta.env?.VITE_FEATURE_COMUNICACION as string | undefined, true),
  chofer: flag(import.meta.env?.VITE_FEATURE_CHOFER as string | undefined, true),
}
