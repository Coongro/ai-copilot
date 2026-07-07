import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Auto-discovery: todos los src/schema/*.ts menos el barrel index.ts.
  schema: './src/schema/!(index).ts',
  out: './drizzle',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
});
