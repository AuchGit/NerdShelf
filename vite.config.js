import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Custom port to avoid clashing with other Tauri/Vite projects also running on
// the default 5173. Keep in sync with `src-tauri/tauri.conf.json` → devUrl.
const DEV_PORT = 5283

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
})
