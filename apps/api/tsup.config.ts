import { defineConfig } from 'tsup';

export default defineConfig({
  // seed.js is shipped so production images can bootstrap the first Super Admin without dev tooling
  entry: { server: 'src/server.ts', seed: 'prisma/seed.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // keep native / large deps external; they are installed in the runtime image
  skipNodeModulesBundle: true,
});
