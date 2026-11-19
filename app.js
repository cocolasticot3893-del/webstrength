/**
 * Contrôleur principal SPA (3 étapes) et gestionnaire PWA offline-first pour WebStrength.
 * Architecture Vanilla JS ES2024+ zéro-build, manipulation DOM sécurisée (`textContent`).
 */

import {
  CATALOG,
  CUSTOM_TEMPLATES,
  exportUserExercisesJson,
  generateUserExerciseId,
  getAllCatalogExercises,
  getCatalogExercise,
  getUserExercisesList,
  loadUserExercises,
  saveUserExercise,
} from "./catalog.js";
import {
  buildManualActivityPayload,
  calculateSessionMetrics,
} from "./engine.js";
import { generateFallbackSession } from "./fallbackGenerator.js";
import {
  MODELS_CACHE_KEY,
  fetchAvailableGeminiModels,
  generateExerciseCatalogEntryWithGemini,
  generateSessionWithGemini,
  parseMarkdownWithGemini,
  pickBestAvailableModel,
} from "./geminiClient.js";
import {
  ensureCustomActivityFields,
  fetchAthleteContext,
  postManualActivity,
} from "./intervalsClient.js";
import { buildFreeSessionPlan, parseMarkdownOffline } from "./mdParser.js";
import {
  flushOutbox,
  getOutboxCount,
  enqueueActivity,
} from "./outbox.js";
import { sanitizeAndImportSvg } from "./svgHelper.js";
import {
  exportVaultJson,
  importVaultJson,
  loadVault,
  saveVault,
} from "./vault.js";

const BLOCK_TITLES = Object.freeze({
  1: "Bloc 1 : Activation & Biotenségrité",
  2: "Bloc 2 : Cœur Neuromusculaire",
  3: "Bloc 3 : Transfert Unilatéral & Anti-Rotation",
});

const BLOCK_DESCRIPTIONS = Object.freeze({
  1: "Pré-activation lombo-pelvienne, moyen fessier et rachis sans fatigue centrale.",
  2: "Surcharge excentrique / force spécifique (pôle principal de la séance).",
  3: "Stabilité unilatérale, anti-rotation et transfert vers le coup de pédale.",
});

const RULE_LABELS = Object.freeze({
  "RÈGLE_1_RED_GATE_DECHARGE": "Règle 1 · RED Gate → Zéro kBox jambes (22 min)",
  "RÈGLE_1_DELAI_EXCENTRIQUE_INF_36H": "Règle 1 · <36h depuis dernière PPG → Zéro kBox jambes",
  "RÈGLE_2_DECHARGE_LOMBAIRE_ACTIVE": "Règle 2 · Raideur lombaire → Décharge L4-L5 (Belt / Hip Thrust)",
  "RÈGLE_2_POST_VELO_SUP_4H": "Règle 2 · Vélo >4h veille → Décharge L4-L5 automatique",
  "RÈGLE_3_PLAFOND_INERTIE_0.050": "Règle 3 · Plafond inertie à 0.050 kg·m²",
  "RÈGLE_3_ORANGE_KECC_1.3_MAX3SETS": "Règle 3 · ORANGE → Max 0.050 kg·m², k_ecc 1.3, 3 séries",
  "RÈGLE_3_GREEN_OPTIMAL": "Règle 3 · GREEN + OPTIMAL → Palier 0.075 kg·m² autorisé",
  "RÈGLE_4_ALTERNANCE_KNEE_DOMINANT": "Règle 4 · Alternance → Dominante Genou (Knee)",
  "RÈGLE_4_ALTERNANCE_HIP_DOMINANT": "Règle 4 · Alternance → Dominante Hanche (Hip)",
  MODE_LIBRE: "Mode Libre · Séance personnalisée",
});

const COMPLETION_OPTIONS = Object.freeze([
  { value: 1, label: "100%" },
  { value: 0.75, label: "75%" },
  { value: 0.5, label: "50%" },
  { value: 0, label: "0%" },
]);

const KECC_PRESETS = Object.freeze([1.0, 1.3, 1.7]);
const RIR_PRESETS = Object.freeze([0.5, 2, 3, 4]);

/** Contexte physiologique par défaut si l'API est hors-ligne ou non configurée. */
function createDefaultContext() {
  return {
    fetched_at: null,
    hrv_j0: null,
    hrv_7d_avg: null,
    hrv_ratio: null,
    resting_hr: null,
    tsb: null,
    pvt_ms: null,
    pvt_lapses: null,
    handgrip_left: null,
    handgrip_right: null,
    yesterday_bike_hours: 0,
    last_7d_bike_load: 0,
    hours_since_last_eccentric: null,
    last_dominant_pattern: null,
    readiness: "OPTIMAL",
  };
}

const state = {
  currentStep: 1,
  vault: loadVault(),
  context: createDefaultContext(),
  readiness: "OPTIMAL",
  lumbar_flag: false,
  gate: "ORANGE",
  plan: null,
  sourceMeta: { source: "FALLBACK_LOCAL", model: null, fallbackReason: null },
  session: {
    exercises: [],
    k_ecc: 1.3,
    rir: 2,
    rpe: 7,
    elapsed_time_sec: 2100,
    notes: "",
    lastInteractedPole: "KBOX",
  },
  chrono: {
    seconds: 0,
    running: false,
    intervalId: null,
  },
  rest: {
    remaining: 0,
    running: false,
    intervalId: null,
  },
  lastPayload: null,
  audioCtx: null,
  guideModal: {
    speed: 1,
    playing: true,
    activeRequestId: 0,
  },
};

/** Raccourci sûr de sélection par ID. */
function $(id) {
  return document.getElementById(id);
}

/**
 * Formate un nombre de secondes en `MM:SS`.
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatMmSs(totalSeconds) {
  const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Retourne la valeur la plus proche parmi une liste de pré-réglages.
 * @param {number} value
 * @param {readonly number[]} presets
 * @returns {number}
 */
function snapToNearestPreset(value, presets) {
  const num = Number(value);
  if (!Number.isFinite(num)) return presets[0];
  let best = presets[0];
  let minDiff = Math.abs(num - best);
  for (let i = 1; i < presets.length; i++) {
    const diff = Math.abs(num - presets[i]);
    if (diff < minDiff) {
      best = presets[i];
      minDiff = diff;
    }
  }
  return best;
}

/**
 * Met à jour un message de statut textuel sans injection HTML.
 * @param {HTMLElement | null} el
 * @param {string} message
 * @param {"info" | "success" | "error"} [tone="info"]
 */
function setStatusMessage(el, message, tone = "info") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-success", "is-error");
  if (tone === "success") el.classList.add("is-success");
  if (tone === "error") el.classList.add("is-error");
}

/* ==========================================================================
   Navigation 3 étapes
   ========================================================================== */

/**
 * Affiche uniquement l'étape demandée (1, 2 ou 3).
 * @param {1 | 2 | 3} step
 */
function showStep(step) {
  state.currentStep = step;
  $("step-1").hidden = step !== 1;
  $("step-2").hidden = step !== 2;
  $("step-3").hidden = step !== 3;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================================================
   Topbar : Réseau, Outbox & Coffre-Fort
   ========================================================================== */

function updateNetworkBadge() {
  const badge = $("network-badge");
  const isOnline = navigator.onLine !== false;
  badge.textContent = isOnline ? "En ligne" : "Hors-ligne";
  badge.classList.toggle("is-online", isOnline);
  badge.classList.toggle("is-offline", !isOnline);
}

function updateServicePills() {
  const intervalsPill = $("intervals-status-pill");
  const geminiPill = $("gemini-status-pill");

  const hasIntervals = Boolean(state.vault.INTERVALS_API_KEY?.trim());
  const hasGemini = Boolean(state.vault.GEMINI_API_KEY?.trim());
  const shortModel = String(state.vault.LLM_MODEL || "gemini-3.5-flash")
    .replace(/^models\//, "")
    .replace(/^gemini-/i, "");

  intervalsPill.textContent = hasIntervals ? "Intervals : Prêt" : "Intervals : Clé —";
  intervalsPill.classList.toggle("is-ready", hasIntervals);
  intervalsPill.classList.toggle("is-muted", !hasIntervals);

  geminiPill.textContent = hasGemini ? `Gemini : ${shortModel}` : "Gemini : Local";
  geminiPill.classList.toggle("is-ready", hasGemini);
  geminiPill.classList.toggle("is-muted", !hasGemini);
}

async function refreshOutboxBadge() {
  try {
    const count = await getOutboxCount();
    $("outbox-count").textContent = String(count);
    $("outbox-flush-btn").classList.toggle("has-pending", count > 0);
  } catch {
    $("outbox-count").textContent = "0";
  }
}

async function attemptFlushOutbox({ silentIfEmpty = true } = {}) {
  const count = await getOutboxCount().catch(() => 0);
  if (count === 0) {
    if (!silentIfEmpty) {
      setStatusMessage($("context-status"), "Outbox vide : aucune séance en attente.", "success");
    }
    return;
  }

  if (navigator.onLine === false) {
    if (!silentIfEmpty) {
      setStatusMessage(
        $("context-status"),
        `Mode hors-ligne : ${count} séance(s) conservée(s) dans l'Outbox.`,
        "error"
      );
    }
    return;
  }

  const apiKey = state.vault.INTERVALS_API_KEY?.trim();
  if (!apiKey) {
    if (!silentIfEmpty) {
      setStatusMessage(
        $("context-status"),
        "Configurez INTERVALS_API_KEY dans ⚙️ pour vider l'Outbox.",
        "error"
      );
    }
    return;
  }

  try {
    const result = await flushOutbox((payload) =>
      postManualActivity({
        athleteId: state.vault.INTERVALS_ATHLETE_ID,
        apiKey,
        payload,
      })
    );
    await refreshOutboxBadge();
    if (result.sentCount > 0) {
      setStatusMessage(
        $("context-status"),
        `Synchronisation Outbox : ${result.sentCount} séance(s) envoyée(s).`,
        "success"
      );
    } else if (result.failedCount > 0) {
      setStatusMessage(
        $("context-status"),
        `Échec synchronisation Outbox (${result.errors[0]?.error ?? "erreur réseau"}).`,
        "error"
      );
    }
  } catch (err) {
    setStatusMessage(
      $("context-status"),
      `Erreur Outbox : ${err instanceof Error ? err.message : String(err)}`,
      "error"
    );
  }
}

/**
 * Lit la liste des modèles Gemini mise en cache dans `localStorage`.
 * @returns {Array<{ id: string, displayName?: string, score?: number }>}
 */
function readCachedModels() {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.models)) return parsed.models;
  } catch {
    // Stockage ou JSON indisponible : repli silencieux
  }
  return [];
}

/**
 * Enregistre la liste des modèles Gemini dans `localStorage`.
 * @param {Array<{ id: string, displayName?: string, score?: number }>} modelsList
 */
function writeCachedModels(modelsList) {
  try {
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(modelsList));
  } catch {
    // Quota dépassé ou stockage restreint
  }
}

/**
 * Peuple un élément `<select>` avec les options de modèles via DOM sécurisé
 * (`createElement` + `textContent` + `replaceChildren`).
 * @param {HTMLSelectElement | null} selectEl
 * @param {Array<string | { id?: string, displayName?: string }>} modelsList
 * @param {string} [selectedId]
 */
function renderModelOptions(selectEl, modelsList, selectedId) {
  if (!selectEl) return;

  const cleanSelected =
    typeof selectedId === "string"
      ? selectedId.replace(/^models\//, "").trim()
      : "";

  const normalized = [];
  const seen = new Set();

  if (Array.isArray(modelsList)) {
    for (const item of modelsList) {
      const rawId =
        typeof item === "string"
          ? item
          : typeof item?.id === "string"
            ? item.id
            : "";
      const id = rawId.replace(/^models\//, "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const displayName =
        typeof item === "object" &&
        typeof item?.displayName === "string" &&
        item.displayName.trim().length > 0
          ? item.displayName.trim()
          : id;
      normalized.push({ id, displayName });
    }
  }

  // Si aucune liste fournie, conserve les options statiques du HTML en garantissant `selectedId`
  if (normalized.length === 0) {
    if (
      cleanSelected &&
      !Array.from(selectEl.options).some((opt) => opt.value === cleanSelected)
    ) {
      const extraOption = document.createElement("option");
      extraOption.value = cleanSelected;
      extraOption.textContent = cleanSelected;
      selectEl.appendChild(extraOption);
    }
    if (cleanSelected) {
      selectEl.value = cleanSelected;
    }
    return;
  }

  if (cleanSelected && !seen.has(cleanSelected)) {
    normalized.push({ id: cleanSelected, displayName: cleanSelected });
    seen.add(cleanSelected);
  }

  const optionNodes = normalized.map(({ id, displayName }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    if (displayName && displayName !== id) {
      option.title = displayName;
    }
    return option;
  });

  selectEl.replaceChildren(...optionNodes);
  if (cleanSelected) {
    selectEl.value = cleanSelected;
  }
}

/**
 * Hydrate le sélecteur de modèles depuis le cache local puis interroge l'API Gemini
 * si la clé et le réseau sont disponibles, en remplaçant tout modèle obsolète.
 * Non bloquante en mode hors-ligne ou en cas d'erreur réseau.
 */
async function resolveAndSyncModelsAtStartup() {
  const selectEl = $("vault-llm-model");
  const cachedModels = readCachedModels();
  if (cachedModels.length > 0) {
    renderModelOptions(selectEl, cachedModels, state.vault.LLM_MODEL);
  } else {
    renderModelOptions(selectEl, [], state.vault.LLM_MODEL);
  }

  const apiKey = state.vault.GEMINI_API_KEY?.trim();
  if (!apiKey || navigator.onLine === false) {
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const liveModels = await fetchAvailableGeminiModels(apiKey, {
      signal: controller.signal,
    });
    if (liveModels.length === 0) {
      return;
    }

    writeCachedModels(liveModels);
    const chosenModel = pickBestAvailableModel(liveModels, state.vault.LLM_MODEL);
    if (chosenModel !== state.vault.LLM_MODEL) {
      state.vault = saveVault({ LLM_MODEL: chosenModel });
    }
    renderModelOptions(selectEl, liveModels, state.vault.LLM_MODEL);
    updateServicePills();
  } catch {
    // Échec réseau ou timeout silencieux au démarrage (mode garage)
  } finally {
    clearTimeout(timer);
  }
}

function populateVaultForm() {
  $("vault-athlete-id").value = state.vault.INTERVALS_ATHLETE_ID ?? "0";
  $("vault-intervals-key").value = state.vault.INTERVALS_API_KEY ?? "";
  $("vault-gemini-key").value = state.vault.GEMINI_API_KEY ?? "";
  const modelId = state.vault.LLM_MODEL ?? "gemini-3.5-flash";
  renderModelOptions($("vault-llm-model"), [], modelId);
  updateExportUserExercisesBtn();
}

function updateExportUserExercisesBtn() {
  const btn = $("vault-export-custom-exos-btn");
  if (!btn) return;
  const count = getUserExercisesList().length;
  btn.disabled = count === 0;
  btn.title =
    count > 0
      ? `Exporter ${count} exercice(s) promu(s)`
      : "Aucun exercice promu localement";
}

function toggleVaultDrawer(forceOpen) {
  const drawer = $("vault-drawer");
  const toggleBtn = $("vault-toggle-btn");
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : drawer.hidden;
  drawer.hidden = !nextOpen;
  toggleBtn.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    populateVaultForm();
  }
}

function setupPasswordToggle(inputId, btnId) {
  const input = $(inputId);
  const btn = $(btnId);
  btn.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    btn.textContent = isPassword ? "Masquer" : "Afficher";
  });
}

function initVaultControls() {
  $("vault-toggle-btn").addEventListener("click", () => toggleVaultDrawer());
  $("vault-close-btn").addEventListener("click", () => toggleVaultDrawer(false));
  $("intervals-status-pill").addEventListener("click", () => toggleVaultDrawer(true));
  $("gemini-status-pill").addEventListener("click", () => toggleVaultDrawer(true));

  setupPasswordToggle("vault-intervals-key", "toggle-intervals-key");
  setupPasswordToggle("vault-gemini-key", "toggle-gemini-key");

  $("vault-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const previousGeminiKey = state.vault.GEMINI_API_KEY?.trim() ?? "";
    state.vault = saveVault({
      INTERVALS_ATHLETE_ID: $("vault-athlete-id").value,
      INTERVALS_API_KEY: $("vault-intervals-key").value,
      GEMINI_API_KEY: $("vault-gemini-key").value,
      LLM_MODEL: $("vault-llm-model").value,
    });
    updateServicePills();
    setStatusMessage($("vault-feedback"), "Coffre-fort sauvegardé localement.", "success");

    const nextGeminiKey = state.vault.GEMINI_API_KEY?.trim() ?? "";
    if (nextGeminiKey && nextGeminiKey !== previousGeminiKey) {
      void resolveAndSyncModelsAtStartup();
    }

    await refreshContext();
  });

  $("refresh-models-btn").addEventListener("click", async () => {
    const apiKey =
      $("vault-gemini-key").value.trim() ||
      state.vault.GEMINI_API_KEY?.trim() ||
      "";
    if (!apiKey) {
      setStatusMessage(
        $("vault-feedback"),
        "Renseignez GEMINI_API_KEY avant d'actualiser les modèles.",
        "error"
      );
      return;
    }
    if (navigator.onLine === false) {
      setStatusMessage(
        $("vault-feedback"),
        "Impossible hors-ligne : connectez-vous pour lister les modèles.",
        "error"
      );
      return;
    }

    const btn = $("refresh-models-btn");
    btn.disabled = true;
    setStatusMessage($("vault-feedback"), "Actualisation des modèles Gemini…");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const liveModels = await fetchAvailableGeminiModels(apiKey, {
        signal: controller.signal,
      });
      if (liveModels.length === 0) {
        setStatusMessage(
          $("vault-feedback"),
          "Aucun modèle Gemini compatible trouvé sur ce compte.",
          "error"
        );
        return;
      }

      writeCachedModels(liveModels);
      const selectEl = $("vault-llm-model");
      const chosenModel = pickBestAvailableModel(
        liveModels,
        selectEl.value || state.vault.LLM_MODEL
      );
      renderModelOptions(selectEl, liveModels, chosenModel);

      if (chosenModel !== state.vault.LLM_MODEL) {
        state.vault = saveVault({ LLM_MODEL: chosenModel });
        updateServicePills();
      }

      setStatusMessage(
        $("vault-feedback"),
        `${liveModels.length} modèle(s) Gemini synchronisé(s) (sélection : ${chosenModel}).`,
        "success"
      );
    } catch (err) {
      setStatusMessage(
        $("vault-feedback"),
        `Erreur modèles Gemini : ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
    }
  });

  $("vault-export-btn").addEventListener("click", () => {
    const json = exportVaultJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `webstrength-vault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusMessage($("vault-feedback"), "Export JSON téléchargé.", "success");
  });

  $("vault-import-btn").addEventListener("click", () => {
    $("vault-import-file").click();
  });

  $("vault-export-custom-exos-btn")?.addEventListener("click", () => {
    const count = getUserExercisesList().length;
    if (count === 0) return;
    const json = exportUserExercisesJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "webstrength-custom-exercises.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(
      $("vault-feedback"),
      `Export JSON de ${count} exercice(s) téléchargé.`,
      "success"
    );
  });

  updateExportUserExercisesBtn();

  $("vault-import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      state.vault = importVaultJson(content);
      populateVaultForm();
      updateServicePills();
      setStatusMessage($("vault-feedback"), "Coffre-fort importé avec succès.", "success");
      await refreshContext();
    } catch (err) {
      setStatusMessage(
        $("vault-feedback"),
        err instanceof Error ? err.message : "Erreur import JSON.",
        "error"
      );
    } finally {
      event.target.value = "";
    }
  });

  const updateCustomFieldsStatus = (res) => {
    if (res.errors.length > 0) {
      const errSummary = res.errors.map((e) => `${e.code}: ${e.error}`).join(" | ");
      setStatusMessage(
        $("custom-fields-status"),
        `Vérifiés (${res.checked}) — Existants: ${res.existing.length}, Créés: ${res.created.length}, Erreurs: ${errSummary}`,
        "error"
      );
    } else {
      setStatusMessage(
        $("custom-fields-status"),
        `OK (${res.checked}/3) — Existants: [${res.existing.join(", ") || "aucun"}], Créés: [${res.created.join(", ") || "aucun"}]`,
        "success"
      );
    }
  };

  $("vault-check-fields-btn").addEventListener("click", async () => {
    const athleteId =
      $("vault-athlete-id").value.trim() ||
      (state.vault.INTERVALS_ATHLETE_ID ?? "").trim() ||
      "0";
    const apiKey =
      $("vault-intervals-key").value.trim() ||
      (state.vault.INTERVALS_API_KEY ?? "").trim();
    if (!apiKey) {
      setStatusMessage(
        $("custom-fields-status"),
        "Renseignez INTERVALS_API_KEY avant la vérification.",
        "error"
      );
      return;
    }
    if (navigator.onLine === false) {
      setStatusMessage(
        $("custom-fields-status"),
        "Impossible hors-ligne : connectez-vous pour vérifier Intervals.icu.",
        "error"
      );
      return;
    }

    const btn = $("vault-check-fields-btn");
    btn.disabled = true;
    setStatusMessage($("custom-fields-status"), "Vérification des 3 champs sur Intervals.icu…");

    try {
      const res = await ensureCustomActivityFields({
        athleteId,
        apiKey,
      });
      updateCustomFieldsStatus(res);
    } catch (err) {
      setStatusMessage(
        $("custom-fields-status"),
        `Erreur API Intervals.icu : ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      btn.disabled = false;
    }
  });

  $("vault-send-test-btn").addEventListener("click", async () => {
    const statusEl = $("test-workout-status");
    const athleteId =
      $("vault-athlete-id").value.trim() ||
      (state.vault.INTERVALS_ATHLETE_ID ?? "").trim();
    const apiKey =
      $("vault-intervals-key").value.trim() ||
      (state.vault.INTERVALS_API_KEY ?? "").trim();

    if (!athleteId || !apiKey) {
      setStatusMessage(
        statusEl,
        "Renseignez INTERVALS_ATHLETE_ID (ex. i763697) et INTERVALS_API_KEY avant d'envoyer une séance test.",
        "error"
      );
      return;
    }

    if (navigator.onLine === false) {
      setStatusMessage(
        statusEl,
        "Impossible hors-ligne : connectez-vous pour envoyer une séance test sur Intervals.icu.",
        "error"
      );
      return;
    }

    const btn = $("vault-send-test-btn");
    btn.disabled = true;
    setStatusMessage(statusEl, "Génération et envoi de la séance test sur Intervals.icu…");

    try {
      // Préambule : provisionne automatiquement les 3 champs personnalisés sans bloquer le test
      try {
        const fieldsRes = await ensureCustomActivityFields({ athleteId, apiKey });
        updateCustomFieldsStatus(fieldsRes);
      } catch (fieldsErr) {
        setStatusMessage(
          $("custom-fields-status"),
          `Erreur API Intervals.icu : ${fieldsErr instanceof Error ? fieldsErr.message : String(fieldsErr)}`,
          "error"
        );
      }

      const plan = generateFallbackSession({
        gate: "ORANGE",
        readiness: "OPTIMAL",
        lumbar_flag: false,
        yesterday_bike_hours: 2,
        hours_since_last_eccentric: 72,
        last_dominant_pattern: null,
      });

      const exercises = plan.exercises.map((ex) => ({
        id: ex.id,
        block: ex.block,
        sets: Number(ex.sets),
        reps: Number(ex.reps),
        load: Number(ex.load),
        completion: 1.0,
      }));

      const payload = buildManualActivityPayload({
        dateObj: new Date(),
        theme: plan.theme,
        rationale: plan.rationale,
        notes: "Séance test de validation WebStrength",
        gate: "ORANGE",
        readiness: "OPTIMAL",
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        lumbar_flag: false,
        elapsed_time_sec: 2100,
        exercises,
      });

      payload.external_id = "pwa_strength_test_sandbox";
      payload.name = "[TEST] PPG kBox [0.050] - Validation WebStrength";

      const res = await postManualActivity({
        athleteId,
        apiKey,
        payload,
      });

      const activityId = res?.id ?? payload.external_id;
      const loadVal = res?.icu_training_load ?? payload.icu_training_load;
      const strainVal = res?.EccentricStrainIndex ?? payload.EccentricStrainIndex;
      const tutVal = res?.PpgEffectiveTut ?? payload.PpgEffectiveTut;

      setStatusMessage(
        statusEl,
        `Séance test envoyée (ID: ${activityId}) — Load: ${loadVal}, EccentricStrainIndex: ${strainVal}, PpgEffectiveTut: ${tutVal}s`,
        "success"
      );
    } catch (err) {
      setStatusMessage(
        statusEl,
        `Erreur API Intervals.icu : ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    } finally {
      btn.disabled = false;
    }
  });
}

/* ==========================================================================
   Étape 1 : Contexte J0/J-7, Readiness, Switch Lombaire & Gatekeeper
   ========================================================================== */

function renderContextBanner() {
  const ctx = state.context;

  const hrvStr =
    ctx.hrv_j0 !== null && ctx.hrv_7d_avg !== null
      ? `${ctx.hrv_j0} vs ${ctx.hrv_7d_avg} ms (${ctx.hrv_ratio ?? "—"})`
      : ctx.hrv_j0 !== null
        ? `${ctx.hrv_j0} ms`
        : "—";
  $("ctx-hrv").textContent = hrvStr;

  const pvtPart =
    ctx.pvt_ms !== null
      ? `${ctx.pvt_ms}ms / ${ctx.pvt_lapses ?? 0}L`
      : "PVT —";
  const hgPart =
    ctx.handgrip_left !== null || ctx.handgrip_right !== null
      ? `${ctx.handgrip_left ?? "—"}/${ctx.handgrip_right ?? "—"} kg`
      : "HG —";
  $("ctx-neuro").textContent = `${pvtPart} · ${hgPart}`;

  $("ctx-bike").textContent = `${ctx.yesterday_bike_hours ?? 0}h · ${ctx.last_7d_bike_load ?? 0} TSS`;

  const eccHours =
    ctx.hours_since_last_eccentric !== null
      ? `${ctx.hours_since_last_eccentric}h`
      : "—";
  const pattern = ctx.last_dominant_pattern ?? "Aucune N-1";
  $("ctx-ecc").textContent = `${eccHours} · ${pattern}`;
}

function setReadiness(level) {
  const valid = ["OPTIMAL", "MODERATE", "COMPROMISED"].includes(level)
    ? level
    : "OPTIMAL";
  state.readiness = valid;
  document.querySelectorAll("[data-readiness]").forEach((btn) => {
    const active = btn.dataset.readiness === valid;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

async function refreshContext() {
  const apiKey = state.vault.INTERVALS_API_KEY?.trim();
  if (!apiKey) {
    renderContextBanner();
    setStatusMessage(
      $("context-status"),
      "Mode local : clé Intervals.icu absente (configurez-la dans ⚙️ ou démarrez en 1 tap)."
    );
    return;
  }

  if (navigator.onLine === false) {
    renderContextBanner();
    setStatusMessage(
      $("context-status"),
      "Mode garage hors-ligne : valeurs locales par défaut prêtes pour le Gatekeeper."
    );
    return;
  }

  const refreshBtn = $("refresh-context-btn");
  refreshBtn.disabled = true;
  setStatusMessage($("context-status"), "Synchronisation Intervals.icu (J0 / J-7)…");

  try {
    const fetched = await fetchAthleteContext({
      athleteId: state.vault.INTERVALS_ATHLETE_ID,
      apiKey,
    });
    state.context = fetched;
    setReadiness(fetched.readiness);
    renderContextBanner();
    const hourStr = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setStatusMessage(
      $("context-status"),
      `Contexte Intervals.icu à jour (${hourStr}) — Readiness : ${fetched.readiness}.`,
      "success"
    );
  } catch (err) {
    renderContextBanner();
    setStatusMessage(
      $("context-status"),
      `Intervals.icu indisponible (${err instanceof Error ? err.message : "erreur"}) — Repli local prêt.`,
      "error"
    );
  } finally {
    refreshBtn.disabled = false;
  }
}

/* ==========================================================================
   Chronomètre de séance & Minuteur de repos (Web Audio API + Vibration)
   ========================================================================== */

function playRestFinishAlert() {
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([220, 100, 220, 100, 320]);
    } catch {
      // Vibration ignorée
    }
  }

  const AudioContextClass =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    if (!state.audioCtx) {
      state.audioCtx = new AudioContextClass();
    }
    if (state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
    const ctx = state.audioCtx;
    const now = ctx.currentTime;

    [0, 0.22].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(idx === 0 ? 880 : 1174.66, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.24, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.17);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch {
    // Web Audio indisponible ou bloqué
  }
}

function updateChronoDisplay() {
  $("session-chrono-display").textContent = formatMmSs(state.chrono.seconds);
  $("chrono-toggle-btn").textContent = state.chrono.running ? "Pause" : "Reprendre";
}

function startChrono() {
  if (state.chrono.intervalId !== null) {
    clearInterval(state.chrono.intervalId);
  }
  state.chrono.running = true;
  updateChronoDisplay();
  state.chrono.intervalId = setInterval(() => {
    if (!state.chrono.running) return;
    state.chrono.seconds += 1;
    updateChronoDisplay();
  }, 1000);
}

function stopChrono() {
  state.chrono.running = false;
  if (state.chrono.intervalId !== null) {
    clearInterval(state.chrono.intervalId);
    state.chrono.intervalId = null;
  }
  updateChronoDisplay();
}

function updateRestDisplay() {
  const el = $("rest-timer-display");
  el.textContent = formatMmSs(state.rest.remaining);
  el.classList.toggle("is-resting", state.rest.running && state.rest.remaining > 0);
}

function stopRestTimer() {
  state.rest.running = false;
  state.rest.remaining = 0;
  if (state.rest.intervalId !== null) {
    clearInterval(state.rest.intervalId);
    state.rest.intervalId = null;
  }
  $("rest-timer-display").classList.remove("is-rest-done");
  updateRestDisplay();
}

function startRestTimer(seconds) {
  stopRestTimer();
  state.rest.remaining = Math.max(1, Math.round(seconds));
  state.rest.running = true;
  updateRestDisplay();

  state.rest.intervalId = setInterval(() => {
    if (!state.rest.running) return;
    state.rest.remaining -= 1;
    if (state.rest.remaining <= 0) {
      state.rest.remaining = 0;
      state.rest.running = false;
      clearInterval(state.rest.intervalId);
      state.rest.intervalId = null;
      updateRestDisplay();
      $("rest-timer-display").classList.add("is-rest-done");
      playRestFinishAlert();
      return;
    }
    updateRestDisplay();
  }, 1000);
}

/* ==========================================================================
   Étape 2 : Rendu des 3 Blocs, Télémétrie Live & Contrôles Globaux
   ========================================================================== */

function formatLoadOption(load, cat) {
  if (cat.pole === "KBOX") {
    return `${Number(load).toFixed(3)} ${cat.unit_label}`;
  }
  return `${load} ${cat.unit_label}`;
}

function updateLiveTelemetryBar() {
  const metrics = calculateSessionMetrics({
    exercises: state.session.exercises,
    k_ecc: state.session.k_ecc,
    rir: state.session.rir,
    rpe: state.session.rpe,
    elapsed_time_sec: state.session.elapsed_time_sec,
  });

  $("live-load").textContent = String(metrics.icu_training_load);

  const strainEl = $("live-strain");
  strainEl.textContent = String(metrics.EccentricStrainIndex);
  strainEl.classList.remove("is-strain-green", "is-strain-orange", "is-strain-red");
  if (metrics.EccentricStrainIndex > 180) {
    strainEl.classList.add("is-strain-red");
  } else if (metrics.EccentricStrainIndex >= 80) {
    strainEl.classList.add("is-strain-orange");
  } else {
    strainEl.classList.add("is-strain-green");
  }

  $("live-tut").textContent = `${metrics.PpgEffectiveTut}s (${formatMmSs(metrics.PpgEffectiveTut)})`;
  $("live-compliance").textContent = `${metrics.StrengthCompliancePct}%`;
}

function updateGlobalSelectorsUI() {
  document.querySelectorAll("[data-kecc]").forEach((btn) => {
    const val = Number(btn.dataset.kecc);
    const active = Math.abs(val - state.session.k_ecc) < 0.01;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll("[data-rir]").forEach((btn) => {
    const val = Number(btn.dataset.rir);
    const active = Math.abs(val - state.session.rir) < 0.01;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll("[data-rpe]").forEach((btn) => {
    const val = Number(btn.dataset.rpe);
    const active = val === state.session.rpe;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const mins = Math.round(state.session.elapsed_time_sec / 60);
  $("duration-display").textContent = `${formatMmSs(state.session.elapsed_time_sec)} (${mins} min)`;
}

function createExerciseCard(ex, index) {
  const cat = getCatalogExercise(ex.id);
  const displayName = ex.custom_label || cat.name;
  const isTimed = typeof ex.is_timed === "boolean" ? ex.is_timed : cat.is_timed;

  const card = document.createElement("article");
  card.className = "exercise-card";
  if (ex.completion === 0) {
    card.classList.add("is-skipped");
  }

  // En-tête exercice
  const head = document.createElement("div");
  head.className = "exo-head";

  const headTop = document.createElement("div");
  headTop.className = "exo-head-top";

  const nameEl = document.createElement("h3");
  nameEl.className = "exo-name";
  nameEl.textContent = displayName;

  if (ex.id.startsWith("CUSTOM_")) {
    const libreStack = document.createElement("div");
    libreStack.className = "exo-libre-stack";

    const libreBadge = document.createElement("span");
    libreBadge.className = "exo-libre-badge";
    libreBadge.textContent = "Libre";

    const promoteBtn = document.createElement("button");
    promoteBtn.type = "button";
    promoteBtn.className = "exo-promote-btn";
    promoteBtn.dataset.promoteIndex = String(index);
    promoteBtn.textContent = "➕ Ajouter au catalogue";
    promoteBtn.addEventListener("click", () => {
      void promoteCustomExercise(index, promoteBtn);
    });

    libreStack.append(libreBadge, promoteBtn);
    headTop.append(nameEl, libreStack);
  } else if (!cat.guide) {
    const libreBadge = document.createElement("span");
    libreBadge.className = "exo-libre-badge";
    libreBadge.textContent = "Libre";
    headTop.append(nameEl, libreBadge);
  } else {
    const guideBtn = document.createElement("button");
    guideBtn.type = "button";
    guideBtn.className = "exo-guide-btn";
    guideBtn.dataset.guideExo = cat.id;
    guideBtn.textContent = "🎬 Voir l'exo";
    guideBtn.addEventListener("click", () => {
      void openExerciseGuideModal(cat.id);
    });
    headTop.append(nameEl, guideBtn);
  }

  const badges = document.createElement("div");
  badges.className = "exo-badges";

  const poleBadge = document.createElement("span");
  poleBadge.className = cat.is_custom
    ? "exo-badge pole-CUSTOM"
    : `exo-badge pole-${cat.pole}`;
  poleBadge.textContent = cat.is_custom ? `CUSTOM · ${cat.pole}` : cat.pole;

  const patternBadge = document.createElement("span");
  patternBadge.className = "exo-badge";
  patternBadge.textContent = cat.pattern;

  badges.append(poleBadge, patternBadge);
  if (cat.is_user_catalog) {
    const persoBadge = document.createElement("span");
    persoBadge.className = "exo-badge is-user-catalog";
    persoBadge.textContent = "Perso";
    badges.append(persoBadge);
  }
  head.append(headTop, badges);

  // Description rapide & repères biomécaniques
  const descEl = document.createElement("p");
  descEl.className = "exo-desc";
  descEl.textContent = cat.short_desc ?? "";

  const metaLineEl = document.createElement("p");
  metaLineEl.className = "exo-meta-line";
  const parasiticPart =
    cat.parasitic_reps > 0 ? ` · +${cat.parasitic_reps} reps élan` : "";
  metaLineEl.textContent = `TUT: ${cat.unit_tut_sec}s/${isTimed ? "s" : "rep"} · Taxe SNC: ${cat.cns_spinal_tax}${parasiticPart}`;

  // Libellé complétion + Boutons 1-tap (100% | 75% | 50% | 0%)
  const compLabel = document.createElement("span");
  compLabel.className = "completion-label";
  compLabel.textContent = "Complétion :";

  const compRow = document.createElement("div");
  compRow.className = "completion-row";
  compRow.setAttribute("role", "group");
  compRow.setAttribute("aria-label", `Complétion ${displayName}`);

  const compButtons = [];
  for (const opt of COMPLETION_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "comp-btn";
    if (opt.value === 0) btn.classList.add("is-zero");
    if (ex.completion === opt.value) btn.classList.add("is-active");
    btn.textContent = opt.label;
    btn.setAttribute("aria-pressed", String(ex.completion === opt.value));

    btn.addEventListener("click", () => {
      state.session.exercises[index].completion = opt.value;
      state.session.lastInteractedPole = cat.pole;
      card.classList.toggle("is-skipped", opt.value === 0);
      for (const sibling of compButtons) {
        const isCurrent = sibling === btn;
        sibling.classList.toggle("is-active", isCurrent);
        sibling.setAttribute("aria-pressed", String(isCurrent));
      }
      updateLiveTelemetryBar();
    });

    compButtons.push(btn);
    compRow.appendChild(btn);
  }

  // Pilules rapides de charge (allowed_loads)
  const controlsRow = document.createElement("div");
  controlsRow.className = "exo-controls-row";

  const loadRow = document.createElement("div");
  loadRow.className = "load-pills-row";
  const loadLabel = document.createElement("span");
  loadLabel.className = "control-sub-label";
  loadLabel.textContent = "Charge :";
  loadRow.appendChild(loadLabel);

  const loadButtons = [];
  for (const allowedLoad of cat.allowed_loads) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "load-pill";
    const isSelected = Math.abs(Number(ex.load) - allowedLoad) < 1e-6;
    if (isSelected) pill.classList.add("is-active");
    pill.textContent = formatLoadOption(allowedLoad, cat);
    pill.setAttribute("aria-pressed", String(isSelected));

    pill.addEventListener("click", () => {
      state.session.exercises[index].load = allowedLoad;
      state.session.lastInteractedPole = cat.pole;
      for (const sibling of loadButtons) {
        const isCurrent = sibling === pill;
        sibling.classList.toggle("is-active", isCurrent);
        sibling.setAttribute("aria-pressed", String(isCurrent));
      }
      updateLiveTelemetryBar();
    });

    loadButtons.push(pill);
    loadRow.appendChild(pill);
  }

  // Steppers Séries et Reps/Secondes
  const steppersGrid = document.createElement("div");
  steppersGrid.className = "steppers-grid";

  const setsValueEl = document.createElement("strong");
  setsValueEl.textContent = String(ex.sets);

  const setsBox = buildStepperBox({
    label: "Séries",
    valueEl: setsValueEl,
    onDelta: (delta) => {
      const next = Math.max(0, Math.min(10, state.session.exercises[index].sets + delta));
      state.session.exercises[index].sets = next;
      state.session.lastInteractedPole = cat.pole;
      setsValueEl.textContent = String(next);
      updateLiveTelemetryBar();
    },
  });

  const repsStep = isTimed ? 5 : 1;
  const repsMax = isTimed ? 300 : 50;
  const repsValueEl = document.createElement("strong");
  repsValueEl.textContent = isTimed ? `${ex.reps}s` : String(ex.reps);

  const repsBox = buildStepperBox({
    label: isTimed ? "Durée" : "Reps",
    valueEl: repsValueEl,
    onDelta: (delta) => {
      const next = Math.max(
        0,
        Math.min(repsMax, state.session.exercises[index].reps + delta * repsStep)
      );
      state.session.exercises[index].reps = next;
      state.session.lastInteractedPole = cat.pole;
      repsValueEl.textContent = isTimed ? `${next}s` : String(next);
      updateLiveTelemetryBar();
    },
  });

  steppersGrid.append(setsBox, repsBox);
  controlsRow.append(loadRow, steppersGrid);
  card.append(head, descEl, metaLineEl, compLabel, compRow, controlsRow);
  return card;
}

function buildStepperBox({ label, valueEl, onDelta }) {
  const box = document.createElement("div");
  box.className = "stepper-box";

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "btn btn-secondary stepper-btn";
  minusBtn.textContent = "−";
  minusBtn.setAttribute("aria-label", `Diminuer ${label}`);
  minusBtn.addEventListener("click", () => onDelta(-1));

  const meta = document.createElement("div");
  meta.className = "stepper-meta";
  const lbl = document.createElement("span");
  lbl.textContent = label;
  meta.append(lbl, valueEl);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "btn btn-secondary stepper-btn";
  plusBtn.textContent = "+";
  plusBtn.setAttribute("aria-label", `Augmenter ${label}`);
  plusBtn.addEventListener("click", () => onDelta(1));

  box.append(minusBtn, meta, plusBtn);
  return box;
}

function renderStep2Plan() {
  const plan = state.plan;
  const { source, model, fallbackReason } = state.sourceMeta;

  const sourceBadge = $("plan-source-badge");
  sourceBadge.classList.remove("is-gemini", "is-fallback");
  if (source === "GEMINI") {
    sourceBadge.textContent = `Gemini AI (${model ?? "flash"})`;
    sourceBadge.classList.add("is-gemini");
    sourceBadge.title = "";
  } else if (source === "GEMINI_PARSER") {
    sourceBadge.textContent = `Gemini Parser (${model ?? "flash"})`;
    sourceBadge.classList.add("is-gemini");
    sourceBadge.title = "";
  } else if (source === "OFFLINE_PARSER") {
    sourceBadge.textContent = "Parseur Offline";
    sourceBadge.classList.add("is-fallback");
    sourceBadge.title = fallbackReason ?? "Analyse Markdown locale hors-ligne";
  } else if (source === "FREE_BUILDER" || source === "MODE_LIBRE") {
    sourceBadge.textContent = "Mode Libre";
    sourceBadge.title = "Séance libre construite manuellement";
  } else {
    sourceBadge.textContent = "Fallback Local";
    sourceBadge.classList.add("is-fallback");
    sourceBadge.title = fallbackReason ?? "Génération locale déterministe";
  }

  $("plan-theme").textContent = plan.theme;
  $("plan-rationale").textContent = plan.rationale;

  const rulesRow = $("plan-rules");
  rulesRow.replaceChildren();
  const rules = Array.isArray(plan.applied_rules) ? plan.applied_rules : [];
  if (rules.length === 0) {
    const p = document.createElement("span");
    p.className = "rule-pill";
    p.textContent = `GATE_${state.gate}`;
    rulesRow.appendChild(p);
  } else {
    for (const rule of rules) {
      const pill = document.createElement("span");
      pill.className = "rule-pill";
      pill.textContent = Object.hasOwn(RULE_LABELS, rule)
        ? RULE_LABELS[rule]
        : rule;
      rulesRow.appendChild(pill);
    }
  }

  // Rendu des Blocs (en Mode Libre, on masque les blocs vides)
  const blocksContainer = $("blocks-container");
  blocksContainer.replaceChildren();

  for (const blockNum of [1, 2, 3]) {
    const blockExercises = [];
    state.session.exercises.forEach((ex, idx) => {
      if (ex.block === blockNum) {
        blockExercises.push({ ex, idx });
      }
    });

    if (plan?.is_free_mode && blockExercises.length === 0) {
      continue;
    }

    const section = document.createElement("section");
    section.className = "block-section";

    const title = document.createElement("h2");
    title.className = "block-title";
    title.textContent = BLOCK_TITLES[blockNum];
    section.appendChild(title);

    const blockDesc = document.createElement("p");
    blockDesc.className = "block-desc";
    blockDesc.textContent = BLOCK_DESCRIPTIONS[blockNum];
    section.appendChild(blockDesc);

    for (const { ex, idx } of blockExercises) {
      section.appendChild(createExerciseCard(ex, idx));
    }

    blocksContainer.appendChild(section);
  }

  $("session-notes").value = state.session.notes;
  updateGlobalSelectorsUI();
  updateLiveTelemetryBar();
}

/**
 * Charge un plan validé (Gatekeeper, Mode Libre ou Import Markdown) dans l'Étape 2.
 * @param {object} plan
 * @param {{ source?: string, model?: string | null, fallbackReason?: string | null }} [sourceMeta]
 */
function launchPlanIntoStep2(plan, sourceMeta = {}) {
  state.plan = {
    ...plan,
    is_free_mode: Boolean(plan?.is_free_mode),
  };
  state.sourceMeta = {
    source: sourceMeta.source ?? "FALLBACK",
    model: sourceMeta.model ?? null,
    fallbackReason: sourceMeta.fallbackReason ?? null,
  };

  const exercises = (plan.exercises ?? []).map((ex) => {
    const item = {
      id: ex.id,
      block: ex.block,
      sets: Number(ex.sets),
      reps: Number(ex.reps),
      load: Number(ex.load),
      completion: 1,
    };
    if (typeof ex.custom_label === "string" && ex.custom_label.trim()) {
      item.custom_label = ex.custom_label.trim();
    }
    if (typeof ex.is_timed === "boolean") {
      item.is_timed = ex.is_timed;
    }
    return item;
  });

  const hasKbox = exercises.some(
    (ex) => getCatalogExercise(ex.id).pole === "KBOX"
  );
  const firstPole =
    exercises.length > 0 ? getCatalogExercise(exercises[0].id).pole : "KBOX";

  state.session = {
    exercises,
    k_ecc: snapToNearestPreset(plan.recommended_k_ecc, KECC_PRESETS),
    rir: snapToNearestPreset(plan.recommended_rir, RIR_PRESETS),
    rpe: Math.max(
      1,
      Math.min(10, Math.round(Number(plan.recommended_rpe) || 7))
    ),
    elapsed_time_sec: Number(plan.target_duration_sec) || 2100,
    notes: "",
    lastInteractedPole: hasKbox ? "KBOX" : firstPole,
  };

  state.chrono.seconds = 0;
  startChrono();
  stopRestTimer();
  renderStep2Plan();
  showStep(2);
}

async function handleGateSelection(gate) {
  state.gate = gate;
  const gateButtons = document.querySelectorAll("[data-gate]");
  gateButtons.forEach((b) => {
    b.disabled = true;
  });
  setStatusMessage($("generation-status"), `Génération séance ${gate} en cours…`);

  try {
    const genContext = {
      gate,
      readiness: state.readiness,
      lumbar_flag: state.lumbar_flag,
      yesterday_bike_hours: state.context.yesterday_bike_hours ?? 0,
      hours_since_last_eccentric: state.context.hours_since_last_eccentric ?? null,
      last_dominant_pattern: state.context.last_dominant_pattern ?? null,
      hrv_ratio: state.context.hrv_ratio ?? null,
      pvt_ms: state.context.pvt_ms ?? null,
      pvt_lapses: state.context.pvt_lapses ?? null,
      tsb: state.context.tsb ?? null,
    };

    const result = await generateSessionWithGemini({
      apiKey: state.vault.GEMINI_API_KEY,
      model: state.vault.LLM_MODEL || "gemini-3.5-flash",
      context: genContext,
      timeoutMs: 4000,
    });

    if (result.autoUpgradedFrom) {
      state.vault = loadVault();
      populateVaultForm();
      updateServicePills();
    }

    launchPlanIntoStep2(result.plan, {
      source: result.source,
      model: result.model ?? null,
      fallbackReason: result.fallbackReason ?? null,
    });
    setStatusMessage($("generation-status"), "");
  } finally {
    gateButtons.forEach((b) => {
      b.disabled = false;
    });
  }
}

/* ==========================================================================
   Étape 2 -> Étape 3 : Construction Payload, Push Intervals.icu & Outbox
   ========================================================================== */

async function handleSubmitSession() {
  const btn = $("submit-session-btn");
  btn.disabled = true;
  btn.textContent = "Envoi en cours…";

  try {
    const metrics = calculateSessionMetrics({
      exercises: state.session.exercises,
      k_ecc: state.session.k_ecc,
      rir: state.session.rir,
      rpe: state.session.rpe,
      elapsed_time_sec: state.session.elapsed_time_sec,
    });

    const payload = buildManualActivityPayload({
      dateObj: new Date(),
      theme: state.plan?.theme ?? "Séance WebStrength",
      rationale: state.plan?.rationale ?? "",
      notes: state.session.notes,
      gate: state.gate,
      readiness: state.readiness,
      k_ecc: state.session.k_ecc,
      rir: state.session.rir,
      rpe: state.session.rpe,
      lumbar_flag: state.lumbar_flag,
      elapsed_time_sec: state.session.elapsed_time_sec,
      exercises: state.session.exercises,
    });

    state.lastPayload = payload;
    stopChrono();
    stopRestTimer();

    const apiKey = state.vault.INTERVALS_API_KEY?.trim();
    const isOnline = navigator.onLine !== false;
    const banner = $("step3-status-banner");
    banner.classList.remove("is-ok", "is-queued");

    if (isOnline && apiKey) {
      try {
        await postManualActivity({
          athleteId: state.vault.INTERVALS_ATHLETE_ID,
          apiKey,
          payload,
        });
        banner.classList.add("is-ok");
        banner.textContent = `Séance synchronisée sur Intervals.icu (${payload.external_id}).`;
      } catch (err) {
        await enqueueActivity(payload);
        await refreshOutboxBadge();
        banner.classList.add("is-queued");
        banner.textContent = `Échec réseau/API (${err instanceof Error ? err.message : "erreur"}) — Séance sauvegardée dans l'Outbox IndexedDB pour synchronisation ultérieure.`;
      }
    } else {
      await enqueueActivity(payload);
      await refreshOutboxBadge();
      const reason = !isOnline ? "Mode hors-ligne détecté" : "Clé API Intervals.icu absente";
      banner.classList.add("is-queued");
      banner.textContent = `${reason} — Séance mise en file d'attente Outbox IndexedDB (${payload.external_id}).`;
    }

    $("step3-load").textContent = String(metrics.icu_training_load);
    $("step3-strain").textContent = `${metrics.EccentricStrainIndex} (${metrics.strain_zone})`;
    $("step3-tut").textContent = `${metrics.PpgEffectiveTut}s (${formatMmSs(metrics.PpgEffectiveTut)})`;
    $("step3-compliance").textContent = `${metrics.StrengthCompliancePct}%`;
    $("step3-payload-preview").textContent = payload.description;

    showStep(3);
  } finally {
    btn.disabled = false;
    btn.textContent = "Valider & Push Intervals.icu";
  }
}

/* ==========================================================================
   Dictée vocale optionnelle & Initialisation globale
   ========================================================================== */

function initVoiceDictation() {
  const SpeechRecognition =
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const voiceBtn = $("voice-note-btn");
  if (!SpeechRecognition) {
    voiceBtn.hidden = true;
    return;
  }

  voiceBtn.hidden = false;
  let recognition = null;
  let listening = false;

  voiceBtn.addEventListener("click", () => {
    if (listening && recognition) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      voiceBtn.textContent = "⏹️ Stop";
    };

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        const input = $("session-notes");
        const next = input.value ? `${input.value.trim()} ${transcript}` : transcript;
        input.value = next.slice(0, 240);
        state.session.notes = input.value;
      }
    };

    recognition.onerror = () => {
      listening = false;
      voiceBtn.textContent = "🎙️ Dictée";
    };

    recognition.onend = () => {
      listening = false;
      voiceBtn.textContent = "🎙️ Dictée";
    };

    recognition.start();
  });
}

function initStep1Events() {
  $("refresh-context-btn").addEventListener("click", () => refreshContext());

  document.querySelectorAll("[data-readiness]").forEach((btn) => {
    btn.addEventListener("click", () => setReadiness(btn.dataset.readiness));
  });

  const lumbarSwitch = $("lumbar-switch");
  lumbarSwitch.addEventListener("change", () => {
    state.lumbar_flag = Boolean(lumbarSwitch.checked);
    lumbarSwitch.setAttribute("aria-checked", String(state.lumbar_flag));
  });

  document.querySelectorAll("[data-gate]").forEach((btn) => {
    btn.addEventListener("click", () => handleGateSelection(btn.dataset.gate));
  });
}

function initStep2Events() {
  $("back-step1-btn").addEventListener("click", () => {
    stopChrono();
    stopRestTimer();
    showStep(1);
  });

  $("chrono-toggle-btn").addEventListener("click", () => {
    if (state.chrono.running) {
      state.chrono.running = false;
      updateChronoDisplay();
    } else if (state.chrono.intervalId === null) {
      startChrono();
    } else {
      state.chrono.running = true;
      updateChronoDisplay();
    }
  });

  $("chrono-reset-btn").addEventListener("click", () => {
    state.chrono.seconds = 0;
    updateChronoDisplay();
  });

  $("rest-auto-btn").addEventListener("click", () => {
    const autoSeconds = state.session.lastInteractedPole === "KBOX" ? 150 : 90;
    startRestTimer(autoSeconds);
  });

  document.querySelectorAll("[data-rest-sec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      startRestTimer(Number(btn.dataset.restSec));
    });
  });

  $("rest-stop-btn").addEventListener("click", () => stopRestTimer());

  document.querySelectorAll("[data-kecc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.session.k_ecc = Number(btn.dataset.kecc);
      updateGlobalSelectorsUI();
      updateLiveTelemetryBar();
    });
  });

  document.querySelectorAll("[data-rir]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.session.rir = Number(btn.dataset.rir);
      updateGlobalSelectorsUI();
      updateLiveTelemetryBar();
    });
  });

  document.querySelectorAll("[data-rpe]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.session.rpe = Number(btn.dataset.rpe);
      updateGlobalSelectorsUI();
      updateLiveTelemetryBar();
    });
  });

  $("duration-minus-btn").addEventListener("click", () => {
    state.session.elapsed_time_sec = Math.max(
      60,
      state.session.elapsed_time_sec - 60
    );
    updateGlobalSelectorsUI();
    updateLiveTelemetryBar();
  });

  $("duration-plus-btn").addEventListener("click", () => {
    state.session.elapsed_time_sec = Math.min(
      10800,
      state.session.elapsed_time_sec + 60
    );
    updateGlobalSelectorsUI();
    updateLiveTelemetryBar();
  });

  $("sync-chrono-btn").addEventListener("click", () => {
    if (state.chrono.seconds > 0) {
      state.session.elapsed_time_sec = Math.max(60, state.chrono.seconds);
      updateGlobalSelectorsUI();
      updateLiveTelemetryBar();
    }
  });

  $("session-notes").addEventListener("input", (event) => {
    state.session.notes = event.target.value;
  });

  $("submit-session-btn").addEventListener("click", () => handleSubmitSession());
  initVoiceDictation();
}

function initStep3Events() {
  $("copy-payload-btn").addEventListener("click", async () => {
    const text = state.lastPayload?.description ?? $("step3-payload-preview").textContent;
    if (!text) return;
    const btn = $("copy-payload-btn");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copié !";
      setTimeout(() => {
        btn.textContent = "Copier";
      }, 1800);
    } catch {
      btn.textContent = "Échec copie";
      setTimeout(() => {
        btn.textContent = "Copier";
      }, 1800);
    }
  });

  $("new-session-btn").addEventListener("click", () => {
    stopChrono();
    stopRestTimer();
    state.plan = null;
    state.lastPayload = null;
    showStep(1);
    refreshContext();
  });
}

/**
 * Promeut un exercice libre (`CUSTOM_*`) vers le catalogue personnel (`USER_*`)
 * avec parité biomécanique stricte et schéma SVG assaini.
 * @param {number} index
 * @param {HTMLButtonElement | null} [triggerBtn]
 */
async function promoteCustomExercise(index, triggerBtn = null) {
  const ex = state.session.exercises[index];
  if (!ex || !ex.id.startsWith("CUSTOM_")) return;

  const tpl = getCatalogExercise(ex.id);
  const displayName = (ex.custom_label || tpl.name).trim();
  const isTimed =
    typeof ex.is_timed === "boolean" ? ex.is_timed : Boolean(tpl.is_timed);
  const sourceCustomId = ex.id;
  const normalizedTargetLabel = displayName.toLowerCase();

  const originalText = triggerBtn?.textContent || "➕ Ajouter au catalogue";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "⏳ Génération…";
  }

  let succeeded = false;
  try {
    const existingUserMap = loadUserExercises();
    const newId = generateUserExerciseId(displayName, existingUserMap, tpl.pole);
    const result = await generateExerciseCatalogEntryWithGemini({
      name: displayName,
      pole: tpl.pole,
      isTimed,
      exerciseId: newId,
      apiKey: state.vault.GEMINI_API_KEY,
      model: "gemini-2.5-flash",
    });

    const candidateEntry = {
      id: newId,
      name: displayName,
      pole: tpl.pole,
      pattern: tpl.pattern,
      allowed_loads: [...tpl.allowed_loads],
      parasitic_reps: tpl.parasitic_reps,
      unit_tut_sec: tpl.unit_tut_sec,
      cns_spinal_tax: tpl.cns_spinal_tax,
      unit_label: tpl.unit_label,
      ...(tpl.beta_ecc !== undefined ? { beta_ecc: tpl.beta_ecc } : {}),
      is_timed: isTimed,
      default_sets: Math.max(1, Math.min(10, Number(ex.sets) || tpl.default_sets || 3)),
      default_reps: Math.max(1, Math.min(180, Number(ex.reps) || tpl.default_reps || 10)),
      short_desc: result.short_desc,
      guide: {
        tempo_badge: result.guide.tempo_badge,
        setup: result.guide.setup,
        execution: [...result.guide.execution],
        errors: [...result.guide.errors],
        svg_inline: result.svg_inline,
      },
      svg_inline: result.svg_inline,
    };

    const saved = saveUserExercise(candidateEntry);

    for (const item of state.session.exercises) {
      if (item.id !== sourceCustomId) continue;
      const itemLabel = (item.custom_label || tpl.name).trim().toLowerCase();
      const itemTimed =
        typeof item.is_timed === "boolean" ? item.is_timed : Boolean(tpl.is_timed);
      if (item === ex || (itemLabel === normalizedTargetLabel && itemTimed === isTimed)) {
        item.id = saved.id;
        delete item.custom_label;
      }
    }

    renderStep2Plan();
    updateExportUserExercisesBtn();

    const originLabel =
      result.source === "GEMINI_CATALOG" ? "Gemini" : "schéma offline";
    setStatusMessage(
      $("step2-promote-status"),
      `"${saved.name}" ajouté au catalogue (${originLabel}).`,
      "success"
    );
    succeeded = true;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Erreur lors de l'ajout au catalogue.";
    setStatusMessage($("step2-promote-status"), msg, "error");
  } finally {
    if (!succeeded && triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
  }
}

/**
 * Met à jour les variables CSS et l'état des contrôles de lecture de l'animation SVG.
 * @param {{ speed?: number, playing?: boolean }} [params]
 */
function setGuideAnimationState({ speed, playing } = {}) {
  if (speed !== undefined) {
    state.guideModal.speed = Number(speed) === 0.5 ? 0.5 : 1;
  }
  if (playing !== undefined) {
    state.guideModal.playing = Boolean(playing);
  }

  const stage = $("guide-svg-stage");
  if (stage) {
    stage.style.setProperty("--anim-speed", String(state.guideModal.speed));
    stage.style.setProperty("--anim-state", state.guideModal.playing ? "running" : "paused");
  }

  const playPauseBtn = $("guide-play-pause-btn");
  if (playPauseBtn) {
    const isPaused = !state.guideModal.playing;
    playPauseBtn.textContent = state.guideModal.playing ? "⏸ Pause" : "▶ Lecture";
    playPauseBtn.setAttribute("aria-pressed", String(isPaused));
    playPauseBtn.classList.toggle("is-active", isPaused);
  }

  const speed1xBtn = $("guide-speed-1x-btn");
  const speed05xBtn = $("guide-speed-05x-btn");
  const is1x = state.guideModal.speed === 1;
  if (speed1xBtn) {
    speed1xBtn.classList.toggle("is-active", is1x);
    speed1xBtn.setAttribute("aria-pressed", String(is1x));
  }
  if (speed05xBtn) {
    speed05xBtn.classList.toggle("is-active", !is1x);
    speed05xBtn.setAttribute("aria-pressed", String(!is1x));
  }
}

/**
 * Charge un fichier SVG avec priorité au cache et repli réseau standard.
 * @param {string} svgPath
 * @returns {Promise<string>}
 */
async function fetchExerciseSvgText(svgPath) {
  try {
    const cachedRes = await fetch(svgPath, { cache: "force-cache" });
    if (cachedRes.ok) {
      return await cachedRes.text();
    }
  } catch {
    // Repli sur un fetch standard si le cache échoue
  }

  const fallbackRes = await fetch(svgPath);
  if (!fallbackRes.ok) {
    throw new Error(`HTTP ${fallbackRes.status} lors du chargement de ${svgPath}`);
  }
  return await fallbackRes.text();
}

/**
 * Ouvre la modale native de guide biomécanique pour un exercice du catalogue.
 * @param {string} exerciseId
 */
async function openExerciseGuideModal(exerciseId) {
  const cat = getCatalogExercise(exerciseId);
  const displayName = cat.name;
  const guide = cat.guide;
  if (!guide) {
    setStatusMessage(
      $("step2-promote-status"),
      `Guide biomécanique indisponible pour "${displayName}".`,
      "error"
    );
    return;
  }

  const dialog = /** @type {HTMLDialogElement | null} */ ($("exercise-guide-modal"));
  if (!dialog) return;

  $("guide-modal-title").textContent = displayName;
  $("guide-tempo-badge").textContent = guide.tempo_badge;
  $("guide-setup-text").textContent = guide.setup;

  const execList = $("guide-execution-list");
  execList.replaceChildren(
    ...guide.execution.map((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    })
  );

  const errList = $("guide-errors-list");
  errList.replaceChildren(
    ...guide.errors.map((errText) => {
      const li = document.createElement("li");
      li.textContent = errText;
      return li;
    })
  );

  const ytLink = /** @type {HTMLAnchorElement} */ ($("guide-youtube-link"));
  ytLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${displayName} exercice`)}`;

  setGuideAnimationState({ speed: 1, playing: true });

  const stage = $("guide-svg-stage");
  const inlineSvg = cat.svg_inline || guide.svg_inline;
  if (typeof inlineSvg === "string" && inlineSvg.trim()) {
    ++state.guideModal.activeRequestId;
    try {
      const importedSvg = sanitizeAndImportSvg(inlineSvg);
      stage.replaceChildren(importedSvg);
    } catch {
      const errorMsg = document.createElement("p");
      errorMsg.className = "guide-svg-status";
      errorMsg.textContent = "Schéma biomécanique indisponible.";
      stage.replaceChildren(errorMsg);
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    return;
  }

  const loadingMsg = document.createElement("p");
  loadingMsg.className = "guide-svg-status";
  loadingMsg.textContent = "Chargement du schéma…";
  stage.replaceChildren(loadingMsg);

  if (!dialog.open) {
    dialog.showModal();
  }

  const reqId = ++state.guideModal.activeRequestId;
  try {
    const svgText = await fetchExerciseSvgText(guide.svg_path);
    if (reqId !== state.guideModal.activeRequestId) return;
    const importedSvg = sanitizeAndImportSvg(svgText);
    stage.replaceChildren(importedSvg);
  } catch {
    if (reqId !== state.guideModal.activeRequestId) return;
    const errorMsg = document.createElement("p");
    errorMsg.className = "guide-svg-status";
    errorMsg.textContent = "Schéma biomécanique indisponible.";
    stage.replaceChildren(errorMsg);
  }
}

/**
 * Factorise la fermeture bouton, le reset `returnValue` et le light-dismiss pour un `<dialog>`.
 * @param {HTMLDialogElement | null} dialog
 * @param {HTMLElement | null} closeBtn
 */
function setupNativeDialogDismiss(dialog, closeBtn) {
  if (!dialog) return;

  closeBtn?.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("close", () => {
    dialog.returnValue = "";
  });

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    let pointerDownOutside = false;
    const isOutsideDialog = (event) => {
      if (!dialog.open) return false;
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    dialog.addEventListener("pointerdown", (event) => {
      pointerDownOutside = event.target === dialog && isOutsideDialog(event);
    });

    dialog.addEventListener("pointerup", (event) => {
      if (pointerDownOutside && event.target === dialog && isOutsideDialog(event)) {
        dialog.close();
      }
      pointerDownOutside = false;
    });
  }
}

/**
 * Initialise les événements de fermeture, light-dismiss et contrôles de la modale guide.
 */
function initGuideModalEvents() {
  const dialog = /** @type {HTMLDialogElement | null} */ ($("exercise-guide-modal"));
  if (!dialog) return;

  setupNativeDialogDismiss(dialog, $("guide-close-btn"));

  $("guide-play-pause-btn")?.addEventListener("click", () => {
    setGuideAnimationState({ playing: !state.guideModal.playing });
  });

  $("guide-speed-1x-btn")?.addEventListener("click", () => {
    setGuideAnimationState({ speed: 1 });
  });

  $("guide-speed-05x-btn")?.addEventListener("click", () => {
    setGuideAnimationState({ speed: 0.5 });
  });
}

/**
 * Initialise la modale de construction manuelle de séance libre (catalogue + CUSTOM_*).
 */
function initFreeBuilderModal() {
  const dialog = /** @type {HTMLDialogElement | null} */ ($("free-builder-modal"));
  const openBtn = $("open-free-builder-btn");
  if (!dialog || !openBtn) return;

  setupNativeDialogDismiss(dialog, $("free-builder-close-btn"));

  const titleInput = /** @type {HTMLInputElement | null} */ ($("free-session-title"));
  const poleFilterBtns = Array.from(dialog.querySelectorAll("[data-free-pole]"));
  const catalogPicker = $("free-catalog-picker");
  const customNameInput = /** @type {HTMLInputElement | null} */ ($("custom-exo-name"));
  const customPoleSelect = /** @type {HTMLSelectElement | null} */ ($("custom-exo-pole"));
  const customLoadSelect = /** @type {HTMLSelectElement | null} */ ($("custom-exo-load"));
  const customSetsInput = /** @type {HTMLInputElement | null} */ ($("custom-exo-sets"));
  const customRepsInput = /** @type {HTMLInputElement | null} */ ($("custom-exo-reps"));
  const customTimedCheckbox = /** @type {HTMLInputElement | null} */ ($("custom-exo-timed"));
  const customAddBtn = $("custom-exo-add-btn");
  const selectedList = $("free-selected-list");
  const statusEl = $("free-builder-status");
  const launchBtn = $("free-launch-btn");

  let activePole = "ALL";
  /** @type {Array<{ id: string, sets: number, reps: number, load: number, custom_label?: string, is_timed?: boolean }>} */
  const selectedExercises = [];

  const syncCustomTemplateDefaults = () => {
    if (!customPoleSelect || !customLoadSelect) return;
    const tplId = customPoleSelect.value;
    const tpl = Object.hasOwn(CUSTOM_TEMPLATES, tplId)
      ? CUSTOM_TEMPLATES[tplId]
      : CUSTOM_TEMPLATES.CUSTOM_DUMBBELL;

    customLoadSelect.replaceChildren(
      ...tpl.allowed_loads.map((val) => {
        const opt = document.createElement("option");
        opt.value = String(val);
        opt.textContent = formatLoadOption(val, tpl);
        return opt;
      })
    );
    if (customSetsInput) customSetsInput.value = String(tpl.default_sets);
    if (customRepsInput) customRepsInput.value = String(tpl.default_reps);
    if (customTimedCheckbox) customTimedCheckbox.checked = Boolean(tpl.is_timed);
  };

  const renderSelectedList = () => {
    if (!selectedList) return;
    selectedList.replaceChildren();

    if (selectedExercises.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "free-selected-empty";
      emptyLi.textContent =
        "Aucun exercice sélectionné. Ajoutez-en depuis le catalogue ou hors-catalogue.";
      selectedList.appendChild(emptyLi);
      return;
    }

    selectedExercises.forEach((item, idx) => {
      const cat = getCatalogExercise(item.id);
      const isTimed =
        typeof item.is_timed === "boolean" ? item.is_timed : cat.is_timed;

      const li = document.createElement("li");
      li.className = "free-selected-row";

      const info = document.createElement("div");
      info.className = "free-selected-info";

      const title = document.createElement("span");
      title.className = "free-selected-title";
      title.textContent = item.custom_label || cat.name;

      const meta = document.createElement("span");
      meta.className = "free-selected-meta";
      meta.textContent = `${item.sets}×${item.reps}${isTimed ? "s" : ""} · ${formatLoadOption(item.load, cat)}`;
      info.append(title, meta);

      const controls = document.createElement("div");
      controls.className = "free-selected-controls";

      const loadSelect = document.createElement("select");
      loadSelect.className = "free-selected-load";
      loadSelect.setAttribute(
        "aria-label",
        `Charge pour ${item.custom_label || cat.name}`
      );
      for (const allowedLoad of cat.allowed_loads) {
        const opt = document.createElement("option");
        opt.value = String(allowedLoad);
        opt.textContent = formatLoadOption(allowedLoad, cat);
        if (Math.abs(allowedLoad - item.load) < 1e-6) {
          opt.selected = true;
        }
        loadSelect.appendChild(opt);
      }
      loadSelect.addEventListener("change", () => {
        selectedExercises[idx].load = Number(loadSelect.value);
        meta.textContent = `${item.sets}×${item.reps}${isTimed ? "s" : ""} · ${formatLoadOption(selectedExercises[idx].load, cat)}`;
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-ghost btn-sm";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute(
        "aria-label",
        `Retirer ${item.custom_label || cat.name}`
      );
      removeBtn.addEventListener("click", () => {
        selectedExercises.splice(idx, 1);
        renderSelectedList();
      });

      controls.append(loadSelect, removeBtn);
      li.append(info, controls);
      selectedList.appendChild(li);
    });
  };

  const renderCatalogPicker = () => {
    if (!catalogPicker) return;
    catalogPicker.replaceChildren();

    const allCatalog = getAllCatalogExercises();
    const filtered =
      activePole === "ALL"
        ? allCatalog
        : allCatalog.filter((ex) => ex.pole === activePole);

    for (const cat of filtered) {
      const row = document.createElement("div");
      row.className = "free-picker-item";

      const info = document.createElement("div");
      info.className = "free-picker-info";

      const title = document.createElement("span");
      title.className = "free-picker-title";
      title.textContent = cat.name;

      const meta = document.createElement("div");
      meta.className = "free-picker-meta";

      const poleBadge = document.createElement("span");
      poleBadge.className = `exo-badge pole-${cat.pole}`;
      poleBadge.textContent = cat.pole;

      const defaultSets = cat.default_sets ?? 3;
      const defaultReps = cat.default_reps ?? (cat.is_timed ? 45 : cat.pole === "KBOX" ? 6 : 10);

      const defaultMeta = document.createElement("span");
      defaultMeta.textContent = `${defaultSets}×${defaultReps}${cat.is_timed ? "s" : ""} · ${formatLoadOption(cat.allowed_loads[0], cat)}`;

      if (cat.is_user_catalog) {
        const persoBadge = document.createElement("span");
        persoBadge.className = "exo-badge is-user-catalog";
        persoBadge.textContent = "Perso";
        meta.append(poleBadge, persoBadge, defaultMeta);
      } else {
        meta.append(poleBadge, defaultMeta);
      }
      info.append(title, meta);

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-secondary btn-sm free-picker-add-btn";
      addBtn.textContent = "+ Ajouter";
      addBtn.addEventListener("click", () => {
        selectedExercises.push({
          id: cat.id,
          sets: defaultSets,
          reps: defaultReps,
          load: cat.allowed_loads[0],
        });
        setStatusMessage(statusEl, "");
        renderSelectedList();
      });

      row.append(info, addBtn);
      catalogPicker.appendChild(row);
    }
  };

  for (const btn of poleFilterBtns) {
    btn.addEventListener("click", () => {
      activePole = btn.dataset.freePole || "ALL";
      for (const sibling of poleFilterBtns) {
        const isCurrent = sibling === btn;
        sibling.classList.toggle("is-active", isCurrent);
        sibling.setAttribute("aria-pressed", String(isCurrent));
      }
      renderCatalogPicker();
    });
  }

  customPoleSelect?.addEventListener("change", syncCustomTemplateDefaults);

  customAddBtn?.addEventListener("click", () => {
    const rawName = customNameInput?.value.trim() ?? "";
    if (!rawName) {
      setStatusMessage(
        statusEl,
        "Saisissez un nom d'exercice personnalisé.",
        "error"
      );
      customNameInput?.focus();
      return;
    }

    const tplId = customPoleSelect?.value || "CUSTOM_DUMBBELL";
    const tpl = Object.hasOwn(CUSTOM_TEMPLATES, tplId)
      ? CUSTOM_TEMPLATES[tplId]
      : CUSTOM_TEMPLATES.CUSTOM_DUMBBELL;

    const loadVal = Number(customLoadSelect?.value);
    const load = Number.isFinite(loadVal) ? loadVal : tpl.allowed_loads[0];

    const rawSets = Math.round(Number(customSetsInput?.value));
    const sets = Number.isFinite(rawSets)
      ? Math.max(1, Math.min(10, rawSets))
      : tpl.default_sets;

    const rawReps = Math.round(Number(customRepsInput?.value));
    const reps = Number.isFinite(rawReps)
      ? Math.max(1, Math.min(300, rawReps))
      : tpl.default_reps;

    const isTimed = customTimedCheckbox
      ? Boolean(customTimedCheckbox.checked)
      : tpl.is_timed;

    selectedExercises.push({
      id: tpl.id,
      sets,
      reps,
      load,
      custom_label: rawName,
      is_timed: isTimed,
    });

    if (customNameInput) customNameInput.value = "";
    setStatusMessage(statusEl, "");
    renderSelectedList();
  });

  openBtn.addEventListener("click", () => {
    setStatusMessage(statusEl, "");
    renderCatalogPicker();
    renderSelectedList();
    if (!dialog.open) {
      dialog.showModal();
    }
  });

  launchBtn?.addEventListener("click", () => {
    if (selectedExercises.length === 0) {
      setStatusMessage(
        statusEl,
        "Ajoutez au moins un exercice avant de lancer la séance.",
        "error"
      );
      return;
    }

    try {
      const plan = buildFreeSessionPlan({
        title: titleInput?.value ?? "Séance Libre PPG / kBox",
        exercises: selectedExercises,
        sourceLabel: "Mode Libre",
        gate: state.gate,
        readiness: state.readiness,
      });
      setStatusMessage(statusEl, "");
      dialog.close();
      launchPlanIntoStep2(plan, { source: "FREE_BUILDER" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur de construction.";
      setStatusMessage(statusEl, msg, "error");
    }
  });

  syncCustomTemplateDefaults();
  renderCatalogPicker();
  renderSelectedList();
}

/**
 * Initialise la modale d'import Markdown (Gemini Parser + Parseur Rapide Offline).
 */
function initMarkdownImportModal() {
  const dialog = /** @type {HTMLDialogElement | null} */ ($("md-import-modal"));
  const openBtn = $("open-md-import-btn");
  if (!dialog || !openBtn) return;

  setupNativeDialogDismiss(dialog, $("md-import-close-btn"));

  const input = /** @type {HTMLTextAreaElement | null} */ ($("md-import-input"));
  const statusEl = $("md-import-status");
  const geminiBtn = /** @type {HTMLButtonElement | null} */ ($("md-import-gemini-btn"));
  const offlineBtn = /** @type {HTMLButtonElement | null} */ ($("md-import-offline-btn"));

  openBtn.addEventListener("click", () => {
    setStatusMessage(statusEl, "");
    if (!dialog.open) {
      dialog.showModal();
    }
  });

  offlineBtn?.addEventListener("click", () => {
    const raw = input?.value ?? "";
    if (!raw.trim()) {
      setStatusMessage(
        statusEl,
        "Collez un texte ou une liste Markdown à importer.",
        "error"
      );
      input?.focus();
      return;
    }

    try {
      const plan = parseMarkdownOffline(raw);
      setStatusMessage(statusEl, "");
      dialog.close();
      launchPlanIntoStep2(plan, {
        source: "OFFLINE_PARSER",
        fallbackReason: "Parseur rapide offline",
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Erreur lors du parsing offline.";
      setStatusMessage(statusEl, msg, "error");
    }
  });

  geminiBtn?.addEventListener("click", async () => {
    const raw = input?.value ?? "";
    if (!raw.trim()) {
      setStatusMessage(
        statusEl,
        "Collez un texte ou une liste Markdown à importer.",
        "error"
      );
      input?.focus();
      return;
    }

    if (geminiBtn) geminiBtn.disabled = true;
    if (offlineBtn) offlineBtn.disabled = true;
    setStatusMessage(statusEl, "Conversion Markdown via Gemini en cours…");

    try {
      const result = await parseMarkdownWithGemini(
        raw,
        state.vault.GEMINI_API_KEY,
        state.vault.LLM_MODEL || "gemini-3.5-flash",
        { timeoutMs: 8000 }
      );

      if (result.autoUpgradedFrom) {
        state.vault = loadVault();
        populateVaultForm();
        updateServicePills();
      }

      setStatusMessage(statusEl, "");
      dialog.close();
      launchPlanIntoStep2(result.plan, {
        source: result.source,
        model: result.model ?? null,
        fallbackReason: result.fallbackReason ?? null,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Impossible de convertir ce Markdown.";
      setStatusMessage(statusEl, msg, "error");
    } finally {
      if (geminiBtn) geminiBtn.disabled = false;
      if (offlineBtn) offlineBtn.disabled = false;
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignoré si exécuté hors contexte sécurisé / navigateur sans SW
    });
  }
}

async function bootstrap() {
  state.vault = loadVault();
  updateNetworkBadge();
  updateServicePills();
  registerServiceWorker();

  initVaultControls();
  initGuideModalEvents();
  initFreeBuilderModal();
  initMarkdownImportModal();
  initStep1Events();
  initStep2Events();
  initStep3Events();

  $("outbox-flush-btn").addEventListener("click", () => {
    attemptFlushOutbox({ silentIfEmpty: false });
  });

  window.addEventListener("online", () => {
    updateNetworkBadge();
    attemptFlushOutbox({ silentIfEmpty: true });
  });

  window.addEventListener("offline", () => {
    updateNetworkBadge();
  });

  await refreshOutboxBadge();
  void resolveAndSyncModelsAtStartup();
  refreshContext();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
