// Add-ons del paquete (propuesta: "Módulos adicionales — fuera del paquete base,
// se cotizan por separado"). Se activan según lo que el cliente haya contratado.
//
//  - comunicacionInterna ($18k): habilita la VISTA COMÚN (anuncios/avisos/biblioteca)
//    como home del staff, y el rol "Comunicación" que la gestiona.
//  - chofer ($12k): habilita el módulo "Chofer / Seguimiento" y el rol Chofer.
//
// En el PAQUETE BASE ambos serían `false` (el hub base es neutro: "una base,
// varias puertas"). Aquí, en dev, los dejamos activos para previsualizar.
// Más adelante esto puede venir de la configuración de la organización (Supabase).
export interface Features {
  comunicacionInterna: boolean
  chofer: boolean
}

export const FEATURES: Features = {
  comunicacionInterna: true,
  chofer: true,
}
