#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// mock-provider — a tiny stand-in Pexels API for the flag-on
// stock-video e2e (v0.15 R6).
//
// CI has no real provider keys, so the acceptance suite points
// PEXELS_API_BASE here: it answers the documented /videos/search
// shape (Authorization header enforced — the key path is part of
// the assertion) and serves real, ffmpeg-generated mp4 renditions
// so the full insert path runs: browser download (CORS *) →
// chunked media store → poster probe → VideoElement.credit.
//
// Zero dependencies: node:http + node:fs/promises only.
// ─────────────────────────────────────────────────────────────

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = Number(process.env.MOCK_PORT ?? 3210)
const API_KEY = process.env.MOCK_KEY ?? 'ci-stock-video-key'
const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', 'fixtures', 'videos')

const SEARCH_RESPONSE = {
  url: 'http://127.0.0.1:3210/videos/search?query=ocean',
  page: 1,
  per_page: 24,
  videos: [
    {
      id: 4242,
      width: 1280,
      height: 720,
      url: 'https://www.pexels.com/video/mock-ocean-4242/',
      image: `http://127.0.0.1:${PORT}/stock-preview.jpg`,
      duration: 1,
      user: { id: 1, name: 'Mock Creator', url: 'https://www.pexels.com/@mock-creator-1/' },
      video_files: [
        {
          id: 1,
          quality: 'hd',
          file_type: 'video/mp4',
          width: 1280,
          height: 720,
          fps: 24,
          link: `http://127.0.0.1:${PORT}/stock-720.mp4`,
        },
        {
          id: 2,
          quality: 'sd',
          file_type: 'video/mp4',
          width: 640,
          height: 360,
          fps: 24,
          link: `http://127.0.0.1:${PORT}/stock-360.mp4`,
        },
      ],
      video_pictures: [{ id: 1, nr: 0, picture: `http://127.0.0.1:${PORT}/stock-preview.jpg` }],
    },
  ],
}

const MIME = {
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  try {
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain', ...cors })
      res.end('ok')
      return
    }

    if (url.pathname === '/videos/search') {
      // the auth path is part of the contract under test
      if (req.headers.authorization !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: 'Invalid API key.' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors })
      res.end(JSON.stringify(SEARCH_RESPONSE))
      return
    }

    const file = ['/stock-720.mp4', '/stock-360.mp4', '/stock-preview.jpg'].find((f) => f === url.pathname)
    if (file) {
      const bytes = await readFile(join(FIXTURES, file.slice(1)))
      res.writeHead(200, {
        'Content-Type': MIME[file.slice(file.lastIndexOf('.'))],
        'Content-Length': String(bytes.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...cors,
      })
      res.end(bytes)
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain', ...cors })
    res.end('not found')
  } catch (err) {
    console.error('[mock-provider]', err)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('mock provider error')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock stock provider on http://127.0.0.1:${PORT}`)
})
