// 앱 화면 파일은 저장본으로 바로 열고, 새 버전은 뒤에서 받아 두었다가 다음 실행 때 적용합니다.
// 가계부 데이터(Apps Script)는 저장하지 않고 항상 서버에서 받습니다.
const CACHE = 'gagyebu-v21';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }               // 저장본 즉시 + 뒤에서 갱신
    return (await net) || (await c.match('index.html')) || Response.error();
  }));
});
