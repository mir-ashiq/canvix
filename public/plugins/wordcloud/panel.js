/*
 * Word Cloud — panel logic (runs inside the sandboxed panel iframe).
 * The shared wordcloud.js provides the RPC client and the exact
 * layout the service iframe uses, so the preview here is the truth
 * the canvas will show.
 */
;(function () {
  'use strict'

  var WC = window.CanvixWordCloud
  var PLUGIN_ID = 'com.canvix.wordcloud'
  var KIND = 'cloud'

  // ── element handles ─────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id) }
  var apiBadge = $('wc-api')
  var textEl = $('wc-text')
  var usePageBtn = $('wc-use-page')
  var rerollBtn = $('wc-reroll')
  var paletteEl = $('wc-palette')
  var maskEl = $('wc-mask')
  var densityEl = $('wc-density')
  var densityVal = $('wc-density-val')
  var stopsEl = $('wc-stops')
  var previewEl = $('wc-preview')
  var countEl = $('wc-count')
  var addBtn = $('wc-add')
  var updateBtn = $('wc-update')
  var statusEl = $('wc-status')

  // ── state ───────────────────────────────────────────────────
  var settings = { palette: 'canvix', mask: 'rect', density: 0.7, seed: 42, stopwords: '' }
  var selectedCloud = null // { id, data } of the selected own element
  var previewTimer = null

  function setStatus(text, kind) {
    statusEl.textContent = text || ''
    statusEl.className = 'status' + (kind ? ' ' + kind : '')
  }

  function currentWords() {
    return WC.tokenize(textEl.value, settings.stopwords)
  }

  function currentData() {
    return {
      words: currentWords(),
      seed: settings.seed,
      density: settings.density,
      mask: settings.mask,
      palette: settings.palette,
    }
  }

  // ── preview (same code path the service renderer uses) ──────
  function renderPreview() {
    var data = currentData()
    var box = previewEl.getBoundingClientRect()
    var w = Math.max(160, Math.round(box.width || 280))
    var h = Math.round(w * 0.62)
    previewEl.innerHTML = WC.toSvg(data, w, h, 'canvas')
    countEl.textContent = data.words.length
      ? data.words.length + ' words · seed ' + data.seed + (selectedCloud ? '' : ' · top: ' + data.words[0].text)
      : 'No words yet.'
    addBtn.disabled = data.words.length === 0
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreview, 120)
  }

  // ── settings persistence (namespaced by the host) ───────────
  var saveTimer = null
  function persistSettings() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(function () {
      rpc.call('storage.set', { key: 'settings', value: settings }).catch(function () {
        /* quota or permission — non-fatal, the panel still works */
      })
    }, 400)
  }

  function reflectSettings() {
    paletteEl.value = settings.palette
    maskEl.value = settings.mask
    densityEl.value = String(settings.density)
    densityVal.textContent = Number(settings.density).toFixed(2)
    stopsEl.value = settings.stopwords
  }

  // ── RPC wiring ──────────────────────────────────────────────
  var rpc = WC.createRpc({ handshake: WC.handshakeFromLocation() })

  function collectPageText(pages, currentPage) {
    var texts = []
    function walk(elements) {
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i]
        if (!el || typeof el !== 'object') continue
        if (typeof el.text === 'string' && el.text.trim()) texts.push(el.text)
        if (Array.isArray(el.children)) walk(el.children)
      }
    }
    var page = pages && pages[currentPage]
    if (page && Array.isArray(page.elements)) walk(page.elements)
    return texts
  }

  function findSelectedCloud(pages, currentPage, ids) {
    var found = null
    function walk(elements) {
      for (var i = 0; i < elements.length && !found; i++) {
        var el = elements[i]
        if (!el || typeof el !== 'object') continue
        if (
          ids.indexOf(el.id) >= 0 &&
          el.type === 'plugin' &&
          el.pluginId === PLUGIN_ID &&
          el.kind === KIND
        ) {
          found = el
        } else if (Array.isArray(el.children) && !found) {
          walk(el.children)
        }
      }
    }
    var page = pages && pages[currentPage]
    if (page && Array.isArray(page.elements)) walk(page.elements)
    return found
  }

  rpc.handle('event', function (params) {
    // selection pushes — refresh the "update selected" affordance
    if (!params || params.topic !== 'selection') return
    var ids = (params.payload && params.payload.ids) || []
    if (!ids.length) {
      selectedCloud = null
      updateBtn.hidden = true
      return
    }
    rpc
      .call('design.getSnapshot')
      .then(function (snap) {
        var el = findSelectedCloud(snap.pages, snap.currentPage, ids)
        selectedCloud = el ? { id: el.id, data: el.data || {} } : null
        if (selectedCloud) {
          // load the element's words back for restyling
          var words = selectedCloud.data.words
          if (Array.isArray(words) && words.length) {
            textEl.value = words
              .map(function (w) {
                return Array(Math.max(1, Math.min(30, Math.round(w.weight))))
                  .fill(w.text)
                  .join(' ')
              })
              .join(' ')
          }
          if (typeof selectedCloud.data.seed === 'number') settings.seed = selectedCloud.data.seed
          reflectSettings()
          updateBtn.hidden = false
          setStatus('Selected a cloud — edit and update it in place.', 'ok')
        } else {
          updateBtn.hidden = true
        }
        schedulePreview()
      })
      .catch(function () {
        /* read-only snapshot failure — non-fatal */
      })
  })

  // ── actions ─────────────────────────────────────────────────
  usePageBtn.addEventListener('click', function () {
    setStatus('Reading this page…')
    rpc
      .call('design.getSnapshot')
      .then(function (snap) {
        var texts = collectPageText(snap.pages, snap.currentPage)
        if (!texts.length) {
          setStatus('No text elements on this page — paste some text instead.', 'err')
          return
        }
        textEl.value = texts.join(' ')
        setStatus('Collected ' + texts.length + ' text element' + (texts.length > 1 ? 's' : '') + '.', 'ok')
        schedulePreview()
      })
      .catch(function (err) {
        setStatus(String(err.message || err), 'err')
      })
  })

  rerollBtn.addEventListener('click', function () {
    settings.seed = 1 + Math.floor(Math.random() * 9999) // UI affordance only —
    // the seed is then DATA: renders stay deterministic
    reflectSettings()
    persistSettings()
    schedulePreview()
  })

  addBtn.addEventListener('click', function () {
    var data = currentData()
    if (!data.words.length) return
    addBtn.disabled = true
    setStatus('Adding…')
    rpc
      .call('actions.apply', {
        action: {
          type: 'addPluginElement',
          kind: KIND,
          data: data,
          width: 480,
          height: 300,
          name: 'Word cloud',
        },
      })
      .then(function (res) {
        setStatus((res && res.message) || 'Added to the canvas.', 'ok')
      })
      .catch(function (err) {
        setStatus(String(err.message || err), 'err')
      })
      .then(function () {
        addBtn.disabled = false
      })
  })

  updateBtn.addEventListener('click', function () {
    if (!selectedCloud) return
    var data = currentData()
    setStatus('Updating…')
    rpc
      .call('actions.apply', {
        action: {
          type: 'updatePluginElementData',
          ids: [selectedCloud.id],
          patch: data,
        },
      })
      .then(function (res) {
        setStatus((res && res.message) || 'Updated.', 'ok')
      })
      .catch(function (err) {
        setStatus(String(err.message || err), 'err')
      })
  })

  // ── settings inputs ─────────────────────────────────────────
  paletteEl.addEventListener('change', function () {
    settings.palette = paletteEl.value
    persistSettings()
    schedulePreview()
  })
  maskEl.addEventListener('change', function () {
    settings.mask = maskEl.value
    persistSettings()
    schedulePreview()
  })
  densityEl.addEventListener('input', function () {
    settings.density = Number(densityEl.value)
    densityVal.textContent = settings.density.toFixed(2)
    persistSettings()
    schedulePreview()
  })
  stopsEl.addEventListener('change', function () {
    settings.stopwords = stopsEl.value.slice(0, 200)
    persistSettings()
    schedulePreview()
  })
  textEl.addEventListener('input', schedulePreview)

  // ── boot ────────────────────────────────────────────────────
  rpc
    .call('info')
    .then(function (info) {
      var api = info && info.api
      apiBadge.textContent = 'plugin API v' + (api ? api.major + '.' + api.minor : '1')
      return rpc.call('storage.get', { key: 'settings' })
    })
    .then(function (res) {
      var saved = res && res.value
      if (saved && typeof saved === 'object') {
        if (typeof saved.palette === 'string') settings.palette = saved.palette
        if (typeof saved.mask === 'string') settings.mask = saved.mask
        if (typeof saved.density === 'number') settings.density = saved.density
        if (typeof saved.seed === 'number') settings.seed = saved.seed
        if (typeof saved.stopwords === 'string') settings.stopwords = saved.stopwords
      }
      reflectSettings()
      renderPreview()
      return rpc.call('subscribe', { topic: 'selection' })
    })
    .then(function () {
      setStatus('Ready — sandboxed, no network.', 'ok')
    })
    .catch(function (err) {
      apiBadge.textContent = 'offline'
      setStatus('Could not reach the host: ' + String(err.message || err), 'err')
    })
})()
