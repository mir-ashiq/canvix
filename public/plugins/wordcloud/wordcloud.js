/*
 * Canvix Word Cloud — the one shared script both plugin frames load
 * (P5, research/PLUGIN-SYSTEM.md §5). Zero dependencies, no build
 * step, classic <script src> in a sandboxed iframe AND a CommonJS
 * export for the host repo's vitest suite.
 *
 * Three concerns live here, on purpose:
 *
 *   1. RPC        — the plugin half of the v1 postMessage envelope
 *                   (handshake echo, call/result correlation, and
 *                   answering host→plugin calls such as
 *                   elements.render / event pushes).
 *   2. tokenize   — text → weighted word list (shared by the panel
 *                   preview and the service renderer, so preview and
 *                   canvas always agree).
 *   3. layout/svg — the deterministic renderer. The seed lives in the
 *                   element data; the ONLY randomness is mulberry32
 *                   seeded by it. Same data in → same SVG out, which
 *                   is what makes the host's render cache sound.
 *                   Text width is estimated from character classes,
 *                   not measured, so output is identical on every
 *                   machine (documented in docs/PLUGINS.md).
 *
 * Output discipline: the emitted SVG passes Canvix's accept-or-reject
 * sanitizer BY CONSTRUCTION — only <svg>/<g>/<text> elements, only
 * geometry/typography attributes, XML-escaped text content, no
 * comments, no doctype, no external references of any kind.
 */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.CanvixWordCloud = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ── 1. RPC client (plugin half of the v1 envelope) ──────────

  /**
   * Wire up the broker conversation. The handshake token rides the
   * iframe URL fragment (never sent over the wire); the FIRST call
   * must echo it or the broker answers E_PERMISSION forever.
   */
  function createRpc(opts) {
    opts = opts || {}
    var timeoutMs = opts.timeoutMs || 15000
    var pending = new Map()
    var handlers = new Map()
    var seq = 0
    var handshakeSent = false

    function newId() {
      seq += 1
      // correlation ids only — uniqueness is all that matters.
      // (Math.random is NEVER used in the layout itself.)
      return 'wc_' + seq.toString(36) + '_' + Math.random().toString(36).slice(2, 10)
    }

    window.addEventListener('message', function (ev) {
      if (ev.source !== parent) return // only the host may talk to us
      var data = ev.data
      if (!data || typeof data !== 'object' || data.v !== 1) return
      if (data.dir === 'result') {
        var p = pending.get(data.id)
        if (!p) return
        pending.delete(data.id)
        clearTimeout(p.timer)
        if (data.ok) p.resolve(data.result)
        else p.reject(new Error((data.error && data.error.message) || 'rpc error'))
        return
      }
      if (data.dir === 'call') {
        // host→plugin: elements.render or an event push.
        // Every call gets a result envelope — pushes are acked, and
        // a missing handler is an honest E_METHOD, not silence.
        var fn = handlers.get(data.method)
        Promise.resolve()
          .then(function () {
            if (!fn) throw new Error('this plugin does not handle "' + data.method + '"')
            return fn(data.params)
          })
          .then(
            function (result) {
              parent.postMessage({ v: 1, id: data.id, dir: 'result', ok: true, result: result }, '*')
            },
            function (err) {
              parent.postMessage(
                {
                  v: 1,
                  id: data.id,
                  dir: 'result',
                  ok: false,
                  error: { code: 'E_INTERNAL', message: String((err && err.message) || err).slice(0, 200) },
                },
                '*',
              )
            },
          )
      }
    })

    function call(method, params) {
      return new Promise(function (resolve, reject) {
        var id = newId()
        var envelope = { v: 1, id: id, dir: 'call', method: method }
        if (params !== undefined) envelope.params = params
        if (!handshakeSent) {
          handshakeSent = true
          envelope.handshake = opts.handshake
        }
        var timer = setTimeout(function () {
          pending.delete(id)
          reject(new Error('"' + method + '" timed out'))
        }, timeoutMs)
        pending.set(id, { resolve: resolve, reject: reject, timer: timer })
        parent.postMessage(envelope, '*')
      })
    }

    return {
      call: call,
      handle: function (method, fn) {
        handlers.set(method, fn)
      },
    }
  }

  /** The handshake token from this frame's URL fragment, decoded. */
  function handshakeFromLocation() {
    var raw = location.hash.replace(/^#/, '')
    try {
      return decodeURIComponent(raw)
    } catch (e) {
      return raw
    }
  }

  // ── 2. tokenization ─────────────────────────────────────────

  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, but: 1, if: 1, of: 1, at: 1, by: 1,
    for: 1, with: 1, about: 1, to: 1, from: 1, in: 1, on: 1, into: 1, over: 1,
    is: 1, are: 1, was: 1, were: 1, be: 1, been: 1, being: 1, am: 1,
    it: 1, its: 1, this: 1, that: 1, these: 1, those: 1, as: 1, not: 1, no: 1,
    so: 1, than: 1, too: 1, very: 1, can: 1, will: 1, just: 1, should: 1,
    we: 1, you: 1, your: 1, i: 1, my: 1, me: 1, our: 1, their: 1,
    he: 1, she: 1, they: 1, them: 1, his: 1, her: 1, him: 1,
    do: 1, does: 1, did: 1, doing: 1, have: 1, has: 1, had: 1, having: 1,
    what: 1, which: 1, who: 1, when: 1, where: 1, why: 1, how: 1, all: 1,
    any: 1, each: 1, few: 1, more: 1, most: 1, other: 1, some: 1, such: 1,
    then: 1, once: 1, here: 1, there: 1, also: 1,
  }

  /** text → [{text, weight}] — weight-desc, then alphabetical. */
  function tokenize(text, extraStops) {
    var stops = {}
    var k
    for (k in STOPWORDS) stops[k] = 1
    String(extraStops || '')
      .split(/[\s,;]+/)
      .forEach(function (w) {
        w = w.trim().toLowerCase()
        if (w.length >= 2 && w.length <= 40) stops[w] = 1
      })
    var counts = Object.create(null)
    var re = /[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu
    var m
    while ((m = re.exec(String(text || ''))) !== null) {
      var w = m[0]
      if (w.length < 2 || w.length > 40) continue
      var lower = w.toLowerCase()
      if (stops[lower]) continue
      if (counts[lower] === undefined) counts[lower] = { text: w, n: 0 }
      counts[lower].n += 1
    }
    var out = []
    for (var key in counts) out.push({ text: counts[key].text, weight: counts[key].n })
    out.sort(function (a, b) {
      return b.weight - a.weight || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)
    })
    return out.slice(0, 150)
  }

  // ── 3. deterministic layout + SVG ───────────────────────────

  var PALETTES = {
    canvix: ['#7630D7', '#02C0CC', '#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#EC4899'],
    sunset: ['#F97316', '#EF4444', '#EC4899', '#A855F7', '#FBBF24', '#DC2626'],
    ocean: ['#0EA5E9', '#06B6D4', '#3B82F6', '#6366F1', '#14B8A6', '#0284C7'],
    mono: ['#111827', '#374151', '#4B5563', '#6B7280', '#1F2937', '#9CA3AF'],
  }
  var MASKS = ['rect', 'circle']
  var FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif'

  /** mulberry32 — tiny, well-understood, deterministic PRNG. */
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      var t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** Character-class width estimate (documented approximation — no
   *  text measurement anywhere, so output is machine-independent). */
  function textWidth(s, fontSize) {
    var NARROW = 'iljtIfI.,;:\'!\u2019|()[]{}1'
    var WIDE = 'mwMW@%&USDQGO0'
    var units = 0
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i)
      if (NARROW.indexOf(c) >= 0) units += 0.3
      else if (WIDE.indexOf(c) >= 0) units += 0.92
      else if (c >= 'A' && c <= 'Z') units += 0.68
      else if (c >= '0' && c <= '9') units += 0.56
      else units += 0.53
    }
    return units * fontSize
  }

  function clampDim(n) {
    var v = Math.round(Number(n))
    if (!Number.isFinite(v)) v = 480
    return Math.min(8000, Math.max(8, v))
  }

  /** Defensive data normalization — a renderer must never throw on
   *  hostile or stale element data (a future pluginVersion may have
   *  written fields this version does not understand). */
  function clampData(data) {
    var d = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    var wordsIn = Array.isArray(d.words) ? d.words : []
    var words = []
    for (var i = 0; i < wordsIn.length && words.length < 150; i++) {
      var w = wordsIn[i]
      if (!w || typeof w !== 'object') continue
      var text = String(w.text || '').trim().slice(0, 40)
      var weight = Number(w.weight)
      if (!text || !Number.isFinite(weight) || weight < 1) continue
      words.push({ text: text, weight: Math.min(999, Math.round(weight)) })
    }
    var seed = Math.round(Number(d.seed))
    if (!Number.isFinite(seed)) seed = 42
    seed = Math.min(9999, Math.max(1, seed))
    var density = Number(d.density)
    if (!Number.isFinite(density)) density = 0.7
    density = Math.min(1, Math.max(0.1, density))
    var mask = MASKS.indexOf(d.mask) >= 0 ? d.mask : 'rect'
    var palette = Object.prototype.hasOwnProperty.call(PALETTES, d.palette) ? d.palette : 'canvix'
    return { words: words, seed: seed, density: density, mask: mask, palette: palette }
  }

  /** Does a box centered at (cx,cy) fit — inside the canvas bounds,
   *  inside the mask, clear of every placed box? */
  function fits(cx, cy, hw, hh, W, H, mask, placed) {
    if (cx - hw < 2 || cx + hw > W - 2 || cy - hh < 2 || cy + hh > H - 2) return false
    if (mask === 'circle') {
      var rx = (W / 2) * 0.94
      var ry = (H / 2) * 0.94
      var dx = hw / rx
      var dy = hh / ry
      if (dx * dx + dy * dy > 1) return false
    }
    for (var i = 0; i < placed.length; i++) {
      var b = placed[i]
      if (cx - hw < b.x + b.w && cx + hw > b.x && cy - hh < b.y + b.h && cy + hh > b.y) return false
    }
    return true
  }

  /**
   * The spiral layout. Deterministic: every random decision comes
   * from mulberry32(seed). Words that cannot be placed at any of
   * three shrinking sizes are skipped — honest omission, no overlap.
   */
  function layout(data, width, height) {
    var W = clampDim(width)
    var H = clampDim(height)
    var minDim = Math.min(W, H)
    var rng = mulberry32(data.seed)
    var palette = PALETTES[data.palette]
    var words = data.words
    var maxW = words.length ? words[0].weight : 1
    var placed = []
    var out = []
    for (var i = 0; i < words.length; i++) {
      var word = words[i]
      var rotate = rng() < 0.12 ? 90 : 0
      var phase = rng() * Math.PI * 2
      var done = false
      var shrink = 1
      for (var attempt = 0; attempt < 3 && !done; attempt++, shrink *= 0.82) {
        var size = Math.max(
          8,
          minDim * 0.16 * (0.25 + 0.75 * Math.sqrt(word.weight / maxW)) * (0.4 + 0.6 * data.density) * shrink,
        )
        var bw = textWidth(word.text, size) + size * 0.35
        var bh = size * 1.12 + size * 0.22
        var step = 0
        while (step < 900) {
          var r = 2 + step * (minDim / 240)
          var ang = phase + step * 0.37
          var cx = W / 2 + r * Math.cos(ang)
          var cy = H / 2 + r * Math.sin(ang)
          var hw = (rotate === 90 ? bh : bw) / 2
          var hh = (rotate === 90 ? bw : bh) / 2
          if (fits(cx, cy, hw, hh, W, H, data.mask, placed)) {
            placed.push({ x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 })
            out.push({
              text: word.text,
              cx: Math.round(cx * 10) / 10,
              cy: Math.round(cy * 10) / 10,
              fontSize: Math.round(size * 10) / 10,
              rotate: rotate,
              fill: palette[Math.floor(rng() * palette.length)],
            })
            done = true
            break
          }
          step++
        }
      }
    }
    return out
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    })
  }

  /**
   * Render element data to a self-contained SVG string. The output
   * intentionally uses only <svg>/<text> elements with geometry and
   * typography attributes — the exact shape Canvix's sanitizer
   * accepts, so it can never be rejected for structure.
   */
  function toSvg(data, width, height, mode) {
    var d = clampData(data)
    var W = clampDim(width)
    var H = clampDim(height)
    var items = layout(d, W, H)
    var parts = []
    parts.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
    )
    if (!items.length) {
      var hintSize = Math.max(10, Math.round(Math.min(W, H) / 16))
      parts.push(
        '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="' + hintSize +
        '" fill="#C9CDD6" font-family="' + FONT + '">Word cloud (open the app to add words)</text>',
      )
    } else {
      for (var i = 0; i < items.length; i++) {
        var it = items[i]
        var x = it.cx
        var y = Math.round((it.cy + it.fontSize * 0.34) * 10) / 10 // manual baseline — portable across rasterizers
        var rot = it.rotate ? ' transform="rotate(90 ' + it.cx + ' ' + it.cy + ')"' : ''
        parts.push(
          '<text x="' + x + '" y="' + y + '"' + rot + ' font-size="' + it.fontSize +
          '" fill="' + it.fill + '" font-family="' + FONT + '" text-anchor="middle">' +
          escapeXml(it.text) + '</text>',
        )
      }
    }
    parts.push('</svg>')
    return parts.join('')
  }

  return {
    createRpc: createRpc,
    handshakeFromLocation: handshakeFromLocation,
    tokenize: tokenize,
    toSvg: toSvg,
    clampData: clampData,
    layout: layout,
    PALETTES: PALETTES,
    MASKS: MASKS,
    STOPWORDS: STOPWORDS,
    FONT: FONT,
  }
})
