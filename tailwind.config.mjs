import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Theme colors are handled via CSS variables in global.css
        // Only keeping these for Tailwind utilities that don't need theming
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-brand': 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 50%, #d946ef 100%)',
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(0, 212, 255, 0.3)',
        'glow-secondary': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-accent': '0 0 20px rgba(217, 70, 239, 0.3)',
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'var(--color-foreground)',
            a: {
              color: 'var(--color-primary)',
              '&:hover': { color: 'var(--color-primary-hover)' },
            },
            strong: { color: 'var(--color-foreground)' },
            h1: { color: 'var(--color-foreground)' },
            h2: { color: 'var(--color-foreground)' },
            h3: { color: 'var(--color-foreground)' },
            h4: { color: 'var(--color-foreground)' },
            blockquote: {
              color: 'var(--color-foreground-muted)',
              borderLeftColor: 'var(--color-primary)',
            },
            code: {
              color: 'var(--color-primary)',
              backgroundColor: 'var(--color-primary-bg)',
              borderRadius: '0.25rem',
              padding: '0.15rem 0.35rem',
              fontWeight: '400',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            pre: {
              backgroundColor: 'var(--color-background-light)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
            },
            hr: { borderColor: 'var(--color-border)' },
            'ol > li::marker': { color: 'var(--color-foreground-muted)' },
            'ul > li::marker': { color: 'var(--color-foreground-muted)' },
            thead: { borderBottomColor: 'var(--color-border)' },
            'tbody tr': { borderBottomColor: 'var(--color-border)' },
            th: { color: 'var(--color-foreground)' },
            td: { color: 'var(--color-foreground)' },
          },
        },
      },
    },
  },
  plugins: [typography],
};
