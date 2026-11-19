/**
 * Service Worker offline-first pour WebStrength.
 * Stratégie Network-First sur les assets locaux de même origine avec repli cache
 * pour garantir un fonctionnement 100 % autonome au garage.
 * Ne jamais intercepter ni mettre en cache Intervals.icu ou les API Google/Gemini.
 */

const CACHE_NAME = "webstrength-v1.6.0";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./errorGuard.js",
  "./app.js",
  "./catalog.js",
  "./engine.js",
  "./fallbackGenerator.js",
  "./mdParser.js",
  "./vault.js",
  "./outbox.js",
  "./intervalsClient.js",
  "./geminiClient.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./assets/exos/KBOX_SQUAT_HARNESS.svg",
  "./assets/exos/KBOX_SQUAT_BELT.svg",
  "./assets/exos/KBOX_SPLIT_SQUAT.svg",
  "./assets/exos/KBOX_RDL.svg",
  "./assets/exos/KBOX_HIP_THRUST.svg",
  "./assets/exos/KBOX_CALF_ECC.svg",
  "./assets/exos/KBOX_HIGH_PULL.svg",
  "./assets/exos/DB_SL_RDL.svg",
  "./assets/exos/DB_STEP_DOWN.svg",
  "./assets/exos/DB_COPENHAGEN.svg",
  "./assets/exos/DB_RENEGADE_ROW.svg",
  "./assets/exos/DB_FARMER_UNI.svg",
  "./assets/exos/BAND_MONSTER_WALK.svg",
  "./assets/exos/BAND_PALLOF_PRESS.svg",
  "./assets/exos/BAND_PSOAS_MARCH.svg",
  "./assets/exos/BAND_FACE_PULL.svg",
  "./assets/exos/CORE_MCGILL_BIG3.svg",
];

/**
 * Pré-cache tous les assets applicatifs locaux lors de l'installation
 * en contournant le cache HTTP navigateur.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_ASSETS.map(async (assetUrl) => {
            const response = await fetch(assetUrl, { cache: "no-cache" });
            if (!response.ok) {
              throw new Error(
                `Échec du pré-cache (${response.status}) : ${assetUrl}`
              );
            }
            return cache.put(assetUrl, response);
          })
        )
      )
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
    fetch(request, { cache: "no-cache" })
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
