/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070708',
        bgsoft: '#101014',
        surface: '#16161c',
        card: '#f4f4f5',
        ink: '#16161b',
        inksoft: '#8b8b93',
        accent: '#ff6a3d',
        hi: '#5ad19a',
        higreen: '#149a64',
        glow: '#a78bfa',
      },
      borderRadius: {
        card: '28px',
        panel: '20px',
        ctrl: '14px',
        pill: '999px',
      },
      fontFamily: {
        sans: ['"JetBrainsMonoNL Nerd Font"', '"JetBrainsMono Nerd Font"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'PingFang SC', 'Microsoft YaHei', 'monospace'],
        mono: ['"JetBrainsMonoNL Nerd Font"', '"JetBrainsMono Nerd Font"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'PingFang SC', 'Microsoft YaHei', 'monospace'],
        matrix: ['"JetBrainsMonoNL Nerd Font"', '"JetBrainsMono Nerd Font"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 24px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)',
        float: '0 12px 40px rgba(0,0,0,.45)',
        play: '0 8px 32px rgba(255,106,61,.45)',
        inner: 'inset 0 1px 0 rgba(255,255,255,.06)',
      },
      animation: {
        'pulse-soft': 'pulse-soft 3s ease-in-out infinite',
        'ambient': 'ambient 8s ease-in-out infinite',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.04)' },
        },
        ambient: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(2%, -1%) scale(1.05)' },
        },
      },
    },
  },
  plugins: [],
};
