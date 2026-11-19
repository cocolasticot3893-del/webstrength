/**
 * Module de synchronisation des exercices personnalisés vers Google Drive
 * via un webhook Google Apps Script (CORS simple request sans preflight).
 * Zéro dépendance externe — compatible navigateur et Node.js 26+ ESM.
 */

export const DRIVE_APP_VERSION = "1.8.0";

/**
 * Résultat de validation d'une URL de webhook Google Drive.
 * @typedef {Object} DriveWebhookValidationResult
 * @property {boolean} valid Indique si l'URL est utilisable en HTTPS sans identifiants intégrés.
 * @property {string} url URL nettoyée ou chaîne vide si absente.
 * @property {boolean} isAppsScript Indique si l'URL cible un déploiement Google Apps Script (`/macros/s/`).
 * @property {string | null} error Message d'erreur en français ou `null` si valide.
 */

/**
 * Paramètres d'envoi des exercices personnalisés vers Google Drive.
 * @typedef {Object} PushCustomExercisesOptions
 * @property {string} webhookUrl URL HTTPS du webhook cible.
 * @property {string} [secret=""] Secret partagé optionnel transmis dans le corps JSON.
 * @property {string | Array<unknown> | Record<string, unknown>} exercisesJson Chaîne JSON ou structure d'exercices non vide.
 * @property {typeof globalThis.fetch} [fetchImpl=globalThis.fetch] Implémentation `fetch` injectable pour les tests.
 * @property {number} [timeoutMs=15000] Délai d'expiration réseau en millisecondes (plancher à 50 ms).
 * @property {Date} [now=new Date()] Horodatage utilisé pour nommer et tracer l'export.
 */

/**
 * Réponse normalisée d'un envoi réussi vers Google Drive.
 * @typedef {Object} PushCustomExercisesResult
 * @property {true} ok Confirmation de succès de l'export.
 * @property {string} fileId Identifiant du fichier créé sur Google Drive.
 * @property {string} fileName Nom effectif du fichier créé.
 * @property {string} folderName Nom du dossier Google Drive cible.
 * @property {number} count Nombre d'exercices exportés.
 */

/**
 * Formate un entier sur 2 chiffres avec zéro initial.
 * @param {number} value
 * @returns {string}
 */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Valide l'URL d'un webhook Google Drive (HTTPS strict, sans identifiants intégrés).
 * @param {unknown} url
 * @returns {DriveWebhookValidationResult}
 */
export function validateDriveWebhookUrl(url) {
  if (typeof url !== "string") {
    return {
      valid: false,
      url: "",
      isAppsScript: false,
      error: "L'URL du webhook Google Drive doit être une chaîne de caractères.",
    };
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      url: "",
      isAppsScript: false,
      error: "L'URL du webhook Google Drive est vide.",
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive est malformée.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive doit utiliser le protocole HTTPS.",
    };
  }

  if (!parsed.hostname) {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive ne contient pas de nom d'hôte valide.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      url: trimmed,
      isAppsScript: false,
      error: "L'URL du webhook Google Drive ne doit pas contenir d'identifiants intégrés.",
    };
  }

  const isAppsScript =
    parsed.hostname === "script.google.com" &&
    parsed.pathname.startsWith("/macros/s/");

  return {
    valid: true,
    url: trimmed,
    isAppsScript,
    error: null,
  };
}

/**
 * Construit le nom de fichier horodaté en heure locale pour l'export Drive.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function buildDriveExportFilename(date = new Date()) {
  const safeDate =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();

  const year = String(safeDate.getFullYear());
  const month = pad2(safeDate.getMonth() + 1);
  const day = pad2(safeDate.getDate());
  const hours = pad2(safeDate.getHours());
  const minutes = pad2(safeDate.getMinutes());
  const seconds = pad2(safeDate.getSeconds());

  return `webstrength-custom-exercises-${year}${month}${day}-${hours}${minutes}${seconds}.json`;
}

/**
 * Analyse et valide la structure des exercices personnalisés à exporter.
 * @param {unknown} exercisesJson
 * @returns {{ parsed: Array<unknown> | Record<string, unknown>, count: number }}
 */
function parseAndCountExercises(exercisesJson) {
  let parsed = exercisesJson;
  if (typeof exercisesJson === "string") {
    try {
      parsed = JSON.parse(exercisesJson);
    } catch (err) {
      throw new Error(
        `Le JSON des exercices personnalisés est invalide : ${err.message}`
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Aucun exercice personnalisé à envoyer sur Drive.");
  }

  const count = Array.isArray(parsed)
    ? parsed.length
    : Object.keys(parsed).length;

  if (count <= 0) {
    throw new Error("Aucun exercice personnalisé à envoyer sur Drive.");
  }

  return {
    parsed: /** @type {Array<unknown> | Record<string, unknown>} */ (parsed),
    count,
  };
}

/**
 * Envoie les exercices personnalisés vers le webhook Google Drive via une requête CORS simple.
 * @param {PushCustomExercisesOptions} [options]
 * @returns {Promise<PushCustomExercisesResult>}
 */
export async function pushCustomExercisesToDrive({
  webhookUrl,
  secret = "",
  exercisesJson,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  now = new Date(),
} = {}) {
  const check = validateDriveWebhookUrl(webhookUrl);
  if (!check.valid) {
    throw new Error(check.error || "URL de webhook Google Drive invalide.");
  }

  const { parsed, count } = parseAndCountExercises(exercisesJson);

  if (typeof fetchImpl !== "function") {
    throw new Error("Client fetch indisponible pour l'envoi vers Google Drive.");
  }

  const safeNow =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const filename = buildDriveExportFilename(safeNow);
  const effectiveTimeoutMs = Math.max(50, Number(timeoutMs) || 15000);

  const controller = new AbortController();
  let timedOut = false;
  const timerId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);

  let response;
  try {
    // Requête CORS simple sans préflight OPTIONS : text/plain + aucun en-tête personnalisé.
    response = await fetchImpl(check.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
      signal: controller.signal,
      body: JSON.stringify({
        secret: String(secret ?? "").trim(),
        filename,
        exported_at: safeNow.toISOString(),
        app_version: DRIVE_APP_VERSION,
        exercises: parsed,
      }),
    });
  } catch (err) {
    if (timedOut || (err && err.name === "AbortError")) {
      throw new Error(
        `Timeout webhook Google Drive dépassé (${effectiveTimeoutMs} ms).`
      );
    }
    const reason = err instanceof Error && err.message ? err.message : String(err);
    throw new Error(
      `Échec réseau lors de l'envoi vers le webhook Google Drive : ${reason}`
    );
  } finally {
    clearTimeout(timerId);
  }

  if (!response.ok) {
    throw new Error(
      `Erreur HTTP du webhook Google Drive (${response.status}${response.statusText ? ` ${response.statusText}` : ""}).`
    );
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      "Réponse non-JSON reçue du webhook Google Drive (vérifiez le déploiement et les accès Apps Script)."
    );
  }

  if (!data || data.ok !== true) {
    throw new Error(data?.error || "Réponse négative du webhook Google Drive");
  }

  return {
    ok: true,
    fileId: String(data.fileId ?? ""),
    fileName: String(data.fileName ?? filename),
    folderName: String(data.folderName ?? ""),
    count: Number(data.count ?? count),
  };
}
