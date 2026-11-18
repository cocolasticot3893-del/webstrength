/**
 * Contrôleur principal SPA (3 étapes) et gestionnaire PWA offline-first pour WebStrength.
 * Architecture Vanilla JS ES2024+ zéro-build, manipulation DOM sécurisée (`textContent`).
 */

import { getCatalogExercise } from "./catalog.js";
import {
  buildManualActivityPayload,
  calculateSessionMetrics,
} from "./engine.js";
import { generateSessionWithGemini } from "./geminiClient.js";
import {
  ensureCustomActivityFields,
  fetchAthleteContext,
  postManualActivity,
} from "./intervalsClient.js";
import {
  flushOutbox,
  getOutboxCount,
  enqueueActivity,
} from "./outbox.js";
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

  intervalsPill.textContent = hasIntervals ? "Intervals : Prêt" : "Intervals : Clé —";
  intervalsPill.classList.toggle("is-ready", hasIntervals);
  intervalsPill.classList.toggle("is-muted", !hasIntervals);

  geminiPill.textContent = hasGemini ? "Gemini : Prêt" : "Gemini : Local";
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

function populateVaultForm() {
  $("vault-athlete-id").value = state.vault.INTERVALS_ATHLETE_ID ?? "0";
  $("vault-intervals-key").value = state.vault.INTERVALS_API_KEY ?? "";
  $("vault-gemini-key").value = state.vault.GEMINI_API_KEY ?? "";
  $("vault-llm-model").value = state.vault.LLM_MODEL ?? "gemini-2.5-flash";
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

  setupPasswordToggle("vault-intervals-key", "toggle-intervals-key");
  setupPasswordToggle("vault-gemini-key", "toggle-gemini-key");

  $("vault-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.vault = saveVault({
      INTERVALS_ATHLETE_ID: $("vault-athlete-id").value,
      INTERVALS_API_KEY: $("vault-intervals-key").value,
      GEMINI_API_KEY: $("vault-gemini-key").value,
      LLM_MODEL: $("vault-llm-model").value,
    });
    updateServicePills();
    setStatusMessage($("vault-feedback"), "Coffre-fort sauvegardé localement.", "success");
    await refreshContext();
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

  $("vault-check-fields-btn").addEventListener("click", async () => {
    const apiKey = state.vault.INTERVALS_API_KEY?.trim();
    if (!apiKey) {
      setStatusMessage(
        $("custom-fields-status"),
        "Renseignez et sauvegardez INTERVALS_API_KEY avant la vérification.",
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
        athleteId: state.vault.INTERVALS_ATHLETE_ID,
        apiKey,
      });
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
  strainEl.textContent = String(metrics.Eccentric_Strain_Index);
  strainEl.classList.remove("is-strain-green", "is-strain-orange", "is-strain-red");
  if (metrics.Eccentric_Strain_Index > 180) {
    strainEl.classList.add("is-strain-red");
  } else if (metrics.Eccentric_Strain_Index >= 80) {
    strainEl.classList.add("is-strain-orange");
  } else {
    strainEl.classList.add("is-strain-green");
  }

  $("live-tut").textContent = `${metrics.PPG_Effective_TUT}s (${formatMmSs(metrics.PPG_Effective_TUT)})`;
  $("live-compliance").textContent = `${metrics.Strength_Compliance_Pct}%`;
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

  const card = document.createElement("article");
  card.className = "exercise-card";
  if (ex.completion === 0) {
    card.classList.add("is-skipped");
  }

  // En-tête exercice
  const head = document.createElement("div");
  head.className = "exo-head";

  const nameEl = document.createElement("h3");
  nameEl.className = "exo-name";
  nameEl.textContent = cat.name;

  const badges = document.createElement("div");
  badges.className = "exo-badges";

  const poleBadge = document.createElement("span");
  poleBadge.className = `exo-badge pole-${cat.pole}`;
  poleBadge.textContent = cat.pole;

  const patternBadge = document.createElement("span");
  patternBadge.className = "exo-badge";
  patternBadge.textContent = cat.pattern;

  badges.append(poleBadge, patternBadge);
  head.append(nameEl, badges);

  // Boutons complétion 1-tap (100% | 75% | 50% | 0%)
  const compRow = document.createElement("div");
  compRow.className = "completion-row";
  compRow.setAttribute("role", "group");
  compRow.setAttribute("aria-label", `Complétion ${cat.name}`);

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

  const repsStep = cat.is_timed ? 5 : 1;
  const repsMax = cat.is_timed ? 300 : 50;
  const repsValueEl = document.createElement("strong");
  repsValueEl.textContent = cat.is_timed ? `${ex.reps}s` : String(ex.reps);

  const repsBox = buildStepperBox({
    label: cat.is_timed ? "Durée" : "Reps",
    valueEl: repsValueEl,
    onDelta: (delta) => {
      const next = Math.max(
        0,
        Math.min(repsMax, state.session.exercises[index].reps + delta * repsStep)
      );
      state.session.exercises[index].reps = next;
      state.session.lastInteractedPole = cat.pole;
      repsValueEl.textContent = cat.is_timed ? `${next}s` : String(next);
      updateLiveTelemetryBar();
    },
  });

  steppersGrid.append(setsBox, repsBox);
  controlsRow.append(loadRow, steppersGrid);
  card.append(head, compRow, controlsRow);
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
  if (source === "GEMINI") {
    sourceBadge.textContent = `Gemini AI (${model ?? "flash"})`;
    sourceBadge.classList.add("is-gemini");
    sourceBadge.classList.remove("is-fallback");
    sourceBadge.title = "";
  } else {
    sourceBadge.textContent = "Fallback Local";
    sourceBadge.classList.add("is-fallback");
    sourceBadge.classList.remove("is-gemini");
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
      pill.textContent = rule;
      rulesRow.appendChild(pill);
    }
  }

  // Rendu des 3 Blocs
  const blocksContainer = $("blocks-container");
  blocksContainer.replaceChildren();

  for (const blockNum of [1, 2, 3]) {
    const section = document.createElement("section");
    section.className = "block-section";

    const title = document.createElement("h2");
    title.className = "block-title";
    title.textContent = BLOCK_TITLES[blockNum];
    section.appendChild(title);

    state.session.exercises.forEach((ex, idx) => {
      if (ex.block === blockNum) {
        section.appendChild(createExerciseCard(ex, idx));
      }
    });

    blocksContainer.appendChild(section);
  }

  $("session-notes").value = state.session.notes;
  updateGlobalSelectorsUI();
  updateLiveTelemetryBar();
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
      model: state.vault.LLM_MODEL || "gemini-2.5-flash",
      context: genContext,
      timeoutMs: 4000,
    });

    state.plan = result.plan;
    state.sourceMeta = {
      source: result.source,
      model: result.model ?? null,
      fallbackReason: result.fallbackReason ?? null,
    };

    state.session = {
      exercises: result.plan.exercises.map((ex) => ({
        id: ex.id,
        block: ex.block,
        sets: Number(ex.sets),
        reps: Number(ex.reps),
        load: Number(ex.load),
        completion: 1,
      })),
      k_ecc: snapToNearestPreset(result.plan.recommended_k_ecc, KECC_PRESETS),
      rir: snapToNearestPreset(result.plan.recommended_rir, RIR_PRESETS),
      rpe: Math.max(1, Math.min(10, Math.round(Number(result.plan.recommended_rpe) || 7))),
      elapsed_time_sec: Number(result.plan.target_duration_sec) || 2100,
      notes: "",
      lastInteractedPole: "KBOX",
    };

    state.chrono.seconds = 0;
    startChrono();
    stopRestTimer();
    renderStep2Plan();
    setStatusMessage($("generation-status"), "");
    showStep(2);
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
    $("step3-strain").textContent = `${metrics.Eccentric_Strain_Index} (${metrics.strain_zone})`;
    $("step3-tut").textContent = `${metrics.PPG_Effective_TUT}s (${formatMmSs(metrics.PPG_Effective_TUT)})`;
    $("step3-compliance").textContent = `${metrics.Strength_Compliance_Pct}%`;
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
  refreshContext();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
