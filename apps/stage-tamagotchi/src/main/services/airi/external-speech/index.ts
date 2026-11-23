import type { IncomingMessage, ServerResponse } from 'node:http'

import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { useLogg } from '@guiiai/logg'
import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import { electronSpeechSpeakText } from '../../../../shared/eventa'

const DEFAULT_PORT = 8_765
const SPEAK_TIMEOUT_MS = 15_000

const log = useLogg('external-speech').useGlobalConfig()

export interface ExternalSpeechServer {
  port: number
  stop: () => Promise<void>
}

/** Reads the request body: JSON `{ "text": ... }` or plain text; a GET has no body. */
function readBody(req: IncomingMessage): Promise<string> {
  if (req.method === 'GET' || req.method === 'HEAD')
    return Promise.resolve('')

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve('')
        return
      }
      try {
        const parsed: unknown = JSON.parse(raw)
        resolve(typeof parsed === 'string' ? parsed : String((parsed as { text?: unknown }).text ?? ''))
      }
      catch {
        resolve(raw)
      }
    })
  })
}

function respond(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** An unanswered renderer call must not hold the connection forever. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`renderer did not answer within ${ms}ms`)), ms)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Local door for speaking from outside the app (fork feature, FUT-AIRISAYAPP): a process on this
 * machine asks AIRI to say a string, and the renderer answers through its own speech store, so
 * notifications leave with AIRI's voice instead of an external player.
 *
 *   GET  /health          -> { ok: true }
 *   GET  /speak?text=...  -> speaks the query
 *   POST /speak           -> speaks `{ "text": ... }` or a plain-text body
 *
 * Bound to 127.0.0.1: this is the desktop's own door, not a network API. The port is
 * `AIRI_EXTERNAL_SPEECH_PORT`, 8765 by default.
 */
export function setupExternalSpeechServer(params: { getMainWindow: () => BrowserWindow | undefined, port?: number }): ExternalSpeechServer {
  const port = params.port ?? Number(process.env.AIRI_EXTERNAL_SPEECH_PORT || DEFAULT_PORT)
  const contexts = new WeakMap<BrowserWindow, ReturnType<typeof createContext>['context']>()

  function contextFor(window: BrowserWindow) {
    let context = contexts.get(window)
    if (!context) {
      context = createContext(ipcMain, window).context
      contexts.set(window, context)
    }
    return context
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

    if (url.pathname === '/health') {
      respond(res, 200, { ok: true })
      return
    }
    if (url.pathname !== '/speak') {
      respond(res, 404, { ok: false, error: 'not-found' })
      return
    }

    const text = (url.searchParams.get('text') ?? await readBody(req)).trim()
    if (!text) {
      respond(res, 400, { ok: false, error: 'empty-text' })
      return
    }

    const window = params.getMainWindow()
    if (!window || window.isDestroyed()) {
      respond(res, 503, { ok: false, error: 'no-main-window' })
      return
    }

    try {
      await withTimeout(defineInvoke(contextFor(window), electronSpeechSpeakText)(text), SPEAK_TIMEOUT_MS)
      respond(res, 202, { ok: true })
    }
    catch (error) {
      log.withError(error).error('external speech request failed')
      respond(res, 500, { ok: false, error: `${error}` })
    }
  }

  const server = createServer((req, res) => void handle(req, res))
  server.on('error', error => log.withError(error).error(`external speech server is not listening on port ${port}`))
  server.listen({ host: '127.0.0.1', port })
  log.log(`external speech server listening on 127.0.0.1:${port}`)

  const stop = () => new Promise<void>(resolve => server.close(() => resolve()))
  app.once('before-quit', () => void stop())

  return { port, stop }
}
