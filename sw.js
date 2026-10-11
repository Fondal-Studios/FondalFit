const C = 'arq-v1';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/ar.js', 'js/geometry.js', 'js/plan.js', 'js/advisor.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES))));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
