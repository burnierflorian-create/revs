/** @type {import('tailwindcss').Config} */
// Token values mirror src/styles/design-system.css (CSS variables).
// Kept as literal hex so Tailwind's /opacity modifiers keep working.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:     '#0A0A0A', // noir profond (légèrement nuancé, pas pur #000)
        card:   '#141414', // surface card
        fg:     '#FFFFFF', // texte principal
        fg2:    '#8A8A8A', // texte secondaire / labels
        accent: '#E8203A', // rouge accent — plus précis qu'avant
        // legacy alias — anciens spots du code utilisent fg/45 etc.
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.08)', // séparateur standard
        subtle:  'rgba(255,255,255,0.06)', // bordure card
      },
      fontFamily: {
        // Inter chargé via Google Fonts en HEAD ; SF Pro arrive via la
        // stack système Apple, fonts-display utilise Inter weight-800
        // pour les titres XL avec letter-spacing négatif.
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'sans-serif'],
        display: ['"SF Pro Display"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tightest: '-0.5px',
        tighter:  '-0.3px',
        wider:    '0.5px',
      },
      borderRadius: {
        '4xl': '24px',
      },
      boxShadow: {
        // Subtile, comme iOS — pas de gros drop shadow.
        card:  '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.4)',
        soft:  '0 6px 18px rgba(0,0,0,0.45)',
        glow:  '0 0 24px rgba(232,32,58,0.25)',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-soft': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },
  plugins: [],
}
