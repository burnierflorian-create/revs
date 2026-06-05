/** @type {import('tailwindcss').Config} */
// Colour tokens resolve through the CSS channel-triplet vars in
// src/styles/design-system.css so they flip with the html.light class.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Wired to the CSS channel-triplet vars in design-system.css so
        // every bg-bg / bg-card / text-fg / text-fg2 / text-accent (and
        // their /opacity modifiers) flip with the html.light class.
        // The <alpha-value> placeholder keeps text-fg/45 working.
        bg:     'rgb(var(--color-bg) / <alpha-value>)',     // fond principal
        card:   'rgb(var(--color-card) / <alpha-value>)',   // surface card
        fg:     'rgb(var(--color-fg) / <alpha-value>)',     // texte principal
        fg2:    'rgb(var(--color-fg-2) / <alpha-value>)',   // texte secondaire
        accent: 'rgb(var(--color-accent) / <alpha-value>)', // rouge REVS
      },
      borderColor: {
        // border-border / border-divider flip via the CSS vars; the
        // DEFAULT/subtle aliases stay as fixed rgba (dark hairlines).
        DEFAULT: 'var(--color-divider)', // séparateur standard
        subtle:  'var(--color-border)',  // bordure card
        border:  'var(--color-border)',
        divider: 'var(--color-divider)',
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
