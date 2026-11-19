/**
 * Coffre-fort local unifié compatible avec WebNeuro et PhysioPulse.
 * Partage la clé `GLOBAL_ATHLETE_VAULT_V1` et préserve les clés tierces
 * (ex. `CP_WATTS`, `W_PRIME_J`) tout en synchronisant les 4 clés plates.
 * Compatible navigateur et Node.js 26+ ESM sans erreur.
 */

export const VAULT_KEY = "GLOBAL_ATHLETE_VAULT_V1";

export const FLAT_KEYS = Object.freeze([
  "INTERVALS_ATHLETE_ID",
  "INTERVALS_API_KEY",
  "GEMINI_API_KEY",
  "LLM_MODEL",
]);

export const DEFAULT_VAULT = Object.freeze({
  INTERVALS_ATHLETE_ID: "0",
  INTERVALS_API_KEY: "",
  GEMINI_API_KEY: "",
  LLM_MODEL: "gemini-3.5-flash",
  DRIVE_WEBHOOK_URL: "",
  DRIVE_WEBHOOK_SECRET: "",
  updatedAt: null,
});

/** Repli mémoire utilisé uniquement si `globalThis.localStorage` est indisponible (Node.js). */
const memoryFallback = new Map();

/**
 * Retourne `globalThis.localStorage` s'il est accessible sans exception, sinon `null`.
 * @returns {Storage | null}
 */
function getSafeLocalStorage() {
  try {
    if (
      typeof window === "undefined" &&
      typeof process !== "undefined" &&
      Boolean(process.versions?.node)
    ) {
      const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      const hasStorageFileFlag =
        Array.isArray(process.execArgv) &&
        process.execArgv.some((arg) => arg.startsWith("--localstorage-file"));
      if (desc && typeof desc.get === "function" && !hasStorageFileFlag) {
        return null;
      }
    }
    const ls = globalThis?.localStorage;
    if (
      ls &&
      typeof ls.getItem === "function" &&
      typeof ls.setItem === "function"
    ) {
      return ls;
    }
  } catch {
    // Contexte restreint ou Node.js sans WebStorage activé
  }
  return null;
}

/**
 * Lit une clé brute depuis `localStorage` ou le repli mémoire.
 * @param {string} key
 * @returns {string | null}
 */
function safeGetItem(key) {
  const ls = getSafeLocalStorage();
  if (ls) {
    try {
      return ls.getItem(key);
    } catch {
      return null;
    }
  }
  return memoryFallback.has(key) ? memoryFallback.get(key) : null;
}

/**
 * Écrit une clé brute dans `localStorage` ou le repli mémoire.
 * @param {string} key
 * @param {string} value
 */
function safeSetItem(key, value) {
  const ls = getSafeLocalStorage();
  if (ls) {
    try {
      ls.setItem(key, String(value));
      return;
    } catch {
      // Quota dépassé ou stockage en lecture seule : repli mémoire silencieux
    }
  }
  memoryFallback.set(key, String(value));
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copie les propriétés sûres d'un objet brut vers un objet neuf sans pollution de prototype.
 * @param {unknown} source
 * @returns {Record<string, unknown>}
 */
function copySafeProperties(source) {
  const clean = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return clean;
  }
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    Object.defineProperty(clean, key, {
      value: source[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return clean;
}

/**
 * Parse un objet JSON de manière défensive (retourne `{}` si invalide ou non-objet,
 * et filtre les clés dangereuses `__proto__`, `constructor`, `prototype`).
 * @param {string | null} raw
 * @returns {Record<string, unknown>}
 */
function parseVaultObject(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return copySafeProperties(parsed);
    }
  } catch {
    // JSON corrompu ignoré
  }
  return {};
}

/**
 * Normalise une chaîne de configuration.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeString(value, fallback) {
  if (typeof value !== "string") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Normalise les 4 clés plates et fusionne avec les clés tierces existantes.
 * @param {Record<string, unknown>} rawSource
 * @param {Record<string, unknown>} [flatFallback]
 * @returns {Record<string, unknown>}
 */
function normalizeVaultRecord(rawSource, flatFallback = {}) {
  const merged = { ...rawSource };

  const athleteIdCandidate =
    merged.INTERVALS_ATHLETE_ID ?? flatFallback.INTERVALS_ATHLETE_ID;
  const intervalsKeyCandidate =
    merged.INTERVALS_API_KEY ?? flatFallback.INTERVALS_API_KEY;
  const geminiKeyCandidate =
    merged.GEMINI_API_KEY ?? flatFallback.GEMINI_API_KEY;
  const llmModelCandidate = merged.LLM_MODEL ?? flatFallback.LLM_MODEL;

  merged.INTERVALS_ATHLETE_ID = normalizeString(
    athleteIdCandidate,
    DEFAULT_VAULT.INTERVALS_ATHLETE_ID
  );
  merged.INTERVALS_API_KEY = normalizeString(
    intervalsKeyCandidate,
    DEFAULT_VAULT.INTERVALS_API_KEY
  );
  merged.GEMINI_API_KEY = normalizeString(
    geminiKeyCandidate,
    DEFAULT_VAULT.GEMINI_API_KEY
  );
  merged.LLM_MODEL = normalizeString(
    llmModelCandidate,
    DEFAULT_VAULT.LLM_MODEL
  );
  merged.DRIVE_WEBHOOK_URL = normalizeString(
    merged.DRIVE_WEBHOOK_URL,
    DEFAULT_VAULT.DRIVE_WEBHOOK_URL
  );
  merged.DRIVE_WEBHOOK_SECRET = normalizeString(
    merged.DRIVE_WEBHOOK_SECRET,
    DEFAULT_VAULT.DRIVE_WEBHOOK_SECRET
  );

  merged.updatedAt =
    typeof merged.updatedAt === "string" && merged.updatedAt.trim().length > 0
      ? merged.updatedAt
      : null;

  return merged;
}

/**
 * Charge le coffre-fort depuis `GLOBAL_ATHLETE_VAULT_V1` en préservant les clés tierces
 * et en synchronisant avec les éventuelles clés plates présentes dans `localStorage`.
 * @returns {Record<string, unknown>}
 */
export function loadVault() {
  const existing = parseVaultObject(safeGetItem(VAULT_KEY));
  /** @type {Record<string, unknown>} */
  const flatValues = {};

  for (const key of FLAT_KEYS) {
    const val = safeGetItem(key);
    if (typeof val === "string" && val.trim().length > 0) {
      flatValues[key] = val.trim();
    }
  }

  return normalizeVaultRecord(existing, flatValues);
}

/**
 * Sauvegarde les valeurs dans `GLOBAL_ATHLETE_VAULT_V1` en préservant toutes les
 * clés tierces existantes (ex. `CP_WATTS`, `W_PRIME_J`) et en synchronisant les
 * 4 clés plates `FLAT_KEYS` dans le stockage local.
 * @param {Record<string, unknown>} [values]
 * @returns {Record<string, unknown>}
 */
export function saveVault(values = {}) {
  const current = parseVaultObject(safeGetItem(VAULT_KEY));
  const incoming = copySafeProperties(values);

  const combined = {
    ...current,
    ...incoming,
    updatedAt: new Date().toISOString(),
  };

  const normalized = normalizeVaultRecord(combined);
  safeSetItem(VAULT_KEY, JSON.stringify(normalized));

  for (const key of FLAT_KEYS) {
    safeSetItem(key, String(normalized[key] ?? ""));
  }

  return normalized;
}

/**
 * Exporte le contenu complet du coffre-fort (incluant les clés tierces) au format JSON.
 * @param {object} [options]
 * @param {boolean} [options.includeSecrets=true]
 * @returns {string}
 */
export function exportVaultJson({ includeSecrets = true } = {}) {
  const vault = loadVault();
  if (!includeSecrets) {
    vault.INTERVALS_API_KEY = "";
    vault.GEMINI_API_KEY = "";
    vault.DRIVE_WEBHOOK_SECRET = "";
  }
  return JSON.stringify(vault, null, 2);
}

/**
 * Importe un JSON de coffre-fort, le fusionne avec les clés tierces existantes,
 * normalise les clés plates et persiste le résultat.
 * @param {string} jsonText
 * @returns {Record<string, unknown>}
 */
export function importVaultJson(jsonText) {
  if (typeof jsonText !== "string" || jsonText.trim().length === 0) {
    throw new Error("Le JSON du coffre-fort est vide.");
  }

  if (jsonText.length > 65536) {
    throw new Error(
      "Le JSON du coffre-fort dépasse la taille maximale autorisée (65536 caractères)."
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`JSON de coffre-fort invalide : ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Le coffre-fort importé doit être un objet JSON valide.");
  }

  return saveVault(parsed);
}
