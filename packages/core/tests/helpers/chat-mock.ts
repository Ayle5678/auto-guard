/**
 * Local /chat/completions mock on an ephemeral 127.0.0.1 port. This is the
 * transport seam for reviewer tests: the reviewer talks real HTTP (one-shot
 * node:http agent, the crash-safety property under test), so stubbing global
 * `fetch` no longer intercepts anything.
 */
import { createServer, type Server, type ServerResponse } from 'node:http'

export interface CapturedRequest {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface ChatMock {
  apiBase: string
  requests: CapturedRequest[]
  respond(handler: (req: CapturedRequest, res: ServerResponse) => void): void
  close(): Promise<void>
}

export async function startChatMock(): Promise<ChatMock> {
  const requests: CapturedRequest[] = []
  let handler: (req: CapturedRequest, res: ServerResponse) => void = () => {}
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const captured: CapturedRequest = {
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(captured)
      handler(captured, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    apiBase: `http://127.0.0.1:${port}`,
    requests,
    respond: (h) => {
      handler = h
    },
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

/** Standard OpenAI-shaped 200 response wrapping a review content string. */
export function chatOk(content: string) {
  return (_req: CapturedRequest, res: ServerResponse) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  }
}
