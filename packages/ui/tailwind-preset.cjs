// Preset de Tailwind con los tokens de marca Renovacell.
// Lo consumen apps/web y apps/landing vía `presets: [require('@renovacell/ui/tailwind-preset.cjs')]`.
// Mantener sincronizado con tokens.css.
module.exports = {
  theme: {
    extend: {
      colors: {
        green: { DEFAULT: '#007311', soft: '#5FB873', deep: '#00590D' },
        carbon: '#23271F',
        hueso: '#f4f6f9',
        ink: { DEFAULT: '#0b1220', 2: '#0b1220', 3: '#5b6472' },
        mid: '#8a94a3',
        line: '#e6eaf0',
        accent: '#007311',
        warn: { DEFAULT: '#b45309', bg: '#fffbeb', line: '#fef3c7' },
        danger: { DEFAULT: '#b91c1c', bg: '#fef2f2', line: '#fee2e2', solid: '#dc2626' },
        ok: { DEFAULT: '#007311', bg: '#E7F3E9', line: '#C9E4CF' },
        brandblue: { DEFAULT: '#1d4ed8', bg: '#eff6ff', line: '#dbeafe' }
      },
      borderRadius: { sm: '12px', DEFAULT: '14px', lg: '20px', xl: '28px', pill: '999px' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Special Gothic Expanded One"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      }
    }
  }
}
