import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/workers/index.ts'],
  format: 'esm',
  dts: true,
  // Bundle @two-cents/shared — it exports raw .ts which Node can't load at runtime.
  noExternal: ['@two-cents/shared'],
});
