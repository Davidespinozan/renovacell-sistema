// Preset de Tailwind con los tokens de marca Renovacell.
// Lo consumen apps/web y apps/landing vía `presets: [require('@renovacell/ui/tailwind-preset.cjs')]`.
// Mantener sincronizado con tokens.css.
module.exports = {
  theme: {
    extend: {
      colors: {
        green: { DEFAULT: '#007311', soft: '#5FB873', deep: '#00590D' },
        carbon: '#23271F',
        hueso: '#F9FAF8',
        ink: { DEFAULT: '#0A0C08', 2: '#252921', 3: '#3D4238' },
        mid: '#747D6C',
        line: '#E7E9E3',
        warn: { DEFAULT: '#B5730E', bg: '#FBF1E0' },
        danger: { DEFAULT: '#B23A33', bg: '#FBECEA' },
        ok: { DEFAULT: '#007311', bg: '#E7F3E9' },
        brandblue: { DEFAULT: '#2C6E8F', bg: '#E7F0F4' }
      },
      borderRadius: { sm: '10px', DEFAULT: '14px', lg: '20px', pill: '999px' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Special Gothic Expanded One"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      }
    }
  }
}
