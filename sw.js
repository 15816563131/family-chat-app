/* 家庭聊天 Service Worker：用于桌面/系统通知与后台唤醒 */
self.addEventListener('push', function (event) {
  let data = { title: '家庭聊天', body: '' };
  try { data = JSON.parse(event.data.text()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || '家庭聊天', {
      body: data.body || '',
      icon: '',
      tag: 'fc'
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
