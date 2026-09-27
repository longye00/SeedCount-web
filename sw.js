/** Service Worker：界面优先更新，大文件保留离线缓存 */
const CACHE = 'seedcount-web-v3'
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/model-web.js',
  'js/decoder.js',
  'js/roi-editor.js',
  'js/core/counter.js',
  'js/core/imaging.js',
  'js/core/locator.js',
  'js/core/overlay.js',
  'js/core/poly.js',
  'js/core/roi.js',
  'vendor/ort/ort.wasm.min.js',
  'vendor/ort/ort-wasm-simd-threaded.mjs',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(async (keys) => {
        const oldKeys = keys.filter((key) => key.startsWith('seedcount-web-') && key !== CACHE)
        await Promise.all(oldKeys.map((key) => caches.delete(key)))
        await self.clients.claim()
        if (oldKeys.length) {
          const windows = await self.clients.matchAll({ type: 'window' })
          await Promise.all(windows.map((client) => client.navigate(client.url)))
        }
      })
  )
})

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  const heavyAsset = /\.(?:onnx|wasm)$/i.test(url.pathname)
  e.respondWith(heavyAsset ? cacheFirst(e.request) : networkFirst(e.request))
})
