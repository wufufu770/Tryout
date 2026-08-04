// Service Worker:零依赖离线缓存策略
// 策略:
// - 静态资源(JS/CSS/字体/图片):Cache First,失败回退网络
// - API 请求(/api/*):Network First,失败回退缓存(离线时用上次数据)
// - HTML 导航请求:Network First,失败回退缓存的 index.html(离线可打开应用)
const CACHE_VERSION = "tryout-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// 安装:预缓存核心资源(失败不阻塞,运行时再补)
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(["/", "/index.html", "/manifest.json"]).catch(() => {})
    )
  );
});

// 激活:清理旧版本缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 请求拦截:按类型分流
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // 只处理 GET,其他方法不缓存
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 跳跨域(字体等外部资源单独处理)
  const isSameOrigin = url.origin === self.location.origin;
  const isApi = url.pathname.startsWith("/api/");
  const isNavigation = req.mode === "navigate";
  const isStatic =
    /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico|json)$/.test(url.pathname) ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/logos/");

  // 1. HTML 导航:Network First,离线回退 index.html
  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // 2. API:Network First,离线回退缓存
  if (isApi) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3. 静态资源(同源 + 字体跨域):Cache First
  if (isStatic || !isSameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // 只缓存成功的同源响应
          if (res.ok && isSameOrigin) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }
});
