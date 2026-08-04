// Número a letras en español de México, para comprobantes (recibos, cortes de caja).
// Devuelve la cantidad como texto en MAYÚSCULAS con formato fiscal mexicano:
//   montoEnLetras(1200)     → "MIL DOSCIENTOS PESOS 00/100 M.N."
//   montoEnLetras(21.5)     → "VEINTIÚN PESOS 50/100 M.N."
//   montoEnLetras(1)        → "UN PESO 00/100 M.N."
// Módulo PURO (sin DOM), portable. Maneja apócope (un/veintiún/cien) y el plural
// de "millón/millones". Tope práctico: hasta 999,999,999.99 (suficiente para caja).

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
const ESPECIALES: Record<number, string> = {
  10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
  16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
  20: 'VEINTE', 21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
  25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
}
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

// 0..999 en letras. `apocope` convierte el "UNO" final en "UN" (para "UN MIL", "VEINTIÚN PESOS").
function centenasEnLetras(n: number, apocope: boolean): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  let out = ''
  const c = Math.floor(n / 100)
  const resto = n % 100
  if (c > 0) out += CENTENAS[c]
  if (resto > 0) {
    if (out) out += ' '
    if (resto < 10) out += UNIDADES[resto]
    else if (ESPECIALES[resto]) out += ESPECIALES[resto]
    else {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      out += DECENAS[d] + (u > 0 ? ' Y ' + UNIDADES[u] : '')
    }
  }
  // Apócope: "UNO" → "UN", "VEINTIUNO" → "VEINTIÚN"
  if (apocope) out = out.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/\bUNO$/, 'UN')
  return out
}

// Entero (0..999,999,999) a letras.
function enteroEnLetras(n: number): string {
  if (n === 0) return 'CERO'
  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const cientos = n % 1000
  const partes: string[] = []
  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${centenasEnLetras(millones, true)} MILLONES`)
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${centenasEnLetras(miles, true)} MIL`)
  }
  if (cientos > 0) {
    partes.push(centenasEnLetras(cientos, false))
  }
  return partes.join(' ').trim()
}

// Monto (pesos, puede traer centavos) → texto fiscal. `moneda` por defecto PESOS/M.N.
export function montoEnLetras(monto: number, moneda = 'PESOS', sufijo = 'M.N.'): string {
  const abs = Math.abs(monto)
  const entero = Math.floor(abs)
  const centavos = Math.round((abs - entero) * 100)
  const signo = monto < 0 ? 'MENOS ' : ''
  const letras = enteroEnLetras(entero)
  // Apócope del último "UNO"/"VEINTIUNO" pegado a la unidad de moneda ("UN PESO").
  const letrasApoc = letras.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/\bUNO$/, 'UN')
  const unidad = entero === 1 ? moneda.replace(/S$/, '') : moneda // PESOS → PESO en singular
  const cc = String(centavos).padStart(2, '0')
  return `${signo}${letrasApoc} ${unidad} ${cc}/100 ${sufijo}`.replace(/\s+/g, ' ').trim()
}