/* Service worker : l'interface reste disponible hors ligne (les données /api ne sont jamais mises en cache).
   Incrémenter V à chaque nouvelle version pour forcer la mise à jour. */
var V = "astro-v2", CORE = ["./", "index.html", "style.css", "app.js", "body-twin.js", "twin-dashboard.js", "guide.html", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.pathname.indexOf("/api/") === 0) return;           // API : toujours le réseau
  e.respondWith(caches.open(V).then(function (c) {
    return c.match(r).then(function (hit) {
      var net = fetch(r).then(function (res) { if (res && (res.ok || res.type === "opaque")) c.put(r, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;                                                            // cache d'abord, mise à jour en arrière-plan
    });
  }));
});
