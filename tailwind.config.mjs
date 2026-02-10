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
          DEFAULT: '#0a0a0f',
          subtle: '#12121a',
          muted: '#1a1a24',
        },
        line: {
          DEFAULT: '#30303d',
          subtle: '#252530',
        },
        content: {
          DEFAULT: '#f5f5f7',
          muted: '#9ca3af',
          subtle: '#6b7280',
        },
        accent: {
          DEFAULT: '#f59e0b',
          secondary: '#8b5cf6',
          muted: '#d97706',
          subtle: '#92400e',
        },
        success: '#10b981',
        warning: '#f59e0b',
      },
    },
  },
  plugins: [],
};
