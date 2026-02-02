/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#09090b',
          subtle: '#18181b',
          muted: '#27272a',
        },
        line: {
          DEFAULT: '#3f3f46',
          subtle: '#27272a',
        },
        content: {
          DEFAULT: '#fafafa',
          muted: '#a1a1aa',
          subtle: '#71717a',
        },
        accent: {
          DEFAULT: '#22d3ee',
          muted: '#0891b2',
          subtle: '#164e63',
        },
        success: '#22c55e',
        warning: '#eab308',
      },
    },
  },
  plugins: [],
};
