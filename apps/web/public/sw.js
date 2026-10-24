// Hang Up service worker: offline app shell + "incoming practice call" pushes.
const CACHE = "hangup-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;
  // Network first so new deploys show up; cache as the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {}
  const title = data.title || "Incoming call";
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      wins.forEach((w) => w.postMessage({ type: "ring", callId: data.callId }));
      const visible = wins.some((w) => w.visibilityState === "visible");
      if (!visible) {
        await self.registration.showNotification(title, {
          body: data.body || "Incoming practice call · Hang Up",
          tag: "hangup-call",
          renotify: true,
          requireInteraction: true,
          vibrate: [400, 200, 400, 200, 400, 1200, 400, 200, 400],
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          data: { url: data.url || "/" },
          actions: [
            { action: "answer", title: "Answer" },
            { action: "decline", title: "Decline" },
          ],
        });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "decline") return;
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          w.postMessage({ type: "ring" });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
