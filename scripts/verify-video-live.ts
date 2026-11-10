// E2E: the AI video route against the live provider (dev machine only).
// 1) capabilities says videoGeneration:true
// 2) POST a short prompt → task id
// 3) poll until done (bounded)
// 4) fetch the MP4 through the same-origin proxy → magic bytes + size
import { request } from 'playwright'

const BASE = 'http://localhost:3000'

async function main() {
  const r = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE, referer: `${BASE}/` } })

  const caps = await (await r.get('/api/ai/capabilities')).json()
  console.log('videoGeneration:', caps.capabilities.videoGeneration)
  if (!caps.capabilities.videoGeneration) {
    console.log('NOT LIVE — provider not configured')
    process.exit(1)
  }

  const t0 = Date.now()
  const start = await r.post('/api/ai/video', { data: { prompt: 'A red paper boat drifting across calm water, gentle ripples, soft morning light, 3 seconds', duration: 3 } })
  console.log('POST status:', start.status())
  const body = await start.json()
  console.log('POST body:', JSON.stringify(body).slice(0, 300))
  if (start.status() >= 300) process.exit(1)
  const id = body.id ?? body.taskId ?? body.data?.id
  if (!id) {
    console.log('no task id — abort')
    process.exit(1)
  }

  // poll (bounded ~8 min)
  let done: any = null
  for (let i = 0; i < 96; i++) {
    await new Promise((res) => setTimeout(res, 5000))
    const st: any = await (await r.get(`/api/ai/video?id=${encodeURIComponent(id)}`)).json()
    const s = JSON.stringify(st)
    console.log(`poll ${i + 1}: ${s.slice(0, 160)}`)
    if (st.status === 'succeeded' || st.status === 'completed' || st.status === 'failed' || st.status === 'error') {
      done = st
      break
    }
  }
  if (!done) {
    console.log('TIMEOUT waiting for the generation')
    process.exit(1)
  }
  if (done.status !== 'succeeded' && done.status !== 'completed') {
    console.log('generation ended in', done.status)
    process.exit(1)
  }
  const videoUrl = done.videos?.[0]?.url ?? done.video?.url ?? done.url
  if (!videoUrl) {
    console.log('no video url in the result:', JSON.stringify(done).slice(0, 300))
    process.exit(1)
  }

  const mp4 = await r.get(videoUrl.startsWith('/') ? videoUrl : `/api/ai/video?id=${encodeURIComponent(id)}&content=1&index=0`)
  const buf = await mp4.body()
  console.log('MP4 fetch status:', mp4.status(), 'bytes:', buf.length)
  console.log('magic:', buf.slice(4, 12).toString())
  console.log('TOTAL seconds:', ((Date.now() - t0) / 1000).toFixed(0))
  const ok = buf.length > 50_000 && buf.slice(4, 8).toString() === 'ftyp'
  console.log(ok ? 'VIDEO LIVE: PASS' : 'VIDEO LIVE: FAIL')
  process.exit(ok ? 0 : 1)
}
main()
