import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
function cesiumRuntime() {
  const source = join(frontendRoot, 'node_modules/cesium/Build/Cesium')
  const destination = join(frontendRoot, 'public/cesium')
  mkdirSync(destination, { recursive: true })
  for (const folder of ['Assets', 'Widgets', 'Workers', 'ThirdParty']) cpSync(join(source, folder), join(destination, folder), { recursive: true })
}


export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  plugins: [react(), tailwindcss(), { name: 'cesium-runtime', buildStart: cesiumRuntime }],
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
