// Minimal service worker so the player is installable as a PWA. Network-first:
// we never want to cache API/stream responses, only enable "Add to Home Screen".
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());
self.addEventListener('fetch', () => { /* pass-through */ });
