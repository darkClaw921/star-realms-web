/**
 * Custom Node server: Next and Socket.IO on one port, one process.
 *
 * The authoritative game state is a plain Map in this process, which is what
 * makes hidden information simple -- no Redis, no pub/sub, no split-brain, and
 * per-seat redaction is one line per socket.
 *
 * This file is NOT compiled by Next: no path aliases, no JSX. Run it with
 * `tsx watch server.ts` in development and an esbuild bundle in production.
 */
import { createServer } from 'node:http'
import next from 'next'
import { attachRealtime } from './src/server/realtime'
import { reap, stats } from './src/server/matchRegistry'

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? 'localhost'

async function main(): Promise<void> {
  const app = next({ dev, hostname, port })
  await app.prepare()
  const handler = app.getRequestHandler()

  // ORDER IS LOAD-BEARING: engine.io's attach() calls
  // removeAllListeners('request') and re-dispatches to whatever it cached, so
  // the Next handler must already be registered or every HTTP route 404s.
  const httpServer = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      console.error('request failed', err)
      res.statusCode = 500
      res.end('internal error')
    })
  })

  attachRealtime(httpServer)

  setInterval(() => {
    const n = reap()
    if (n > 0) console.log(`reaped ${n} abandoned match(es); ${stats().matches} live`)
  }, 15 * 60 * 1000).unref()

  httpServer.listen(port, () => {
    console.log(`\n  Star Realms — http://${hostname}:${port}`)
    console.log(`  realtime on ws://${hostname}:${port}/rt\n`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
