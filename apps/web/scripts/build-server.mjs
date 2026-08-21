// Bundle server.ts for production. Next does not compile the custom server, and
// `output: 'standalone'` cannot be used alongside one, so we bundle it ourselves.
import { build } from 'esbuild'

await build({
  entryPoints: ['server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Next and its native deps must stay external; everything in the workspace
  // (the engine, the protocol) is bundled in.
  packages: 'external',
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
