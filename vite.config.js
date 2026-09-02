import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 5173,
    // Mini Apps load over HTTPS inside the Nimiq Pay WebView.
    // Use a tunnel (ngrok, cloudflared) pointing at this port for on-device testing.
    host: true
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Vite only bundles index.html by default — landing.html needs to
      // be listed explicitly or it's silently dropped from the production
      // build (works in `npm run dev`, 404s once deployed).
input: {
  app: resolve(__dirname, 'index.html'),
  landing: resolve(__dirname, 'landing.html')
}
    }
  }
})
