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
    },
  },
  plugins: [],
};
