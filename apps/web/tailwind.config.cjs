// Usa el preset compartido de @renovacell/ui (tokens de marca del prototipo).
// Requiere `npm install` en la raíz para que el workspace resuelva el paquete.
module.exports = {
  presets: [require('@renovacell/ui/tailwind-preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  // El shell usa el CSS del demo (styles/shell.css) con su propio reset.
  // Desactivamos preflight para no duplicar/chocar resets y respetar el demo.
  corePlugins: { preflight: false },
  theme: {
    extend: {}
  },
  plugins: []
}
