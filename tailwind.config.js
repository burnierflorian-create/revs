/** @type {import('tailwindcss').Config} */
// Token values mirror src/styles/design-system.css (CSS variables).
// Kept as literal hex so Tailwind's /opacity modifiers keep working.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0A', // noir profond
        fg: '#F5F5F0', // blanc cassé
        accent: '#E63946', // rouge accent
        card: '#1A1A1A', // gris carte
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
