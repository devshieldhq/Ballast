import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    // Mini Apps load over HTTPS inside the Nimiq Pay WebView.
    // Use a tunnel (ngrok, cloudflared) pointing at this port for on-device testing.
    host: true
  },
  build: {
    outDir: 'dist'
  }
})
