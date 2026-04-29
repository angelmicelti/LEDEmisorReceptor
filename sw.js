// =========================================================
//  SERVICE WORKER - LED Remoto PWA
// =========================================================

const CACHE_NAME = 'led-remoto-v1.1';

// Recursos que se cachean en la instalacion
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Recursos de Firebase que se cachean (SDK)
const FIREBASE_SDK_ASSETS = [
    'https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/11.0.1/firebase-database-compat.js'
];

// =========================================================
//  INSTALL: precache de recursos criticos
// =========================================================
self.addEventListener('install', function(event) {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            // Intentar cachear todo; si algo falla, seguimos
            return Promise.allSettled([
                cache.addAll(PRECACHE_ASSETS),
                cache.addAll(FIREBASE_SDK_ASSETS)
            ]).then(function(results) {
                var failures = results.filter(function(r) { return r.status === 'rejected'; });
                if (failures.length > 0) {
                    console.warn('[SW] Algunos recursos no se cachearon:', failures.length);
                }
            });
        })
    );
    // Activar inmediatamente sin esperar a que se cierre la pagina anterior
    self.skipWaiting();
});

// =========================================================
//  ACTIVATE: limpiar caches viejas
// =========================================================
self.addEventListener('activate', function(event) {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    console.log('[SW] Borrando cache vieja:', name);
                    return caches.delete(name);
                })
            );
        })
    );
    // Tomar control de todas las pestanas inmediatamente
    self.clients.claim();
});

// =========================================================
//  FETCH: estrategia hibrida segun tipo de recurso
// =========================================================
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // --- Firebase Realtime Database: Network-first ---
    // Las peticiones a Firebase necesitan ser siempre frescas
    if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com')) {
        event.respondWith(
            fetch(event.request)
                .then(function(response) {
                    // Si la red funciona, cachar la respuesta para offline
                    if (response && response.status === 200) {
                        var responseClone = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(function() {
                    // Si la red falla, intentar servir desde cache
                    return caches.match(event.request).then(function(cached) {
                        if (cached) {
                            return cached;
                        }
                        // Si no hay cache, devolver respuesta vacia para no romper la app
                        if (url.pathname.includes('.json')) {
                            return new Response('{}', {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                        return new Response('', { status: 503 });
                    });
                })
        );
        return;
    }

    // --- Firebase SDK (gstatic): Cache-first ---
    if (url.hostname.includes('gstatic.com') || url.hostname.includes('googleapis.com')) {
        event.respondWith(
            caches.match(event.request).then(function(cached) {
                if (cached) return cached;
                return fetch(event.request).then(function(response) {
                    if (response && response.status === 200) {
                        var responseClone = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                });
            })
        );
        return;
    }

    // --- Recursos locales (HTML, CSS, iconos): Cache-first con actualizacion en background ---
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request).then(function(cached) {
                var fetchPromise = fetch(event.request).then(function(response) {
                    if (response && response.status === 200) {
                        var responseClone = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                }).catch(function() {
                    // Si falla el fetch y habia algo en cache, ya se sirvio arriba
                });

                // Devolver cache inmediatamente si existe, si no esperar al fetch
                return cached || fetchPromise;
            })
        );
        return;
    }

    // --- Cualquier otra cosa: network con fallback a cache ---
    event.respondWith(
        fetch(event.request).catch(function() {
            return caches.match(event.request);
        })
    );
});

// =========================================================
//  MESSAGE: manejar mensajes desde la app
// =========================================================
self.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});