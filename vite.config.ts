import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    base: demo ? '/agent-replay/' : '/',
    build: { outDir: demo ? 'dist-demo' : 'dist' },
    plugins: [react(), tailwindcss()],
  }
})
