// Custom Service Worker logic for Web Push Notifications
self.addEventListener('push', (event) => {
  let data = { title: 'Nova Entrega Pipa!', body: 'Você recebeu uma nova rota de abastecimento.' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nova Entrega Pipa!', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    tag: 'new-delivery',
    renotify: true,
    actions: [
      { action: 'open', title: 'Ver Rota' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If there is already a tab open, focus on it
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
