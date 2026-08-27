import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Redirige las llamadas a /api hacia el backend.
    //
    // Sin esto el navegador bloquearia los pedidos: el frontend corre en el
    // puerto 5173 y el backend en el 3000, y son origenes distintos. El proxy
    // hace que para el navegador todo venga del mismo lugar, de modo que no
    // hace falta configurar CORS.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
