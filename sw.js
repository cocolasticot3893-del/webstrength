/**
 * Service Worker offline-first pour WebStrength.
 * Stratégie Network-First sur les assets locaux de même origine avec repli cache
 * pour garantir un fonctionnement 100 % autonome au garage.
 * Ne jamais intercepter ni mettre en cache Intervals.icu ou les API Google/Gemini.
 */

const CACHE_NAME = "webstrength-v1.1.0";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./errorGuard.js",
  "./app.js",
  "./catalog.js",
  "./engine.js",
  "./fallbackGenerator.js",
  "./vault.js",
  "./outbox.js",
  "./intervalsClient.js",
  "./geminiClient.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

/**
 * Pré-cache tous les assets applicatifs locaux lors de l'installation.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/**
 * Purge les anciens caches lors de l'activation et prend le contrôle des clients.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Vérifie si la requête cible un hôte API externe à exclure strictement.
 * @param {URL} url
 * @returns {boolean}
 */
function isExcludedExternalHost(url) {
  const host = url.hostname.toLowerCase();
  return (
    host === "intervals.icu" ||
    host.endsWith(".intervals.icu") ||
    host === "googleapis.com" ||
    host.endsWith(".googleapis.com")
  );
}

/**
 * Stratégie Network-First pour les requêtes GET de même origine.
 * En cas d'échec réseau (mode garage hors-ligne), retourne la copie en cache.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Exclusion stricte de toute requête vers intervals.icu, googleapis.com ou autre origine
  if (isExcludedExternalHost(url) || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok &&
          networkResponse.type === "basic"
        ) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) {
            return shell;
          }
        }
        return new Response("Ressource indisponible hors-ligne.", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
  );
});
