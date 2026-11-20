/**
 * Service Worker offline-first pour WebStrength.
 * Stratégie Network-First sur les assets locaux de même origine avec repli cache
 * pour garantir un fonctionnement 100 % autonome au garage.
 * Ne jamais intercepter ni mettre en cache Intervals.icu ou les API Google/Gemini.
 */

const CACHE_NAME = "webstrength-v1.12.0";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./errorGuard.js",
  "./app.js",
  "./catalog.js",
  "./extendedCatalog.js",
  "./svgHelper.js",
  "./engine.js",
  "./fallbackGenerator.js",
  "./mdParser.js",
  "./directoryBuilder.js",
  "./vault.js",
  "./outbox.js",
  "./intervalsClient.js",
  "./geminiClient.js",
  "./driveSync.js",
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
  "./assets/exos/USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND.svg",
  "./assets/exos/USER_BIRD_DOG_ANTI_ROTATION_AU_SOL.svg",
  "./assets/exos/USER_TIRAGE_HORIZONTAL_ELASTIQUE.svg",
  "./assets/exos/pull_up_pronation_strict_bw.svg",
  "./assets/exos/pull_up_pronation_tempo_ecc.svg",
  "./assets/exos/pull_up_pronation_scap_isometric.svg",
  "./assets/exos/barbell_bent_row_overhand.svg",
  "./assets/exos/barbell_overhead_press_strict.svg",
  "./assets/exos/db_one_arm_row_brace.svg",
  "./assets/exos/kb_strict_press_bottom_up.svg",
  "./assets/exos/ab_wheel_rollout_knees.svg",
  "./assets/exos/ab_wheel_offset_angle.svg",
  "./assets/exos/kb_suitcase_carry.svg",
  "./assets/exos/kb_rack_march.svg",
  "./assets/exos/band_pallof_press_split.svg",
  "./assets/exos/band_chop_diagonal.svg",
  "./assets/exos/db_deadbug_hold_load.svg",
  "./assets/exos/kb_windmill_light.svg",
  "./assets/exos/kbox_single_leg_rdl.svg",
  "./assets/exos/kbox_calf_press_bent_knee.svg",
  "./assets/exos/kb_hip_thrust_single.svg",
  "./assets/exos/barbell_romanian_deadlift_tempo.svg",
  "./assets/exos/band_clamshell_resisted.svg",
  "./assets/exos/band_tibialis_dorsiflexion.svg",
  "./assets/exos/db_step_up_high_box.svg",
  "./assets/exos/kb_goblet_cossack_squat.svg",
  "./assets/exos/kbox_high_pull_velocity.svg",
  "./assets/exos/kbox_squat_velocity_light.svg",
  "./assets/exos/band_high_knee_drive_fast.svg",
  "./assets/exos/band_acceleration_step_out.svg",
  "./assets/exos/barbell_hang_high_pull_light.svg",
  "./assets/exos/kb_swing_snap_velocity.svg",
  "./assets/exos/plyo_ankle_pogo_double.svg",
  "./assets/exos/plyo_ankle_pogo_single.svg",
  "./assets/exos/plyo_box_jump_step_down.svg",
  "./assets/exos/plyo_lateral_skater_bound.svg",
  "./assets/exos/plyo_split_scissor_switch.svg",
  "./assets/exos/plyo_push_up_explosive_incline.svg",
  "./assets/exos/SPRINT_ACCEL_DRIVE_15M.svg",
  "./assets/exos/SPRINT_FLYING_CADENCE_BURST.svg",
  "./assets/exos/SPRINT_UPHILL_POWER_DRIVE.svg",
  "./assets/exos/SPRINT_RESISTED_BAND_START.svg",
  "./assets/exos/SPRINT_DECEL_STICK_LANDING.svg",
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
    host.endsWith(".googleapis.com") ||
    host === "script.google.com" ||
    host === "script.googleusercontent.com"
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
