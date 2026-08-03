import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Los plugins son repos hermanos. En producción resuelve el workspace
    // dependency; durante el test apuntamos a su fuente sin publicar primero.
    alias: {
      '@coongro/openrouter/server': fileURLToPath(
        new URL('../openrouter/src/server.ts', import.meta.url)
      ),
    },
  },
});
