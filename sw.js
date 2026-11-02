// MES 包材计算 · Service Worker
// 策略：
//   - 安装时预缓存 app shell（同源静态资源）
//   - 导航请求：network-first，失败回退缓存的 index.html（断网可打开）
//   - 其他同源 GET：cache-first，缺失时请求并回填缓存
//   - 只处理同源请求；任何外部资源都不缓存、不拦截
// 改版时手动改 CACHE_VERSION（v1 → v2 …），activate 会清掉旧版本缓存。
const CACHE_VERSION = 'v1'
const CACHE_NAME = 'mes-calc-web-' + CACHE_VERSION
const SCOPE_ROOT = self.registration.scope
const INDEX_URL = new URL('index.html', SCOPE_ROOT).href

const APP_SHELL = [
    '',
    'index.html',
    'css/style.css',
    'js/app.js',
    'js/calc.js',
    'js/store.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon-180.png'
].map(path => new URL(path, SCOPE_ROOT).href)

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    )
})

/** 同源 GET 才接管；跨域与 POST 等直接放行，避免产生外部请求。 */
function shouldHandle(request) {
    if (request.method !== 'GET') return false
    const url = new URL(request.url)
    return url.origin === self.location.origin
}

/** 缓存回填（失败不影响响应）。 */
function putInCache(request, response) {
    if (!response || !response.ok) return Promise.resolve()
    return caches.open(CACHE_NAME).then(cache => cache.put(request, response)).catch(() => {})
}

self.addEventListener('fetch', event => {
    const request = event.request
    if (!shouldHandle(request)) return

    // 导航：network-first（保证内容最新），断网回退缓存首页
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const copy = response.clone()
                        caches.open(CACHE_NAME).then(cache => cache.put(new Request(INDEX_URL), copy)).catch(() => {})
                    }
                    return response
                })
                .catch(() => caches.match(new Request(INDEX_URL)).then(cached => cached || caches.match(new Request(SCOPE_ROOT))))
        )
        return
    }

    // 静态资源：cache-first，缺失时请求并回填
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached
            return fetch(request)
                .then(response => {
                    putInCache(request, response.clone())
                    return response
                })
                .catch(() => caches.match(request))
        })
    )
})
