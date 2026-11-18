/**
 * Client HTTP Intervals.icu pour WebStrength (ES2024+ natif zéro-build).
 * Gère l'authentification Basic, le backoff exponentiel avec jitter (429 / 5xx),
 * le provisioning des champs d'activité personnalisés, l'extraction du contexte
 * physiologique 7 jours (HRV, PVT, Handgrip, charge vélo, dernière séance PPG)
 * et la publication manuelle d'activités.
 */

import { parseTelemetryJsonFromDescription } from "./engine.js";

export const INTERVALS_BASE_URL = "https://intervals.icu/api/v1";

/**
 * Définition immuable des 3 champs personnalisés requis sur Intervals.icu.
 */
export const CUSTOM_ACTIVITY_FIELDS = Object.freeze([
  Object.freeze({
    code: "Eccentric_Strain_Index",
    name: "Eccentric Strain Index",
    type: "numeric",
    units: "AU",
    aggregate: "SUM",
  }),
  Object.freeze({
    code: "PPG_Effective_TUT",
    name: "PPG Effective TUT",
    type: "numeric",
    units: "s",
    aggregate: "SUM",
  }),
  Object.freeze({
    code: "Strength_Compliance_Pct",
    name: "Strength Compliance",
    type: "numeric",
    units: "%",
    aggregate: "AVERAGE",
  }),
]);

const BIKE_ACTIVITY_TYPES = new Set([
  "Ride",
  "VirtualRide",
  "MountainBikeRide",
  "GravelRide",
]);

/**
 * Encode une chaîne UTF-8 en Base64 de façon compatible navigateur (`btoa`) et Node.js (`Buffer`).
 * @param {string} str
 * @returns {string}
 */
function encodeBase64(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Construit l'en-tête HTTP `Authorization: Basic ...` pour Intervals.icu.
 * @param {string} apiKey
 * @returns {string}
 */
function buildBasicAuthHeader(apiKey) {
  const cleanKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!cleanKey) {
    throw new Error("Clé API Intervals.icu manquante.");
  }
  return `Basic ${encodeBase64(`API_KEY:${cleanKey}`)}`;
}

/**
 * Normalise et valide l'identifiant athlète pour les URLs REST Intervals.icu.
 * Accepte uniquement `"0"` ou `"i?[0-9]+"`.
 * @param {string | number} athleteId
 * @returns {string}
 */
function normalizeAthleteId(athleteId) {
  const raw =
    athleteId === undefined || athleteId === null
      ? "0"
      : String(athleteId).trim();
  const clean = raw === "" ? "0" : raw;
  if (!/^(0|i?\d+)$/.test(clean)) {
    throw new Error(
      `Identifiant athlète Intervals.icu invalide (attendu "0" ou "i?<chiffres>") : "${clean}"`
    );
  }
  return encodeURIComponent(clean);
}

/**
 * Défense anti-prompt injection : supprime balises HTML et caractères de contrôle,
 * puis tronque proprement à `maxLen` caractères.
 * @param {unknown} v
 * @param {number} [maxLen=180]
 * @returns {string}
 */
export function sanitizeText(v, maxLen = 180) {
  if (v === null || v === undefined) return "";
  const cleaned = String(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (maxLen > 0 && cleaned.length > maxLen) {
    return cleaned.slice(0, maxLen).trimEnd();
  }
  return cleaned;
}

/**
 * Supprime uniquement les caractères de contrôle dangereux tout en préservant
 * les sauts de ligne pour `parseTelemetryJsonFromDescription`.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeMultilineRaw(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Calcule le délai d'attente (ms) à partir de l'en-tête `Retry-After` s'il est présent.
 * @param {string | null} retryAfterHeader
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000);
  }
  const targetMs = Date.parse(trimmed);
  if (Number.isFinite(targetMs)) {
    return Math.max(0, Math.min(targetMs - Date.now(), 30000));
  }
  return null;
}

/**
 * Pause asynchrone compatible annulation par `AbortSignal`.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Requête annulée"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("Requête annulée"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exécute un appel `fetch` JSON avec backoff exponentiel + jitter sur HTTP 429,
 * HTTP 5xx et erreurs réseau transitoires.
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [maxRetries=3]
 * @returns {Promise<any>}
 */
export async function fetchJsonWithBackoff(url, options = {}, maxRetries = 3) {
  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        if (response.status === 204) return null;
        const text = await response.text();
        if (!text || text.trim().length === 0) return null;
        try {
          return JSON.parse(text);
        } catch (err) {
          throw new Error(`Réponse JSON invalide depuis Intervals.icu : ${err.message}`);
        }
      }

      const isRateLimit = response.status === 429;
      const isServerErr = response.status >= 500 && response.status < 600;

      if ((isRateLimit || isServerErr) && attempt < maxRetries) {
        const retryAfter = isRateLimit
          ? parseRetryAfterMs(response.headers.get("Retry-After"))
          : null;
        const baseDelay = 400 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 250);
        const delayMs = retryAfter !== null ? retryAfter + jitter : baseDelay + jitter;
        attempt += 1;
        await sleep(delayMs, options.signal);
        continue;
      }

      let errorSnippet = "";
      try {
        errorSnippet = sanitizeText(await response.text(), 160);
      } catch {
        errorSnippet = "";
      }
      throw new Error(
        `Erreur HTTP ${response.status} Intervals.icu${errorSnippet ? ` : ${errorSnippet}` : ""}`
      );
    } catch (err) {
      const isAbort =
        err?.name === "AbortError" || Boolean(options.signal?.aborted);
      // Ne retente pas les erreurs HTTP non-transitoires déjà formatées ni les annulations
      const isFormattedHttpError =
        err instanceof Error && err.message.startsWith("Erreur HTTP ");
      const isInvalidJsonError =
        err instanceof Error &&
        err.message.startsWith("Réponse JSON invalide");

      if (
        isAbort ||
        isFormattedHttpError ||
        isInvalidJsonError ||
        attempt >= maxRetries
      ) {
        throw err;
      }

      const baseDelay = 400 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      attempt += 1;
      await sleep(baseDelay + jitter, options.signal);
    }
  }
}

/**
 * Vérifie la présence des 3 champs personnalisés `CUSTOM_ACTIVITY_FIELDS` sur
 * Intervals.icu et crée uniquement ceux qui manquent (sauf en mode `dryRun`).
 * @param {object} params
 * @param {string | number} [params.athleteId="0"]
 * @param {string} params.apiKey
 * @param {boolean} [params.dryRun=false]
 * @returns {Promise<{ checked: number, existing: string[], created: string[], errors: Array<{ code: string, error: string }>, dryRun: boolean, wouldCreate: string[] }>}
 */
export async function ensureCustomActivityFields({
  athleteId = "0",
  apiKey,
  dryRun = false,
}) {
  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);
  const endpoint = `${INTERVALS_BASE_URL}/athlete/${aid}/custom-item`;
  const isDryRun = Boolean(dryRun);

  const existingItems = await fetchJsonWithBackoff(endpoint, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  const itemsList = Array.isArray(existingItems) ? existingItems : [];
  /** @type {string[]} */
  const existing = [];
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const wouldCreate = [];
  /** @type {Array<{ code: string, error: string }>} */
  const errors = [];

  for (const def of CUSTOM_ACTIVITY_FIELDS) {
    const alreadyPresent = itemsList.some(
      (item) =>
        item?.content?.code === def.code ||
        item?.code === def.code ||
        item?.name === def.code ||
        item?.name === def.name
    );

    if (alreadyPresent) {
      existing.push(def.code);
      continue;
    }

    // En mode simulation (--dry-run), aucun POST n'est envoyé
    if (isDryRun) {
      wouldCreate.push(def.code);
      continue;
    }

    try {
      await fetchJsonWithBackoff(endpoint, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: def.name,
          item_type: "ACTIVITY_FIELD",
          content: {
            code: def.code,
            type: def.type,
            units: def.units,
            aggregate: def.aggregate,
          },
        }),
      });
      created.push(def.code);
    } catch (err) {
      errors.push({
        code: def.code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    checked: CUSTOM_ACTIVITY_FIELDS.length,
    existing,
    created,
    errors,
    dryRun: isDryRun,
    wouldCreate,
  };
}

/**
 * Formate une date en `YYYY-MM-DD` (heure locale).
 * @param {Date} dateObj
 * @returns {string}
 */
function formatLocalYmd(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Retourne une nouvelle Date décalée de `deltaDays` jours.
 * @param {Date} dateObj
 * @param {number} deltaDays
 * @returns {Date}
 */
function addDays(dateObj, deltaDays) {
  const copy = new Date(dateObj.getTime());
  copy.setDate(copy.getDate() + deltaDays);
  return copy;
}

/**
 * Extrait un nombre fini ou `null`.
 * @param {unknown} val
 * @returns {number | null}
 */
function toFiniteOrNull(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrait PVT et Handgrip depuis les champs directs ou depuis le champ `comments`
 * d'un objet wellness Intervals.icu.
 * @param {object | null} wellnessEntry
 */
function extractNeuroMetricsFromWellness(wellnessEntry) {
  if (!wellnessEntry || typeof wellnessEntry !== "object") {
    return {
      pvt_ms: null,
      pvt_lapses: null,
      handgrip_left: null,
      handgrip_right: null,
    };
  }

  let pvt_ms = toFiniteOrNull(
    wellnessEntry.PvtMedian ?? wellnessEntry.pvtMedian ?? wellnessEntry.pvt_ms
  );
  let pvt_lapses = toFiniteOrNull(
    wellnessEntry.PvtLapses ?? wellnessEntry.pvtLapses ?? wellnessEntry.pvt_lapses
  );
  let handgrip_left = toFiniteOrNull(
    wellnessEntry.HandgripGauche ??
      wellnessEntry.handgripGauche ??
      wellnessEntry.handgrip_left
  );
  let handgrip_right = toFiniteOrNull(
    wellnessEntry.HandgripDroit ??
      wellnessEntry.handgripDroit ??
      wellnessEntry.handgrip_right
  );

  const rawComments =
    typeof wellnessEntry.comments === "string" ? wellnessEntry.comments : "";

  if (rawComments) {
    // Format observé : [Neuro ...] PVT: 275ms (1/RT: ..., Lapses: 1)
    if (pvt_ms === null || pvt_lapses === null) {
      const pvtMatch = rawComments.match(
        /PVT:\s*(\d+(?:\.\d+)?)\s*ms(?:\s*\([^)]*?Lapses:\s*(\d+)\))?/i
      );
      if (pvtMatch) {
        if (pvt_ms === null) pvt_ms = toFiniteOrNull(pvtMatch[1]);
        if (pvt_lapses === null && pvtMatch[2] !== undefined) {
          pvt_lapses = toFiniteOrNull(pvtMatch[2]);
        }
      }
      if (pvt_lapses === null && /PVT:/i.test(rawComments)) {
        const lapsesMatch = rawComments.match(/Lapses:\s*(\d+)/i);
        if (lapsesMatch) pvt_lapses = toFiniteOrNull(lapsesMatch[1]);
      }
    }

    // Format observé : Handgrip: L 58kg | R 64.1kg
    if (handgrip_left === null || handgrip_right === null) {
      const hgMatch = rawComments.match(
        /Handgrip:\s*L\s*(\d+(?:\.\d+)?)\s*kg\s*\|\s*R\s*(\d+(?:\.\d+)?)\s*kg/i
      );
      if (hgMatch) {
        if (handgrip_left === null) handgrip_left = toFiniteOrNull(hgMatch[1]);
        if (handgrip_right === null) handgrip_right = toFiniteOrNull(hgMatch[2]);
      }
    }
  }

  return { pvt_ms, pvt_lapses, handgrip_left, handgrip_right };
}

/**
 * Déduit l'état de préparation neuromusculaire (`OPTIMAL`, `MODERATE`, `COMPROMISED`).
 * @param {object} params
 * @param {number | null} params.hrv_ratio
 * @param {number | null} params.pvt_lapses
 * @param {number | null} params.tsb
 * @param {number | null} params.readiness_score
 * @returns {"OPTIMAL" | "MODERATE" | "COMPROMISED"}
 */
function deduceReadiness({ hrv_ratio, pvt_lapses, tsb, readiness_score }) {
  if (
    (readiness_score !== null && readiness_score < 50) ||
    (pvt_lapses !== null && pvt_lapses >= 3) ||
    (hrv_ratio !== null && hrv_ratio < 0.85) ||
    (tsb !== null && tsb < -25)
  ) {
    return "COMPROMISED";
  }

  if (
    (readiness_score !== null && readiness_score < 75) ||
    (pvt_lapses !== null && pvt_lapses >= 1) ||
    (hrv_ratio !== null && hrv_ratio < 0.95) ||
    (tsb !== null && tsb < -10)
  ) {
    return "MODERATE";
  }

  return "OPTIMAL";
}

/**
 * Récupère en parallèle le wellness et les activités sur 7 jours (J-7 à J0) depuis
 * Intervals.icu, puis calcule l'ensemble du contexte physiologique athlète.
 * @param {object} params
 * @param {string | number} [params.athleteId="0"]
 * @param {string} params.apiKey
 * @param {Date} [params.now=new Date()]
 */
export async function fetchAthleteContext({
  athleteId = "0",
  apiKey,
  now = new Date(),
}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);

  const j0 = formatLocalYmd(nowDate);
  const j1 = formatLocalYmd(addDays(nowDate, -1));
  const j7 = formatLocalYmd(addDays(nowDate, -7));

  const headers = {
    Authorization: authHeader,
    Accept: "application/json",
  };

  const [wellnessRaw, activitiesRaw] = await Promise.all([
    fetchJsonWithBackoff(
      `${INTERVALS_BASE_URL}/athlete/${aid}/wellness?oldest=${j7}&newest=${j0}`,
      { method: "GET", headers }
    ),
    fetchJsonWithBackoff(
      `${INTERVALS_BASE_URL}/athlete/${aid}/activities?oldest=${j7}&newest=${j0}`,
      { method: "GET", headers }
    ),
  ]);

  const wellnessList = (Array.isArray(wellnessRaw) ? wellnessRaw : [])
    .filter((w) => w && typeof w === "object")
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));

  const latestWellness =
    wellnessList.find((w) => w.id === j0) ??
    (wellnessList.length > 0 ? wellnessList[wellnessList.length - 1] : null);

  const hrvValues = wellnessList
    .map((w) => toFiniteOrNull(w.hrv))
    .filter((v) => v !== null && v > 0);

  const hrv_j0 = toFiniteOrNull(latestWellness?.hrv);
  const hrv_7d_avg =
    hrvValues.length > 0
      ? Math.round(
          (hrvValues.reduce((acc, v) => acc + v, 0) / hrvValues.length) * 10
        ) / 10
      : null;
  const hrv_ratio =
    hrv_j0 !== null && hrv_7d_avg !== null && hrv_7d_avg > 0
      ? Math.round((hrv_j0 / hrv_7d_avg) * 1000) / 1000
      : null;

  const resting_hr = toFiniteOrNull(
    latestWellness?.restingHR ?? latestWellness?.resting_hr
  );
  const ctl = toFiniteOrNull(latestWellness?.ctl);
  const atl = toFiniteOrNull(latestWellness?.atl);
  const tsb =
    toFiniteOrNull(latestWellness?.tsb) ??
    (ctl !== null && atl !== null ? Math.round((ctl - atl) * 10) / 10 : null);
  const readiness_score = toFiniteOrNull(
    latestWellness?.readiness ?? latestWellness?.readinessScore
  );

  // Extraction PVT & Handgrip (du plus récent au plus ancien si absent sur J0)
  let neuro = extractNeuroMetricsFromWellness(latestWellness);
  if (
    neuro.pvt_ms === null &&
    neuro.pvt_lapses === null &&
    neuro.handgrip_left === null &&
    neuro.handgrip_right === null &&
    wellnessList.length > 1
  ) {
    for (let i = wellnessList.length - 1; i >= 0; i--) {
      const candidate = extractNeuroMetricsFromWellness(wellnessList[i]);
      if (
        candidate.pvt_ms !== null ||
        candidate.handgrip_left !== null ||
        candidate.handgrip_right !== null
      ) {
        neuro = candidate;
        break;
      }
    }
  }

  const activities = Array.isArray(activitiesRaw) ? activitiesRaw : [];

  // Métriques vélo (hier J-1 et cumul 7 jours)
  let yesterdayBikeSeconds = 0;
  let last7dBikeLoad = 0;

  for (const act of activities) {
    if (!act || !BIKE_ACTIVITY_TYPES.has(act.type)) continue;
    const actDate = String(act.start_date_local ?? act.start_date ?? "").slice(
      0,
      10
    );
    if (actDate === j1) {
      yesterdayBikeSeconds += Number(act.moving_time) || 0;
    }
    last7dBikeLoad += Number(act.icu_training_load) || 0;
  }

  const yesterday_bike_hours =
    Math.round((yesterdayBikeSeconds / 3600) * 100) / 100;
  const last_7d_bike_load = Math.round(last7dBikeLoad);

  // Dernière séance WeightTraining sur les 7 derniers jours
  const strengthActivities = activities
    .filter((act) => act && act.type === "WeightTraining")
    .sort((a, b) =>
      String(b.start_date_local ?? b.start_date ?? "").localeCompare(
        String(a.start_date_local ?? a.start_date ?? "")
      )
    );

  let lastStrengthRaw = strengthActivities[0] ?? null;
  let rawDescription = sanitizeMultilineRaw(lastStrengthRaw?.description);

  if (lastStrengthRaw && !rawDescription && lastStrengthRaw.id) {
    try {
      const detail = await fetchJsonWithBackoff(
        `${INTERVALS_BASE_URL}/activity/${encodeURIComponent(lastStrengthRaw.id)}`,
        { method: "GET", headers }
      );
      if (detail && typeof detail === "object") {
        lastStrengthRaw = { ...lastStrengthRaw, ...detail };
        rawDescription = sanitizeMultilineRaw(detail.description);
      }
    } catch {
      // Dégradation gracieuse si le détail de la séance est inaccessible
    }
  }

  let hours_since_last_eccentric = null;
  if (lastStrengthRaw?.start_date_local || lastStrengthRaw?.start_date) {
    const startMs = Date.parse(
      lastStrengthRaw.start_date_local ?? lastStrengthRaw.start_date
    );
    if (Number.isFinite(startMs)) {
      const diffHours = Math.max(0, (nowDate.getTime() - startMs) / 3600000);
      hours_since_last_eccentric = Math.round(diffHours * 10) / 10;
    }
  }

  const last_session_telemetry =
    parseTelemetryJsonFromDescription(rawDescription);
  const ALLOWED_PATTERNS = new Set([
    "KNEE_DOMINANT",
    "HIP_DOMINANT",
    "LUMBO_PELVIC",
  ]);
  const rawDominantPattern = last_session_telemetry?.dominant_pattern;
  const last_dominant_pattern = ALLOWED_PATTERNS.has(rawDominantPattern)
    ? rawDominantPattern
    : null;

  const last_strength_activity = lastStrengthRaw
    ? {
        id: lastStrengthRaw.id,
        name: sanitizeText(lastStrengthRaw.name, 120),
        start_date_local: lastStrengthRaw.start_date_local ?? null,
        moving_time: toFiniteOrNull(lastStrengthRaw.moving_time),
        icu_training_load: toFiniteOrNull(lastStrengthRaw.icu_training_load),
        Eccentric_Strain_Index: toFiniteOrNull(
          lastStrengthRaw.Eccentric_Strain_Index
        ),
        PPG_Effective_TUT: toFiniteOrNull(lastStrengthRaw.PPG_Effective_TUT),
        Strength_Compliance_Pct: toFiniteOrNull(
          lastStrengthRaw.Strength_Compliance_Pct
        ),
      }
    : null;

  const readiness = deduceReadiness({
    hrv_ratio,
    pvt_lapses: neuro.pvt_lapses,
    tsb,
    readiness_score,
  });

  return {
    fetched_at: nowDate.toISOString(),
    hrv_j0,
    hrv_7d_avg,
    hrv_ratio,
    resting_hr,
    tsb,
    ctl,
    atl,
    readiness_score,
    pvt_ms: neuro.pvt_ms,
    pvt_lapses: neuro.pvt_lapses,
    handgrip_left: neuro.handgrip_left,
    handgrip_right: neuro.handgrip_right,
    yesterday_bike_hours,
    last_7d_bike_load,
    last_strength_activity,
    hours_since_last_eccentric,
    last_session_telemetry,
    last_dominant_pattern,
    readiness,
  };
}

/**
 * Publie une activité manuelle vers `POST /api/v1/athlete/{aid}/activities/manual`.
 * @param {object} params
 * @param {string | number} [params.athleteId="0"]
 * @param {string} params.apiKey
 * @param {object} params.payload
 * @returns {Promise<any>}
 */
export async function postManualActivity({
  athleteId = "0",
  apiKey,
  payload,
}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload d'activité manuelle invalide.");
  }

  const aid = normalizeAthleteId(athleteId);
  const authHeader = buildBasicAuthHeader(apiKey);
  const endpoint = `${INTERVALS_BASE_URL}/athlete/${aid}/activities/manual`;

  return fetchJsonWithBackoff(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
}
