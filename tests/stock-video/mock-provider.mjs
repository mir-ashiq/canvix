#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// mock-provider — a tiny stand-in Pexels API for the flag-on
// stock e2e (v0.15 R6 videos, v0.16.4 A4 photos).
//
// CI has no real provider keys, so the acceptance suite points
// PEXELS_API_BASE here: it answers the documented /videos/search
// AND /v1/search (photos) shapes (Authorization header enforced —
// the key path is part of the assertion) and serves real,
// ffmpeg-generated renditions/files so the full insert path runs:
// browser download (CORS *) → chunked media store → poster/dims
// probe → VideoElement/ImageElement credit.
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

// v0.16.4 (A4): the documented Pexels PHOTO search shape — the
// stock-photo connector's parsing oracle (all src variants point at
// the one fixture JPEG; large2x is the expected primary)
const PHOTO_SEARCH_RESPONSE = {
  total_results: 1,
  page: 1,
  per_page: 24,
  photos: [
    {
      id: 77007,
      width: 1600,
      height: 900,
      url: 'https://www.pexels.com/photo/mock-stock-photo-77007/',
      photographer: 'Mock Photographer',
      photographer_url: 'https://www.pexels.com/@mock-photographer/',
      photographer_id: 90210,
      avg_color: '#2D6A4F',
      alt: 'a mock stock photo',
      src: {
        original: `http://127.0.0.1:${PORT}/stock-photo.jpg`,
        large2x: `http://127.0.0.1:${PORT}/stock-photo.jpg`,
        large: `http://127.0.0.1:${PORT}/stock-photo.jpg`,
        medium: `http://127.0.0.1:${PORT}/stock-photo.jpg`,
        small: `http://127.0.0.1:${PORT}/stock-photo.jpg`,
      },
      liked: false,
    },
  ],
}

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

    // v0.16.4 (A4): the PHOTO search path (same auth contract)
    if (url.pathname === '/v1/search') {
      if (req.headers.authorization !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: 'Invalid API key.' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors })
      res.end(JSON.stringify(PHOTO_SEARCH_RESPONSE))
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

    // v0.16.4 (A4): stock-photo.jpg — the photo insert fixture
    const file = ['/stock-720.mp4', '/stock-360.mp4', '/stock-preview.jpg', '/stock-photo.jpg'].find((f) => f === url.pathname)
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
