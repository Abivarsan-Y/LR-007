import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['..'] } },
})
