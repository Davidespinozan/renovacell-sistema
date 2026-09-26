// Catálogo SAT c_UsoCFDI (CFDI 4.0). La UI guarda el código; el backend lo pasa directo a
// Facturama. `tipo` restringe qué persona puede usarlo (D0x = deducciones personales, solo
// persona física). Facturama es la validación fiscal final; esto solo evita usos imposibles.
export interface UsoCfdi { codigo: string; nombre: string; tipo: 'fisica' | 'moral' | 'ambos' }

export const USOS_CFDI_SAT: UsoCfdi[] = [
  { codigo: 'G01', nombre: 'Adquisición de mercancías', tipo: 'ambos' },
  { codigo: 'G02', nombre: 'Devoluciones, descuentos o bonificaciones', tipo: 'ambos' },
  { codigo: 'G03', nombre: 'Gastos en general', tipo: 'ambos' },
  { codigo: 'I01', nombre: 'Construcciones', tipo: 'ambos' },
  { codigo: 'I02', nombre: 'Mobiliario y equipo de oficina por inversiones', tipo: 'ambos' },
  { codigo: 'I04', nombre: 'Equipo de cómputo y accesorios', tipo: 'ambos' },
  { codigo: 'I08', nombre: 'Otra maquinaria y equipo', tipo: 'ambos' },
  { codigo: 'D01', nombre: 'Honorarios médicos, dentales y gastos hospitalarios', tipo: 'fisica' },
  { codigo: 'D02', nombre: 'Gastos médicos por incapacidad o discapacidad', tipo: 'fisica' },
  { codigo: 'D07', nombre: 'Primas por seguros de gastos médicos', tipo: 'fisica' },
  { codigo: 'P01', nombre: 'Por definir', tipo: 'ambos' },
  { codigo: 'S01', nombre: 'Sin efectos fiscales', tipo: 'ambos' },
  { codigo: 'CP01', nombre: 'Pagos', tipo: 'ambos' },
]

export const USOS_CFDI_OPTIONS = USOS_CFDI_SAT.map((u) => ({ value: u.codigo, label: `${u.codigo} — ${u.nombre}` }))

const CODIGOS = new Set(USOS_CFDI_SAT.map((u) => u.codigo))
export const esUsoCfdiValido = (v: string | null | undefined): boolean => !!v && CODIGOS.has(v)
export const nombreUsoCfdi = (codigo: string | null | undefined): string =>
  USOS_CFDI_SAT.find((u) => u.codigo === codigo)?.nombre ?? ''
