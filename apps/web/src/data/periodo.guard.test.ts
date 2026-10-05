// W5 · GUARDA DE REGRESIÓN TEMPORAL. Ningún reporte vuelve a:
//   · cortar por UTC             (`toISOString().slice(0, 10)` y variantes);
//   · usar el reloj del dispositivo (`getMonth()`, `getDate()`, `getFullYear()`, `getDay()`);
//   · llamar "mes"/"día" a una ventana móvil de milisegundos.
// La única puerta es `data/periodo.ts`. Si hace falta una excepción, se declara aquí
// con su motivo, no se silencia en el archivo.
import { describe, it, expect } from 'vitest'

// Todo el código fuente de la app (sin pruebas, tipos generados ni semillas de demo).
const todo = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx', '!../**/*.d.ts', '!./database.types.ts', '!./mock/**'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// Ruta relativa a src/: '../app/x.tsx' → 'app/x.tsx'; los de esta carpeta llegan como './x.ts' → 'data/x.ts'.
const fuentes = Object.fromEntries(Object.entries(todo).map(([k, v]) => [k.startsWith('../') ? k.slice(3) : 'data/' + k.slice(2), v]))
const leer = (r: string): string => {
  const s = fuentes[r]
  if (s == null) throw new Error(`no existe ${r}`)
  return s
}

// Excepciones DECLARADAS (ruta → motivo). Nada más puede usar estos patrones.
const EXCEPCIONES_DISPOSITIVO: Record<string, string> = {
  'data/periodo.ts': 'es la implementación del reloj del negocio',
  'lib/format.ts': 'formatea una fecha SIN hora (AAAA-MM-DD) como fecha local para mostrarla; no corta periodos',
  'lib/exportCsv.ts': 'nombre del archivo exportado (sello de descarga), no una cifra',
  'lib/exportData.ts': 'nombre del archivo exportado (sello de descarga), no una cifra',
  'screens/Calendario.tsx': 'calendario de agenda interna del equipo (cita del día del dispositivo), no un reporte',
  'data/shipping/provider.ts': 'cálculo de ETA del proveedor de paquetería, no un reporte',
}

describe('guarda temporal: nadie corta periodos fuera de data/periodo.ts', () => {
  it('ningún archivo corta el día por UTC', () => {
    const malos = Object.entries(fuentes).filter(([r, s]) => {
      if (r === 'data/periodo.ts') return false
      return /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*(10|7)\s*\)/.test(s) || /toISOString\(\)\.split\('T'\)\[0\]/.test(s)
    }).map(([r]) => r)
    expect(malos).toEqual([])
  })
  it('ningún reporte usa partes de calendario del reloj del dispositivo', () => {
    const malos = Object.entries(fuentes).filter(([r, s]) => {
      if (r in EXCEPCIONES_DISPOSITIVO) return false
      return /\.(getMonth|getDate|getFullYear|getDay|getHours)\(\)/.test(s) || /\bsetHours\(/.test(s)
    }).map(([r]) => r)
    expect(malos).toEqual([])
  })
  it('las excepciones declaradas siguen existiendo (si una desaparece, se retira de la lista)', () => {
    const faltan = Object.keys(EXCEPCIONES_DISPOSITIVO).filter((r) => !(r in fuentes))
    expect(faltan).toEqual([])
  })
  it('las pantallas de reportes no usan ventanas móviles de milisegundos para "mes" o "día"', () => {
    const reportes = ['screens/admin/Tablero.tsx', 'screens/admin/Ventas.tsx', 'screens/admin/VentasDetalle.tsx',
      'screens/admin/Finanzas.tsx', 'screens/admin/Comisiones.tsx', 'screens/admin/Mermas.tsx', 'screens/admin/Facturacion.tsx',
      'data/metrics.ts', 'data/kpis.ts', 'data/comisiones.ts', 'data/ops/finanzas.ts']
    const malos = reportes.filter((r) => /86_?400_?000|864e5|24 \* 60 \* 60 \* 1000/.test(leer(r)))
    expect(malos).toEqual([])
  })
  it('las pantallas de reportes importan el reloj del negocio', () => {
    const reportes = ['screens/admin/Tablero.tsx', 'screens/admin/Ventas.tsx', 'screens/admin/VentasDetalle.tsx',
      'screens/admin/Finanzas.tsx', 'screens/admin/Comisiones.tsx', 'screens/admin/Mermas.tsx']
    const sin = reportes.filter((r) => !/from '(\.\.\/)+data\/periodo'/.test(leer(r)))
    expect(sin).toEqual([])
  })
  it('ninguna pantalla vuelve a sumar dinero cobrado o utilidad por su cuenta', () => {
    const prohibidos = [/payment_status === 'paid'\s*\?\s*o\.total/, /\bestadoResultados\b/, /\bcobranza\(/, /\bbillingSummary\b/, /\bcuentasPorCobrar\b/]
    const malos = Object.entries(fuentes).filter(([r, s]) => r.startsWith('screens/') && prohibidos.some((re) => re.test(s))).map(([r]) => r)
    expect(malos).toEqual([])
  })
})
