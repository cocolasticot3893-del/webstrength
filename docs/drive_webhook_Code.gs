/**
 * Webhook Google Apps Script pour recevoir les exercices personnalisés WebStrength.
 *
 * Procédure d'installation :
 * 1. Créer un projet sur script.google.com, coller ce script et définir `SHARED_SECRET`
 * 2. Cliquer sur Déployer > Nouveau déploiement > Application Web
 * 3. Exécuter en tant que : Moi ; Qui a accès : Tout le monde
 * 4. Copier l'URL `/exec` dans WebStrength ⚙️
 */

const FOLDER_ID = "";
const FOLDER_NAME = "WebStrength_Exports";
const SHARED_SECRET = "A_REMPLACER_PAR_TON_SECRET";

/**
 * Construit une réponse JSON structurée via ContentService.
 * @param {Object} payload
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function buildJsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Nettoie le nom de fichier fourni par le client tout en garantissant l'extension `.json`.
 * @param {unknown} rawFilename
 * @returns {string}
 */
function sanitizeFilename(rawFilename) {
  const fallback =
    "webstrength-custom-exercises-" +
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || "UTC",
      "yyyyMMdd-HHmmss"
    ) +
    ".json";

  if (typeof rawFilename !== "string") {
    return fallback;
  }

  let cleaned = rawFilename.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  cleaned = cleaned.replace(/^\.+/, "");

  if (!cleaned) {
    return fallback;
  }
  if (!cleaned.toLowerCase().endsWith(".json")) {
    cleaned += ".json";
  }
  return cleaned;
}

/**
 * Résout le dossier Google Drive cible par identifiant ou par nom à la racine.
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function resolveTargetFolder() {
  if (FOLDER_ID && FOLDER_ID.trim().length > 0) {
    return DriveApp.getFolderById(FOLDER_ID.trim());
  }

  const folderName =
    FOLDER_NAME && FOLDER_NAME.trim().length > 0
      ? FOLDER_NAME.trim()
      : "WebStrength_Exports";

  const existing = DriveApp.getRootFolder().getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  return DriveApp.getRootFolder().createFolder(folderName);
}

/**
 * Endpoint POST principal recevant l'export JSON des exercices personnalisés.
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== "string") {
      return buildJsonResponse({ ok: false, error: "empty_payload" });
    }

    const payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== "object") {
      return buildJsonResponse({ ok: false, error: "invalid_payload" });
    }

    if (
      SHARED_SECRET &&
      SHARED_SECRET !== "A_REMPLACER_PAR_TON_SECRET" &&
      payload.secret !== SHARED_SECRET
    ) {
      return buildJsonResponse({ ok: false, error: "unauthorized" });
    }

    const exercises = payload.exercises;
    if (!exercises || typeof exercises !== "object") {
      return buildJsonResponse({ ok: false, error: "missing_exercises" });
    }

    const count = Array.isArray(exercises)
      ? exercises.length
      : Object.keys(exercises).length;
    if (count <= 0) {
      return buildJsonResponse({ ok: false, error: "empty_exercises" });
    }

    const fileName = sanitizeFilename(payload.filename);
    const folder = resolveTargetFolder();
    const content = JSON.stringify(exercises, null, 2);
    const createdFile = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);

    return buildJsonResponse({
      ok: true,
      fileId: createdFile.getId(),
      fileName: createdFile.getName(),
      folderName: folder.getName(),
      count: count,
    });
  } catch (err) {
    return buildJsonResponse({
      ok: false,
      error: err && err.message ? String(err.message) : "internal_error",
    });
  }
}

/**
 * Endpoint GET de diagnostic vérifiant la disponibilité du webhook sans exposer de secret.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet() {
  return buildJsonResponse({
    ok: true,
    service: "WebStrength Drive Webhook",
    method: "POST_REQUIRED",
  });
}
