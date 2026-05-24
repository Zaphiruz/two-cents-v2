self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    data: { url: payload.url, tokens: payload.tokens || {} },
    actions: payload.actions || [],
    icon: "/icons/icon-192.png",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action && data.tokens && data.tokens[event.action]) {
    event.waitUntil(fetch("/api/qa/" + data.tokens[event.action], {
      method: "POST",
      credentials: "include",
    }));
    return;
  }
  event.waitUntil(self.clients.openWindow(data.url || "/"));
});
