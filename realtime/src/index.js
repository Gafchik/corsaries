import http from 'http'
import express from 'express'
import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { Encoder } from '@colyseus/schema'
import { WorldRoom } from './rooms/WorldRoom.js'

// Default buffer is 8KB — comfortably too small once ~100 bots plus a full
// island layout are all in the same room's encoded state. Under-sized just
// silently drops/corrupts whatever didn't fit rather than erroring loudly,
// which is a worse failure mode than the one-line fix the library itself
// logs on every single overflow.
Encoder.BUFFER_SIZE = 128 * 1024

const port = Number(process.env.PORT ?? 2567)

const app = express()
app.use(express.json())

// Matchmaker stub (architecture DECK 07): today this always resolves to the
// single "main" world, but every client already goes through this endpoint
// instead of hardcoding a room address — adding real regions/servers later
// is a change here, not a client rewrite.
app.get('/matchmake/world', (req, res) => {
  res.json({ roomName: 'world', serverId: 'main' })
})

const server = http.createServer(app)
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
})

gameServer.define('world', WorldRoom)

gameServer.listen(port)
console.log(`Corsaries realtime server listening on :${port}`)
