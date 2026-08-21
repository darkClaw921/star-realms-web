import type { NextConfig } from 'next'

const config: NextConfig = {
  // The engine and protocol are workspace TypeScript source, not built packages.
  transpilePackages: ['@sr/engine', '@sr/protocol'],
  // NOTE: deliberately NOT `output: 'standalone'`. This app runs behind a custom
  // server (server.ts) so that Socket.IO can share the port; standalone emits its
  // own conflicting server.js and does not trace custom server files.
  reactStrictMode: true,
  // The floating dev badge sits on top of the board and lands in screenshots.
  devIndicators: false,
}

export default config
