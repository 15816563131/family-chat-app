// ============================================================
// 家庭聊天 - Service Worker
// 策略：静态资源 Cache First，API 请求 Network First
// 版本：v2.0.0
// ============================================================
var CACHE_NAME = 'family-chat-v2';
var STATIC_URLS = [
  '/',
  '/static/style.css',
  '/static/chat.js',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon.svg',
  '/static/app-logo.jpg',
  '/static/empty-state.jpg',
  '/static/default-avatar-self.jpg',
  '/static/default-avatar-friend.jpg',
  '/static/loading.jpg'
];

// ===== 安装：预缓存核心资源 =====
self.addEventListener('install', function(event) {
  console.log('[SW] 安装中...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_URLS).catch(function(err) {
        console.log('[SW] 预缓存部分失败(可忽略):', err.message);
      });
    })
  );
});

// ===== 激活：清理旧缓存 =====
self.addEventListener('activate', function(event) {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ===== 拦截请求 =====
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  var isStatic = STATIC_URLS.indexOf(url.pathname) !== -1;
  var isApi = url.pathname.indexOf('/api/') === 0;

  // 静态资源：Cache First
  if (isStatic) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // API 请求：Network First（超时后读缓存）
  if (isApi) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 其他（图片、字体等）：先缓存后网络
  if (event.request.destination === 'image' || event.request.destination === 'font') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 默认：Network First
  event.respondWith(networkFirst(event.request));
});

// ===== Cache First 策略 =====
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) {
      // 后台异步更新缓存（stale-while-revalidate）
      fetch(request).then(function(response) {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, response);
          });
        }
      }).catch(function() {});
      return cached;
    }
    // 缓存未命中，走网络
    return fetchAndCache(request);
  }).catch(function() {
    return fetchAndCache(request);
  });
}

// ===== Network First 策略 =====
function networkFirst(request) {
  var TIMEOUT = 5000; // 5 秒超时
  var timeoutPromise = new Promise(function(resolve) {
    setTimeout(function() {
      // 超时后返回缓存内容
      caches.match(request).then(function(cached) {
        resolve(cached || new Response(
          JSON.stringify({error: '网络超时，请检查连接'}),
          {status: 408, headers: {'Content-Type': 'application/json'}}
        ));
      });
    }, TIMEOUT);
  });

  var fetchPromise = fetch(request).then(function(response) {
    if (response && response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, clone);
      });
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      return new Response(
        JSON.stringify({error: '网络不可用'}),
        {status: 503, headers: {'Content-Type': 'application/json'}}
      );
    });
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}

// ===== 获取并缓存 =====
function fetchAndCache(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, clone);
      });
    }
    return response;
  }).catch(function() {
    // 网络不可用，返回简单离线页面
    if (request.headers.get('Accept').indexOf('text/html') !== -1) {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线 - 家庭聊天</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#ededed;color:#333;text-align:center}.offline-card{padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.1)}.offline-icon{font-size:64px}.offline-title{font-size:20px;font-weight:600;margin:16px 0 8px}.offline-text{font-size:14px;color:#666;margin:0}</style></head><body><div class="offline-card"><div class="offline-icon">📡</div><div class="offline-title">网络已断开</div><p class="offline-text">正在尝试重连…<br>已加载的历史消息仍可查看</p></div></body></html>',
        {status: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}}
      );
    }
  });
}

// ===== 推送通知 =====
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? JSON.parse(event.data.text()) : {};
  } catch(e) {
    data = {title: '新消息', body: event.data ? event.data.text() : ''};
  }

  var options = {
    body: data.body || '你有新消息',
    icon: data.icon || '/static/icon-192.png',
    badge: '/static/icon-192.png',
    vibrate: [100, 50, 100],
    tag: data.tag || 'default',
    data: {
      url: data.url || '/',
      dateOfArrival: Date.now()
    },
    actions: [
      {action: 'open', title: '打开 家庭聊天'},
      {action: 'close', title: '关闭'}
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '家庭聊天', options)
  );
});

// ===== 点击通知 =====
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'open') {
    var targetUrl = event.notification.data.url || '/';
    event.waitUntil(
      clients.matchAll({type: 'window'}).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(targetUrl) !== -1 && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
    );
  }
});