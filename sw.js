/**
 * ================================
 * sw.js – Service Worker for Reels PWA
 * (Cache-First Strategy | Offline Support)
 * المطور: محمود | بيئة: أجهزة ضعيفة / إنترنت مقيد
 * ================================
 */

const CACHE_NAME = 'reels-feed-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js'
];

// أثناء التثبيت: نخزن الملفات الأساسية
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('✅ Service Worker: caching static assets');
            return cache.addAll(STATIC_ASSETS);
        }).catch(err => console.warn('⚠️ Cache install failed:', err))
    );
    // تفعيل فوري دون انتظار reload
    self.skipWaiting();
});

// أثناء التفعيل: تنظيف الكاشات القديمة
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('✅ Service Worker activated');
            // السيطرة على جميع العملاء فوراً
            return self.clients.claim();
        })
    );
});

// استراتيجية الطلبات: Cache First مع تحديث خلفي للفيديوهات
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // نتعامل فقط مع طلبات GET
    if (request.method !== 'GET') return;

    // بالنسبة للموارد الثابتة (HTML, CSS, JS) -> Cache First
    if (STATIC_ASSETS.includes(url.pathname) || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    // تحديث الكاش في الخلفية
                    fetchAndUpdateCache(request, CACHE_NAME);
                    return cachedResponse;
                }
                return fetchAndUpdateCache(request, CACHE_NAME);
            })
        );
        return;
    }

    // بالنسبة للفيديوهات (mp4) -> Network First مع تخزين تدريجي
    if (url.pathname.endsWith('.mp4') || url.hostname.includes('commondatastorage.googleapis.com')) {
        event.respondWith(
            fetch(request).then((networkResponse) => {
                // ننسخ الاستجابة ونخزنها في الكاش للاستخدام المستقبلي
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseClone);
                }).catch(err => console.warn('⚠️ Video cache failed:', err));
                return networkResponse;
            }).catch(() => {
                // إذا فشل الاتصال، نحاول الإرجاع من الكاش
                return caches.match(request).then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('📦 Serving video from cache:', url.href);
                        return cachedResponse;
                    }
                    // يمكن إرجاع فيديو افتراضي صغير جداً كبديل (اختياري)
                    return new Response('', { status: 503, statusText: 'Offline - video not cached' });
                });
            })
        );
        return;
    }

    // أي طلبات أخرى (صور، خطوط) -> Cache First
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                fetchAndUpdateCache(request, CACHE_NAME);
                return cachedResponse;
            }
            return fetchAndUpdateCache(request, CACHE_NAME);
        })
    );
});

/**
 * جلب الطلب وتحديث الكاش
 */
async function fetchAndUpdateCache(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response && response.status === 200 && response.type === 'basic') {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.warn('⚠️ Fetch failed, trying cache for:', request.url);
        return caches.match(request);
    }
}
