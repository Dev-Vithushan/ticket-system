import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // keep native / large deps external; they are installed in the runtime image
  skipNodeModulesBundle: true,
});
