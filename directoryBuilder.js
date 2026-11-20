/**
 * Constructeur de séances libres depuis le Catalogue Complet WebStrength.
 * Module ESM pur sans aucune dépendance DOM.
 */

import { getCatalogExercise } from "./catalog.js";
import { calculateSessionMetrics } from "./engine.js";
import { buildFreeSessionPlan, snapLoadToTemplate } from "./mdParser.js";

let draftUidCounter = 0;

/**
 * Génère un identifiant unique déterministe pour un élément du brouillon.
 * @returns {string}
 */
function nextDraftUid() {
  draftUidCounter += 1;
  return `draft_${draftUidCounter}`;
}

/**
 * Borne un entier fini dans `[min, max]` avec valeur de repli.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * Nettoie une chaîne de texte (balises, caractères de contrôle, pipes `|`).
 * @param {unknown} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function cleanInlineText(value, maxLen = 120) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
}

/**
 * Normalise un item du brouillon vis-à-vis de sa définition catalogue.
 * @param {Record<string, any>} item
 */
function normalizeDraftItem(item) {
  const cat = getCatalogExercise(item?.id);
  const defaultSets = cat.default_sets ?? 3;
  const defaultReps = cat.default_reps ?? (cat.is_timed ? 45 : 10);
  const sets = clampInt(item?.sets, 1, 10, defaultSets);
  const reps = clampInt(item?.reps, 1, 300, defaultReps);
  const load = snapLoadToTemplate(
    item?.load !== undefined && item?.load !== null
      ? item.load
      : cat.allowed_loads?.[0] ?? 0,
    cat
  );
  const is_timed =
    typeof item?.is_timed === "boolean"
      ? item.is_timed
      : Boolean(cat.is_timed);

  return { cat, sets, reps, load, is_timed };
}

/**
 * Crée un élément de brouillon initialisé depuis le catalogue officiel ou étendu.
 * @param {string} exerciseId
 * @returns {{ uid: string, id: string, sets: number, reps: number, load: number, is_timed: boolean }}
 */
export function createDirectoryDraftItem(exerciseId) {
  const cat = getCatalogExercise(exerciseId);
  return {
    uid: nextDraftUid(),
    id: cat.id,
    sets: cat.default_sets ?? 3,
    reps: cat.default_reps ?? (cat.is_timed ? 45 : 10),
    load: cat.allowed_loads?.[0] ?? 0,
    is_timed: Boolean(cat.is_timed),
  };
}

/**
 * Ajoute un exercice à la fin du brouillon sans muter le tableau d'entrée.
 * @param {Array<Record<string, any>>} draft
 * @param {string} exerciseId
 * @returns {Array<Record<string, any>>}
 */
export function addDraftExercise(draft, exerciseId) {
  const list = Array.isArray(draft) ? draft : [];
  return [...list, createDirectoryDraftItem(exerciseId)];
}

/**
 * Supprime l'exercice à l'index donné (retourne une copie inchangée si hors bornes).
 * @param {Array<Record<string, any>>} draft
 * @param {number} index
 * @returns {Array<Record<string, any>>}
 */
export function removeDraftExercise(draft, index) {
  const list = Array.isArray(draft) ? draft : [];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return [...list];
  }
  return list.filter((_, idx) => idx !== index);
}

/**
 * Déplace un exercice d'un cran (`delta` = `-1` ou `+1`) dans un nouveau tableau.
 * @param {Array<Record<string, any>>} draft
 * @param {number} index
 * @param {number} delta
 * @returns {Array<Record<string, any>>}
 */
export function moveDraftExercise(draft, index, delta) {
  const list = Array.isArray(draft) ? draft : [];
  const target = index + delta;
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(delta) ||
    delta === 0 ||
    index < 0 ||
    index >= list.length ||
    target < 0 ||
    target >= list.length
  ) {
    return [...list];
  }
  const next = [...list];
  const currentItem = next[index];
  next[index] = next[target];
  next[target] = currentItem;
  return next;
}

/**
 * Met à jour un exercice du brouillon en bornant sets/reps et en alignant la charge.
 * @param {Array<Record<string, any>>} draft
 * @param {number} index
 * @param {{ sets?: number, reps?: number, load?: number, is_timed?: boolean }} patch
 * @returns {Array<Record<string, any>>}
 */
export function updateDraftExercise(draft, index, patch) {
  const list = Array.isArray(draft) ? draft : [];
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= list.length ||
    !patch ||
    typeof patch !== "object"
  ) {
    return [...list];
  }

  const current = list[index];
  const cat = getCatalogExercise(current.id);
  const currentSets = clampInt(current.sets, 1, 10, cat.default_sets ?? 3);
  const currentReps = clampInt(
    current.reps,
    1,
    300,
    cat.default_reps ?? (cat.is_timed ? 45 : 10)
  );

  const sets =
    patch.sets !== undefined
      ? clampInt(patch.sets, 1, 10, currentSets)
      : currentSets;
  const reps =
    patch.reps !== undefined
      ? clampInt(patch.reps, 1, 300, currentReps)
      : currentReps;
  const load =
    patch.load !== undefined
      ? snapLoadToTemplate(patch.load, cat)
      : snapLoadToTemplate(current.load ?? cat.allowed_loads?.[0] ?? 0, cat);
  const is_timed =
    typeof patch.is_timed === "boolean"
      ? patch.is_timed
      : Boolean(current.is_timed);

  const next = [...list];
  next[index] = {
    ...current,
    sets,
    reps,
    load,
    is_timed,
  };
  return next;
}

/**
 * Résume les métriques biomécaniques et signale d'éventuels repères de vigilance.
 * @param {Array<Record<string, any>>} draft
 */
export function summarizeDirectoryDraft(draft) {
  const list = Array.isArray(draft) ? draft : [];
  if (list.length === 0) {
    return {
      exerciseCount: 0,
      totalSets: 0,
      estimatedMinutes: 0,
      estimatedStrain: 0,
      plyoVelocityCount: 0,
      plyoVelocityRatio: 0,
      vigilanceHints: [],
    };
  }

  let totalSets = 0;
  let totalElapsedSec = 0;
  let plyoVelocityCount = 0;
  const metricExercises = [];

  for (const item of list) {
    const { cat, sets, reps, load, is_timed } = normalizeDraftItem(item);
    const unitTutSec = Number(cat.unit_tut_sec) || (is_timed ? 1 : 2.5);
    const parasiticReps = Number(cat.parasitic_reps) || 0;
    const tutSec = sets * (reps + 0.3 * parasiticReps) * unitTutSec;

    const restPerSetSec =
      cat.pole === "BAND_CORE"
        ? 45
        : cat.category === "PLYOMETRICS" || cat.category === "VELOCITY"
          ? 90
          : 75;

    // Temps actif + récupération inter-séries + transition d'atelier
    const itemElapsedSec = tutSec + Math.max(0, sets - 1) * restPerSetSec + 45;

    totalSets += sets;
    totalElapsedSec += itemElapsedSec;

    if (
      cat.category === "PLYOMETRICS" ||
      cat.category === "VELOCITY" ||
      cat.pattern === "PLYO" ||
      cat.pattern === "VELOCITY"
    ) {
      plyoVelocityCount += 1;
    }

    metricExercises.push({
      id: cat.id,
      sets,
      reps,
      load,
      completion: 1,
      is_timed,
    });
  }

  const elapsed_time_sec = Math.max(60, Math.round(totalElapsedSec));
  const metrics = calculateSessionMetrics({
    exercises: metricExercises,
    k_ecc: 1.3,
    rir: 2,
    rpe: 7,
    elapsed_time_sec,
  });

  const exerciseCount = metricExercises.length;
  const estimatedMinutes = Math.max(1, Math.round(elapsed_time_sec / 60));
  const estimatedStrain = metrics.EccentricStrainIndex;
  const plyoVelocityRatio =
    exerciseCount > 0 ? plyoVelocityCount / exerciseCount : 0;

  /** @type {string[]} */
  const vigilanceHints = [];
  if (
    (plyoVelocityCount >= 2 && plyoVelocityRatio >= 0.5) ||
    plyoVelocityCount >= 3
  ) {
    vigilanceHints.push(
      "Forte densité pliométrie / vélocité : veiller à une récupération complète entre séries et à la qualité des appuis."
    );
  }
  if (estimatedStrain > 180) {
    vigilanceHints.push(
      "Indice de contrainte excentrique élevé (> 180) : surveiller la récupération musculo-tendineuse et ajuster le volume si besoin."
    );
  }
  if (totalSets > 24) {
    vigilanceHints.push(
      "Volume global important (> 24 séries) : surveiller la dérive technique et la fatigue en fin de séance."
    );
  }

  return {
    exerciseCount,
    totalSets,
    estimatedMinutes,
    estimatedStrain,
    plyoVelocityCount,
    plyoVelocityRatio,
    vigilanceHints,
  };
}

/**
 * Formate la charge d'un exercice pour garantir un aller-retour exact avec `parseMarkdownOffline`.
 * @param {number} load
 * @param {Record<string, any>} cat
 * @returns {string}
 */
function formatLoadForMarkdown(load, cat) {
  if (cat.pole === "KBOX") {
    return `${Number(load).toFixed(3)} kg·m²`;
  }
  if (cat.pole === "BAND_CORE" && cat.unit_label !== "kg") {
    return `${load} niv`;
  }
  return `${load} kg`;
}

/**
 * Exporte un brouillon de séance au format Markdown structuré (compatible `parsePipeLine`).
 * @param {Array<Record<string, any>>} draft
 * @param {string} [title]
 * @returns {string}
 */
export function exportDirectoryDraftToMarkdown(
  draft,
  title = "Séance Catalogue PPG"
) {
  const cleanTitle = cleanInlineText(title, 80) || "Séance Catalogue PPG";
  const list = Array.isArray(draft) ? draft : [];

  const lines = [`# ${cleanTitle}`];
  for (const item of list) {
    const { cat, sets, reps, load, is_timed } = normalizeDraftItem(item);
    const cleanName = cleanInlineText(cat.name ?? cat.id, 120) || cat.id;
    const volumeStr = `${sets}x${reps}${is_timed ? "s" : ""}`;
    const loadStr = formatLoadForMarkdown(load, cat);
    lines.push(`- ${cat.id} | ${cleanName} | ${volumeStr} | ${loadStr}`);
  }

  return lines.join("\n");
}

/**
 * Construit le plan de séance complet prêt pour exécution UI / moteur.
 * @param {Array<Record<string, any>>} draft
 * @param {{ title?: string, gate?: string, readiness?: string }} [options]
 */
export function buildDirectorySessionPlan(
  draft,
  { title, gate, readiness } = {}
) {
  const list = Array.isArray(draft) ? draft : [];
  const cleanTitle = cleanInlineText(title, 80);
  const exercises = list.map((item) => {
    const { cat, sets, reps, load, is_timed } = normalizeDraftItem(item);
    return {
      id: cat.id,
      sets,
      reps,
      load,
      is_timed,
    };
  });

  return buildFreeSessionPlan({
    title: cleanTitle || "Séance Catalogue PPG",
    exercises,
    sourceLabel: "Catalogue Complet",
    gate,
    readiness,
    preserveOrder: true,
  });
}
