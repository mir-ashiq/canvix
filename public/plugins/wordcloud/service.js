/*
 * Word Cloud — the service-frame half of the renderer contract
 * (research/PLUGIN-SYSTEM.md §4.5). This frame is mounted hidden by
 * the host whenever the open design contains Word Cloud elements.
 *
 *   host → plugin   elements.render { kind, data, width, height, mode }
 *   plugin → host   result { svg }        (sanitized host-side)
 *
 * Renders are deterministic by contract: every random decision is
 * mulberry32 seeded from data.seed, so the host's render cache
 * (keyed on a hash of the data) is sound — same data, same SVG.
 */
;(function () {
  'use strict'

  var WC = window.CanvixWordCloud
  var KIND = 'cloud'

  var rpc = WC.createRpc({ handshake: WC.handshakeFromLocation() })

  rpc.handle('elements.render', function (params) {
    var p = params || {}
    var svg = WC.toSvg(p.data, p.width, p.height, p.mode)
    // one honest log line per render — the e2e suite and curious
    // self-hosters watch the console; everything else stays quiet
    console.log('[wordcloud] rendered ' + (p.width || '?') + 'x' + (p.height || '?') + (p.mode ? ' (' + p.mode + ')' : ''))
    return { svg: svg }
  })

  // host→plugin pushes (event) are acked by the rpc client; this
  // service subscribes to nothing.

  rpc
    .call('elements.registerRenderer', { kind: KIND })
    .then(function () {
      console.log('[wordcloud] renderer registered for "' + KIND + '"')
    })
    .catch(function (err) {
      console.error('[wordcloud] renderer registration failed: ' + String(err.message || err))
    })
})()
