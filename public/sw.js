const CACHE_NAME = 'fpl-tracker-v6';
// Deliberately no '/index.html': the Worker's asset layer 307s it to '/', and
// cache.addAll throws on a redirected response, which would fail the whole install.
// '/' serves the same file with a 200.
const urlsToCache = [
    '/',
    '/styles.css',
    '/app.js',
    '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Skip chrome-extension and other non-http schemes
    if (!event.request.url.startsWith('http')) {
        return;
    }
    
    // Handle API requests differently (network first). These are same-origin now:
    // our Worker proxies FPL under /api/fpl/ and already caches at the edge, so this
    // cache is only a last-resort fallback for going offline mid-gameweek.
    if (new URL(event.request.url).pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Only cache valid responses
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            })
                            .catch(err => console.log('Cache put failed:', err));
                    }
                    
                    return response;
                })
                .catch(() => {
                    // If network fails, try to get from cache
                    return caches.match(event.request);
                })
        );
        return;
    }
    
    // For app resources, use cache first strategy
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached version or fetch from network
                return response || fetch(event.request)
                    .then(response => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // Clone the response
                        const responseToCache = response.clone();
                        
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            })
                            .catch(err => console.log('Cache put failed:', err));
                        
                        return response;
                    })
                    .catch(() => {
                        // Return a valid response for missing files
                        return new Response('File not found', { 
                            status: 404, 
                            statusText: 'Not Found' 
                        });
                    });
            })
            .catch(() => {
                // If both cache and network fail, show offline page or 404
                if (event.request.destination === 'document') {
                    return caches.match('/');
                }
                return new Response('File not found', { 
                    status: 404, 
                    statusText: 'Not Found' 
                });
            })
    );
});