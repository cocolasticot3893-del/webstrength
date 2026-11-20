/**
 * Suite complète de tests unitaires et d'invariants biomécaniques pour WebStrength.
 * Exécution : node --test tests/engine.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATALOG,
  CATALOG_BY_ID,
  EXERCISE_IDS,
  CUSTOM_TEMPLATES,
  CUSTOM_TEMPLATE_IDS,
  ALL_EXERCISE_IDS,
  INTEGRATED_USER_EXERCISES,
  INTEGRATED_USER_EXERCISES_BY_ID,
  EXTENDED_CATEGORIES,
  EXTENDED_CATALOG_EXERCISES,
  EXTENDED_CATALOG_BY_ID,
  EXTENDED_EXERCISE_IDS,
  ALL_OFFICIAL_EXERCISES,
  DIRECTORY_CATEGORIES,
  DIRECTORY_EQUIPMENTS,
  USER_EXERCISES_STORAGE_KEY,
  generateUserExerciseId,
  loadUserExercises,
  saveUserExercise,
  removeUserExercise,
  clearUserExercises,
  getUserExercisesList,
  getAllCatalogExercises,
  getExerciseEquipments,
  filterCatalogExercises,
  exportUserExercisesJson,
  getCatalogExercise,
} from "../catalog.js";
import {
  sanitizeSvgMarkup,
  buildFallbackParametricSvg,
  buildFallbackExerciseGuide,
} from "../svgHelper.js";
import {
  formatExternalId,
  mapRpeToFeeling,
  sanitizeCustomLabel,
  calculateSessionMetrics,
  buildSessionName,
  buildManualActivityPayload,
  parseTelemetryJsonFromDescription,
} from "../engine.js";
import {
  snapLoadToTemplate,
  buildFreeSessionPlan,
  parseMarkdownOffline,
} from "../mdParser.js";
import {
  determineDominantPattern,
  enforceSymbolicConstraints,
  generateFallbackSession,
} from "../fallbackGenerator.js";
import {
  VAULT_KEY,
  FLAT_KEYS,
  DEFAULT_VAULT,
  loadVault,
  saveVault,
  exportVaultJson,
  importVaultJson,
} from "../vault.js";
import {
  FALLBACK_STORAGE_KEY,
  enqueueActivity,
  listPendingActivities,
  removePendingActivity,
  getOutboxCount,
  flushOutbox,
} from "../outbox.js";
import {
  GEMINI_BASE_URL,
  MODELS_CACHE_KEY,
  OBSOLETE_MODELS,
  buildResponseSchema,
  buildMarkdownParserSchema,
  buildExerciseCatalogSchema,
  scoreGeminiModel,
  fetchAvailableGeminiModels,
  pickBestAvailableModel,
  generateSessionWithGemini,
  parseMarkdownWithGemini,
  generateExerciseCatalogEntryWithGemini,
} from "../geminiClient.js";
import {
  INTERVALS_BASE_URL,
  CUSTOM_ACTIVITY_FIELDS,
  ensureCustomActivityFields,
  postManualActivity,
} from "../intervalsClient.js";
import {
  DRIVE_APP_VERSION,
  validateDriveWebhookUrl,
  buildDriveExportFilename,
  pushCustomExercisesToDrive,
} from "../driveSync.js";

// ============================================================================
// Utilitaires d'isolation pour stockage local, navigator et fetch (aucun secret)
// ============================================================================

/**
 * Crée un mock `localStorage` en mémoire conforme à l'interface Web Storage.
 * @returns {Storage}
 */
function createMemoryLocalStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(String(key));
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };
}

/**
 * Remplace temporairement un descripteur sur `globalThis` et retourne une fonction de restauration.
 * @param {string} prop
 * @param {PropertyDescriptor} descriptor
 * @returns {() => void}
 */
function stubGlobalProperty(prop, descriptor) {
  const original = Object.getOwnPropertyDescriptor(globalThis, prop);
  Object.defineProperty(globalThis, prop, {
    configurable: true,
    ...descriptor,
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, prop, original);
    } else {
      delete globalThis[prop];
    }
  };
}

// ============================================================================
// 1. Intégrité du Catalogue (catalog.js)
// ============================================================================

describe("1. Intégrité du Catalogue (catalog.js)", () => {
  const EXPECTED_SPECS = {
    // Pôle A : KBOX (7 exercices)
    KBOX_SQUAT_HARNESS: {
      pole: "KBOX",
      allowed_loads: [0.05, 0.075],
      parasitic_reps: 2,
      unit_tut_sec: 3.5,
      cns_spinal_tax: 1.8,
      is_timed: false,
    },
    KBOX_SQUAT_BELT: {
      pole: "KBOX",
      allowed_loads: [0.05, 0.075],
      parasitic_reps: 2,
      unit_tut_sec: 3.5,
      cns_spinal_tax: 0.8,
      is_timed: false,
    },
    KBOX_SPLIT_SQUAT: {
      pole: "KBOX",
      allowed_loads: [0.025, 0.05],
      parasitic_reps: 2,
      unit_tut_sec: 3.0,
      cns_spinal_tax: 1.3,
      is_timed: false,
    },
    KBOX_RDL: {
      pole: "KBOX",
      allowed_loads: [0.05, 0.075],
      parasitic_reps: 2,
      unit_tut_sec: 4.0,
      cns_spinal_tax: 2.0,
      is_timed: false,
    },
    KBOX_HIP_THRUST: {
      pole: "KBOX",
      allowed_loads: [0.025, 0.05],
      parasitic_reps: 2,
      unit_tut_sec: 2.5,
      cns_spinal_tax: 0.9,
      is_timed: false,
    },
    KBOX_CALF_ECC: {
      pole: "KBOX",
      allowed_loads: [0.025, 0.05],
      parasitic_reps: 2,
      unit_tut_sec: 3.5,
      cns_spinal_tax: 0.5,
      is_timed: false,
    },
    KBOX_HIGH_PULL: {
      pole: "KBOX",
      allowed_loads: [0.025, 0.05],
      parasitic_reps: 2,
      unit_tut_sec: 2.5,
      cns_spinal_tax: 1.1,
      is_timed: false,
    },
    // Pôle B : DUMBBELL (5 exercices)
    DB_SL_RDL: {
      pole: "DUMBBELL",
      allowed_loads: [6, 8, 10],
      parasitic_reps: 0,
      unit_tut_sec: 5.0,
      beta_ecc: 1.4,
      cns_spinal_tax: 1.1,
      is_timed: false,
    },
    DB_STEP_DOWN: {
      pole: "DUMBBELL",
      allowed_loads: [6, 8, 10],
      parasitic_reps: 0,
      unit_tut_sec: 5.0,
      beta_ecc: 1.4,
      cns_spinal_tax: 1.0,
      is_timed: false,
    },
    DB_COPENHAGEN: {
      pole: "DUMBBELL",
      allowed_loads: [0, 4, 6],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      beta_ecc: 1.0,
      cns_spinal_tax: 0.8,
      is_timed: true,
    },
    DB_RENEGADE_ROW: {
      pole: "DUMBBELL",
      allowed_loads: [6, 8, 10],
      parasitic_reps: 0,
      unit_tut_sec: 4.0,
      beta_ecc: 1.0,
      cns_spinal_tax: 1.0,
      is_timed: false,
    },
    DB_FARMER_UNI: {
      pole: "DUMBBELL",
      allowed_loads: [10],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      beta_ecc: 1.0,
      cns_spinal_tax: 0.9,
      is_timed: true,
    },
    // Pôle C : BAND_CORE (5 exercices)
    BAND_MONSTER_WALK: {
      pole: "BAND_CORE",
      allowed_loads: [2, 3],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      cns_spinal_tax: 0.4,
      is_timed: true,
    },
    BAND_PALLOF_PRESS: {
      pole: "BAND_CORE",
      allowed_loads: [2, 3, 4],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      cns_spinal_tax: 0.5,
      is_timed: true,
    },
    BAND_PSOAS_MARCH: {
      pole: "BAND_CORE",
      allowed_loads: [2, 3],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      cns_spinal_tax: 0.5,
      is_timed: true,
    },
    BAND_FACE_PULL: {
      pole: "BAND_CORE",
      allowed_loads: [1, 2],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      cns_spinal_tax: 0.4,
      is_timed: true,
    },
    CORE_MCGILL_BIG3: {
      pole: "BAND_CORE",
      allowed_loads: [1],
      parasitic_reps: 0,
      unit_tut_sec: 1.0,
      cns_spinal_tax: 0.5,
      is_timed: true,
    },
  };

  it("contient exactement 17 exercices uniques et tous les conteneurs sont figés (Object.isFrozen)", () => {
    assert.equal(CATALOG.length, 17);
    assert.equal(EXERCISE_IDS.length, 17);
    assert.equal(Object.keys(CATALOG_BY_ID).length, 17);

    assert.equal(Object.isFrozen(CATALOG), true);
    assert.equal(Object.isFrozen(CATALOG_BY_ID), true);
    assert.equal(Object.isFrozen(EXERCISE_IDS), true);

    const expectedIds = Object.keys(EXPECTED_SPECS);
    assert.deepEqual([...EXERCISE_IDS], expectedIds);

    // Vérification du gel récursif et de l'immuabilité stricte
    assert.throws(() => {
      // @ts-ignore test d'immuabilité
      CATALOG.push({});
    }, TypeError);

    for (const ex of CATALOG) {
      assert.equal(Object.isFrozen(ex), true, `${ex.id} doit être figé`);
      assert.equal(
        Object.isFrozen(ex.allowed_loads),
        true,
        `${ex.id}.allowed_loads doit être figé`
      );
      assert.throws(() => {
        // @ts-ignore test d'immuabilité
        ex.cns_spinal_tax = 999;
      }, TypeError);
      assert.throws(() => {
        // @ts-ignore test d'immuabilité
        ex.allowed_loads.push(999);
      }, TypeError);
    }
  });

  it("respecte exactement les pôles, allowed_loads, constantes biomécaniques, beta_ecc et les 7 is_timed", () => {
    const timedIds = [];
    const poleCounts = { KBOX: 0, DUMBBELL: 0, BAND_CORE: 0 };

    for (const [id, spec] of Object.entries(EXPECTED_SPECS)) {
      const ex = getCatalogExercise(id);
      poleCounts[ex.pole] += 1;

      assert.equal(ex.id, id);
      assert.equal(ex.pole, spec.pole);
      assert.deepEqual([...ex.allowed_loads], spec.allowed_loads);
      assert.equal(ex.parasitic_reps, spec.parasitic_reps);
      assert.equal(ex.unit_tut_sec, spec.unit_tut_sec);
      assert.equal(ex.cns_spinal_tax, spec.cns_spinal_tax);
      assert.equal(ex.is_timed, spec.is_timed);

      if (ex.pole === "DUMBBELL") {
        assert.equal(ex.beta_ecc, spec.beta_ecc);
      }
      if (ex.is_timed) {
        timedIds.push(ex.id);
      }
    }

    assert.deepEqual(poleCounts, { KBOX: 7, DUMBBELL: 5, BAND_CORE: 5 });
    assert.deepEqual(timedIds, [
      "DB_COPENHAGEN",
      "DB_FARMER_UNI",
      "BAND_MONSTER_WALK",
      "BAND_PALLOF_PRESS",
      "BAND_PSOAS_MARCH",
      "BAND_FACE_PULL",
      "CORE_MCGILL_BIG3",
    ]);
    assert.equal(timedIds.length, 7);
  });

  it("getCatalogExercise lève une erreur explicite sur ID inconnu ou invalide", () => {
    for (const invalidId of [
      "ID_INCONNU",
      "",
      "toString",
      "__proto__",
      null,
      undefined,
      42,
    ]) {
      assert.throws(
        () => getCatalogExercise(invalidId),
        (err) =>
          err instanceof Error &&
          err.message.includes("Exercice inconnu dans le catalogue WebStrength")
      );
    }
  });

  it("chaque exercice possède un guide figé et un SVG animé valide, léger (< 8192 o) et sûr sur disque", () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(testDir, "..");

    for (const ex of CATALOG) {
      assert.ok(ex.guide && typeof ex.guide === "object", `${ex.id}.guide doit exister`);
      assert.equal(Object.isFrozen(ex.guide), true, `${ex.id}.guide doit être figé`);
      assert.equal(ex.guide.svg_path, `./assets/exos/${ex.id}.svg`);
      assert.equal(
        typeof ex.guide.tempo_badge === "string" && ex.guide.tempo_badge.trim().length > 0,
        true,
        `${ex.id}.guide.tempo_badge doit être non vide`
      );
      assert.equal(
        typeof ex.guide.setup === "string" && ex.guide.setup.trim().length > 0,
        true,
        `${ex.id}.guide.setup doit être non vide`
      );
      assert.equal(
        Array.isArray(ex.guide.execution) && ex.guide.execution.length >= 2,
        true,
        `${ex.id}.guide.execution doit contenir au moins 2 consignes`
      );
      assert.equal(
        Array.isArray(ex.guide.errors) && ex.guide.errors.length >= 2,
        true,
        `${ex.id}.guide.errors doit contenir au moins 2 erreurs`
      );

      const svgFullPath = path.join(rootDir, "assets", "exos", `${ex.id}.svg`);
      assert.equal(fs.existsSync(svgFullPath), true, `Fichier SVG manquant : ${svgFullPath}`);

      const stat = fs.statSync(svgFullPath);
      assert.equal(
        stat.size < 8192,
        true,
        `${ex.id}.svg pèse ${stat.size} octets (limite < 8192)`
      );

      const svgContent = fs.readFileSync(svgFullPath, "utf8");
      const trimmed = svgContent.trim();
      assert.equal(trimmed.startsWith("<svg"), true, `${ex.id}.svg doit commencer par <svg`);
      assert.equal(trimmed.includes("</svg>"), true, `${ex.id}.svg doit contenir </svg>`);
      assert.equal(
        svgContent.includes("--anim-speed"),
        true,
        `${ex.id}.svg doit utiliser --anim-speed`
      );
      assert.equal(
        svgContent.includes("--anim-state"),
        true,
        `${ex.id}.svg doit utiliser --anim-state`
      );
      assert.equal(
        /<script\b/i.test(svgContent),
        false,
        `${ex.id}.svg ne doit contenir aucun <script`
      );
      assert.equal(
        /<foreignObject\b/i.test(svgContent),
        false,
        `${ex.id}.svg ne doit contenir aucun <foreignObject`
      );
      assert.equal(
        /\son[a-z]+\s*=/i.test(svgContent),
        false,
        `${ex.id}.svg ne doit contenir aucun attribut événementiel on*`
      );
    }
  });
});

// ============================================================================
// 2. Exactitude Mathématique (engine.js)
// ============================================================================

describe("2. Exactitude Mathématique (engine.js)", () => {
  it("calcule exactement PpgEffectiveTut avec 0.3 * parasitic_reps", () => {
    // KBOX_SQUAT_HARNESS : parasitic_reps=2, unit_tut_sec=3.5 -> 3 * 1 * (5 + 0.6) * 3.5 = 58.8
    // DB_SL_RDL : parasitic_reps=0, unit_tut_sec=5.0 -> 3 * 0.5 * 8 * 5.0 = 60.0
    // BAND_PALLOF_PRESS : parasitic_reps=0, unit_tut_sec=1.0 -> 2 * 1 * 45 * 1.0 = 90.0
    // Somme exacte = 208.8 -> Math.round = 209
    const metrics = calculateSessionMetrics({
      exercises: [
        { id: "KBOX_SQUAT_HARNESS", sets: 3, reps: 5, load: 0.05, completion: 1 },
        { id: "DB_SL_RDL", sets: 3, reps: 8, load: 8, completion: 0.5 },
        { id: "BAND_PALLOF_PRESS", sets: 2, reps: 45, load: 3, completion: 1 },
      ],
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      elapsed_time_sec: 1200,
    });

    assert.equal(metrics.PpgEffectiveTut, 209);
    assert.equal(metrics.pole_breakdown.KBOX.tut, 59);
    assert.equal(metrics.pole_breakdown.DUMBBELL.tut, 60);
    assert.equal(metrics.pole_breakdown.BAND_CORE.tut, 90);
  });

  it("calcule exactement EccentricStrainIndex pour Pôle A, Pôle B non chronométré, Pôle B chronométré (R_i/4) et Pôle C", () => {
    const k_ecc = 1.4;
    const rir = 1;

    // 1. Pôle A : KBOX_RDL (cns_spinal_tax=2.0), sets=3, reps=6, load=0.075, completion=1
    // strainA = 3 * 1 * 6 * 2.5 * (0.075 / 0.025)^1.15 * 1.4 * 2.0 = 45 * 3^1.15 * 2.8 = 126 * 3^1.15
    const expectedStrainA = 3 * 1 * 6 * 2.5 * Math.pow(0.075 / 0.025, 1.15) * k_ecc * 2.0;

    // 2. Pôle B non chronométré : DB_STEP_DOWN (beta_ecc=1.4), sets=3, reps=10, load=8, completion=0.75
    // strainB_untimed = 3 * 0.75 * 10 * (8 / 10) * ((10 - 1) / 10) * 1.4 * 0.8
    const expectedStrainB_untimed = 3 * 0.75 * 10 * (8 / 10) * ((10 - rir) / 10) * 1.4 * 0.8;

    // 3. Pôle B chronométré : DB_COPENHAGEN (beta_ecc=1.0, is_timed=true) à load=6, sets=2, reps=40s, completion=1
    // Normalisation R_norm = 40 / 4 = 10
    // strainB_copen = 2 * 1 * (40 / 4) * (6 / 10) * ((10 - 1) / 10) * 1.0 * 0.8
    const expectedStrainB_copen = 2 * 1 * (40 / 4) * (6 / 10) * ((10 - rir) / 10) * 1.0 * 0.8;

    // 4. Pôle B chronométré : DB_FARMER_UNI (beta_ecc=1.0, is_timed=true) à load=10, sets=3, reps=32s, completion=1
    // Normalisation R_norm = 32 / 4 = 8
    const expectedStrainB_farmer = 3 * 1 * (32 / 4) * (10 / 10) * ((10 - rir) / 10) * 1.0 * 0.8;

    // 5. Pôle C : BAND_PALLOF_PRESS (unit_tut_sec=1.0), sets=3, reps=50, load=4, completion=1
    // strainC = (3 * 1 * 50 * 1.0) * 0.02 * 4 = 150 * 0.08 = 12.0
    const expectedStrainC = 3 * 1 * 50 * 1.0 * 0.02 * 4;

    const totalExpectedStrain = Math.round(
      expectedStrainA +
        expectedStrainB_untimed +
        expectedStrainB_copen +
        expectedStrainB_farmer +
        expectedStrainC
    );

    const metrics = calculateSessionMetrics({
      exercises: [
        { id: "KBOX_RDL", sets: 3, reps: 6, load: 0.075, completion: 1 },
        { id: "DB_STEP_DOWN", sets: 3, reps: 10, load: 8, completion: 0.75 },
        { id: "DB_COPENHAGEN", sets: 2, reps: 40, load: 6, completion: 1 },
        { id: "DB_FARMER_UNI", sets: 3, reps: 32, load: 10, completion: 1 },
        { id: "BAND_PALLOF_PRESS", sets: 3, reps: 50, load: 4, completion: 1 },
      ],
      k_ecc,
      rir,
      rpe: 8,
      elapsed_time_sec: 2400,
    });

    assert.equal(metrics.EccentricStrainIndex, totalExpectedStrain);
    assert.equal(metrics.pole_breakdown.KBOX.strain, Math.round(expectedStrainA));
    assert.equal(
      metrics.pole_breakdown.DUMBBELL.strain,
      Math.round(expectedStrainB_untimed + expectedStrainB_copen + expectedStrainB_farmer)
    );
    assert.equal(metrics.pole_breakdown.BAND_CORE.strain, Math.round(expectedStrainC));
    assert.equal(metrics.strain_zone, "RED");
  });

  it("calcule DB_COPENHAGEN au poids du corps (load = 0) avec strain = 0 et TUT > 0", () => {
    const metrics = calculateSessionMetrics({
      exercises: [{ id: "DB_COPENHAGEN", sets: 2, reps: 30, load: 0, completion: 1 }],
      k_ecc: 1.0,
      rir: 3,
      rpe: 5,
      elapsed_time_sec: 600,
    });

    assert.equal(metrics.PpgEffectiveTut, 60);
    assert.equal(metrics.EccentricStrainIndex, 0);
    assert.equal(metrics.strain_zone, "GREEN");
  });

  it("calcule StrengthCompliancePct pondéré par cns_spinal_tax (0, 0.5, 0.75, 1.0 et dénominateur nul)", () => {
    // Cas uniformes : 0, 0.5, 0.75, 1.0
    for (const [comp, expectedPct] of [
      [0, 0],
      [0.5, 50],
      [0.75, 75],
      [1.0, 100],
    ]) {
      const res = calculateSessionMetrics({
        exercises: [
          { id: "KBOX_SQUAT_BELT", sets: 3, reps: 5, load: 0.05, completion: comp },
          { id: "BAND_MONSTER_WALK", sets: 2, reps: 60, load: 2, completion: comp },
        ],
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        elapsed_time_sec: 1800,
      });
      assert.equal(res.StrengthCompliancePct, expectedPct);
    }

    // Cas asymétrique prouvant la pondération par cns_spinal_tax * sets
    // KBOX_RDL (tax=2.0, sets=3 -> poids 6.0) à 1.0 + BAND_MONSTER_WALK (tax=0.4, sets=3 -> poids 1.2) à 0
    // Compliance attendue = Math.round(100 * 6.0 / (6.0 + 1.2)) = Math.round(83.3333) = 83
    const weightedRes = calculateSessionMetrics({
      exercises: [
        { id: "KBOX_RDL", sets: 3, reps: 5, load: 0.05, completion: 1.0 },
        { id: "BAND_MONSTER_WALK", sets: 3, reps: 60, load: 2, completion: 0 },
      ],
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      elapsed_time_sec: 1500,
    });
    assert.equal(weightedRes.StrengthCompliancePct, 83);

    // Dénominateur nul : liste vide ou sets = 0 -> 0 sans NaN
    const emptyRes = calculateSessionMetrics({
      exercises: [],
      k_ecc: 1.3,
      rir: 2,
      rpe: 6,
      elapsed_time_sec: 0,
    });
    assert.equal(emptyRes.StrengthCompliancePct, 0);
    assert.equal(Number.isNaN(emptyRes.StrengthCompliancePct), false);

    const zeroSetsRes = calculateSessionMetrics({
      exercises: [{ id: "CORE_MCGILL_BIG3", sets: 0, reps: 60, load: 1, completion: 1 }],
      k_ecc: 1.0,
      rir: 3,
      rpe: 5,
      elapsed_time_sec: 300,
    });
    assert.equal(zeroSetsRes.StrengthCompliancePct, 0);
  });

  it("calcule exactement icu_training_load pour elapsed >= TUT et cas limite elapsed < TUT", () => {
    const ex = [{ id: "CORE_MCGILL_BIG3", sets: 5, reps: 60, load: 1, completion: 1 }];
    // TUT = 5 * 60 = 300 s, Strain = 300 * 0.02 * 1 = 6

    // Cas 1 : elapsed_time_sec (1500) >= PpgEffectiveTut (300)
    // t_eff_min = (300 + 0.2 * (1500 - 300)) / 60 = (300 + 240) / 60 = 9.0 min
    // load = Math.round(9.0 * (0.8)^2 * 1.8 + 0.08 * 6) = Math.round(10.368 + 0.48) = Math.round(10.848) = 11
    const normalRes = calculateSessionMetrics({
      exercises: ex,
      k_ecc: 1.0,
      rir: 2,
      rpe: 8,
      elapsed_time_sec: 1500,
    });
    assert.equal(normalRes.PpgEffectiveTut, 300);
    assert.ok(Math.abs(normalRes.t_eff_min - 9.0) < 1e-12);
    assert.equal(normalRes.icu_training_load, 11);

    // Cas 2 : elapsed_time_sec (120) < PpgEffectiveTut (300)
    // Math.max(0, 120 - 300) = 0 -> t_eff_min = 300 / 60 = 5.0 min
    // load = Math.round(5.0 * (0.8)^2 * 1.8 + 0.08 * 6) = Math.round(5.76 + 0.48) = Math.round(6.24) = 6
    const shortElapsedRes = calculateSessionMetrics({
      exercises: ex,
      k_ecc: 1.0,
      rir: 2,
      rpe: 8,
      elapsed_time_sec: 120,
    });
    assert.ok(Math.abs(shortElapsedRes.t_eff_min - 5.0) < 1e-12);
    assert.equal(shortElapsedRes.icu_training_load, 6);

    // Cas 3 : elapsed_time_sec négatif -> borné à 0, même résultat t_eff_min = 5.0
    const negElapsedRes = calculateSessionMetrics({
      exercises: ex,
      k_ecc: 1.0,
      rir: 2,
      rpe: 8,
      elapsed_time_sec: -500,
    });
    assert.ok(Math.abs(negElapsedRes.t_eff_min - 5.0) < 1e-12);
    assert.equal(negElapsedRes.icu_training_load, 6);
  });

  it("mapRpeToFeeling couvre exactement toute la plage RPE 1..10 vers feeling 1..5", () => {
    const expectedMapping = {
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 2,
      6: 2,
      7: 3,
      8: 4,
      9: 4,
      10: 5,
    };

    for (let rpe = 1; rpe <= 10; rpe++) {
      assert.equal(
        mapRpeToFeeling(rpe),
        expectedMapping[rpe],
        `RPE ${rpe} doit correspondre à feeling ${expectedMapping[rpe]}`
      );
    }
  });
});

// ============================================================================
// 3. Invariant de Calibration Exigé
// ============================================================================

describe("3. Invariant de Calibration Exigé (kBox 0.050 ORANGE 35 min)", () => {
  for (const [lastPattern, expectedDominant] of [
    ["HIP_DOMINANT", "KNEE_DOMINANT"],
    ["KNEE_DOMINANT", "HIP_DOMINANT"],
  ]) {
    it(`valide la calibration pour la variante ${expectedDominant} (icu_training_load ∈ [28, 38], Strain ∈ [130, 175], zone ORANGE)`, () => {
      const session = generateFallbackSession({
        gate: "ORANGE",
        readiness: "OPTIMAL",
        lumbar_flag: false,
        yesterday_bike_hours: 2,
        hours_since_last_eccentric: 72,
        last_dominant_pattern: lastPattern,
      });

      assert.equal(session.dominant_pattern, expectedDominant);
      assert.equal(session.recommended_k_ecc, 1.3);
      assert.equal(session.recommended_rir, 2);
      assert.equal(session.recommended_rpe, 7);
      assert.equal(session.target_duration_sec, 2100);

      // Vérifie la présence du kBox à 0.050 kg·m²
      const kboxMain = session.exercises.find((e) => e.block === 2);
      assert.ok(kboxMain);
      assert.equal(kboxMain.load, 0.05);

      // Exécution à 100 % sur 35 min (2100 s), RPE = 7, k_ecc = 1.3, RIR = 2
      const completedExercises = session.exercises.map((e) => ({
        ...e,
        completion: 1,
      }));
      const metrics = calculateSessionMetrics({
        exercises: completedExercises,
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        elapsed_time_sec: 2100,
      });

      assert.equal(metrics.StrengthCompliancePct, 100);
      assert.equal(metrics.max_kbox_inertia, 0.05);
      assert.ok(
        metrics.icu_training_load >= 28 && metrics.icu_training_load <= 38,
        `icu_training_load=${metrics.icu_training_load} hors [28, 38]`
      );
      assert.ok(
        metrics.EccentricStrainIndex >= 130 &&
          metrics.EccentricStrainIndex <= 175,
        `EccentricStrainIndex=${metrics.EccentricStrainIndex} hors [130, 175]`
      );
      assert.equal(metrics.strain_zone, "ORANGE");
    });
  }
});

// ============================================================================
// 4. Respect strict des 5 Règles (fallbackGenerator.js & enforceSymbolicConstraints)
// ============================================================================

describe("4. Respect strict des 5 Règles biomécaniques", () => {
  it("Règle 1 : gate=RED et hours_since_last_eccentric=20 (<36h) exclut KBOX bas du corps, remplace KBOX_SQUAT_HARNESS et force KBOX_HIGH_PULL à 0.025", () => {
    const redContext = {
      gate: "RED",
      readiness: "COMPROMISED",
      lumbar_flag: false,
      yesterday_bike_hours: 1,
      hours_since_last_eccentric: 20,
      last_dominant_pattern: "KNEE_DOMINANT",
    };

    // Vérification sur generateFallbackSession
    const fallbackPlan = generateFallbackSession(redContext);
    assert.equal(fallbackPlan.recommended_k_ecc, 1.0);
    assert.ok(fallbackPlan.recommended_rir >= 3);
    assert.ok(fallbackPlan.recommended_rpe <= 5);
    assert.equal(fallbackPlan.target_duration_sec, 1320);

    for (const ex of fallbackPlan.exercises) {
      const cat = getCatalogExercise(ex.id);
      const isLowerKbox =
        cat.pole === "KBOX" && cat.id !== "KBOX_HIGH_PULL";
      assert.equal(
        isLowerKbox,
        false,
        `Aucun KBOX bas du corps autorisé en Règle 1 (reçu ${cat.id})`
      );
    }

    // Vérification sur enforceSymbolicConstraints face à un plan brut hostile
    const hostileRawPlan = {
      recommended_k_ecc: 1.5,
      recommended_rir: 1,
      recommended_rpe: 9,
      target_duration_sec: 3000,
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 3, reps: 60, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 45, load: 2 },
        { id: "KBOX_SQUAT_HARNESS", block: 2, sets: 4, reps: 6, load: 0.075 },
        { id: "KBOX_HIGH_PULL", block: 2, sets: 3, reps: 8, load: 0.05 },
        { id: "DB_SL_RDL", block: 3, sets: 3, reps: 8, load: 10 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 3 },
      ],
    };

    const constrained = enforceSymbolicConstraints(hostileRawPlan, redContext);
    assert.equal(constrained.exercises.length, 6);

    const block2Ids = constrained.exercises
      .filter((e) => e.block === 2)
      .map((e) => e.id);
    assert.equal(block2Ids.includes("KBOX_SQUAT_HARNESS"), false);

    // KBOX_HIGH_PULL présent en Bloc 2 doit voir sa charge forcée à 0.025
    const highPull = constrained.exercises.find((e) => e.id === "KBOX_HIGH_PULL");
    assert.ok(highPull, "KBOX_HIGH_PULL doit être conservé en Bloc 2");
    assert.equal(highPull.load, 0.025);

    // Aucun KBOX bas du corps dans toute la séance
    for (const ex of constrained.exercises) {
      const cat = getCatalogExercise(ex.id);
      if (cat.pole === "KBOX") {
        assert.equal(cat.id, "KBOX_HIGH_PULL");
      }
    }

    // Déclenchement isolé via hours_since_last_eccentric < 36 même si gate=GREEN
    const earlyRepeat = enforceSymbolicConstraints(hostileRawPlan, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      hours_since_last_eccentric: 20,
    });
    assert.equal(
      earlyRepeat.exercises.some(
        (e) => getCatalogExercise(e.id).pole === "KBOX" && e.id !== "KBOX_HIGH_PULL"
      ),
      false
    );
  });

  it("Règle 2 : lumbar_flag=true et yesterday_bike_hours=4.5 (>4h) remplacent KBOX_SQUAT_HARNESS par KBOX_SQUAT_BELT et KBOX_RDL par KBOX_HIP_THRUST", () => {
    const rawLumbarPlan = {
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 3, reps: 90, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 60, load: 2 },
        { id: "KBOX_SQUAT_HARNESS", block: 2, sets: 3, reps: 5, load: 0.05 },
        { id: "KBOX_RDL", block: 2, sets: 3, reps: 5, load: 0.05 },
        { id: "DB_SL_RDL", block: 3, sets: 3, reps: 10, load: 8 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 3 },
      ],
    };

    const lumbarRes = enforceSymbolicConstraints(rawLumbarPlan, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      lumbar_flag: true,
      yesterday_bike_hours: 4.5,
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });

    assert.equal(lumbarRes.exercises[2].id, "KBOX_SQUAT_BELT");
    assert.equal(lumbarRes.exercises[3].id, "KBOX_HIP_THRUST");

    // Déclenchement individuel uniquement via yesterday_bike_hours > 4
    const bikeOnlyFallback = generateFallbackSession({
      gate: "GREEN",
      readiness: "OPTIMAL",
      lumbar_flag: false,
      yesterday_bike_hours: 4.5,
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "KNEE_DOMINANT",
    });
    assert.equal(bikeOnlyFallback.exercises[2].id, "KBOX_HIP_THRUST");

    // Borne exacte yesterday_bike_hours === 4 sans lumbar_flag : pas de décharge forcée
    const exactly4h = enforceSymbolicConstraints(rawLumbarPlan, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      lumbar_flag: false,
      yesterday_bike_hours: 4,
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });
    assert.equal(exactly4h.exercises[2].id, "KBOX_SQUAT_HARNESS");
    assert.equal(exactly4h.exercises[3].id, "KBOX_RDL");
  });

  it("Règle 3 : 0.075 autorisé uniquement en GREEN + OPTIMAL (max 2 exos), abaissé à 0.050 en MODERATE ou ORANGE (sets <= 3, k_ecc === 1.3)", () => {
    const heavyPlan = {
      recommended_k_ecc: 1.5,
      recommended_rir: 1,
      recommended_rpe: 9,
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 4, reps: 90, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 4, reps: 60, load: 2 },
        { id: "KBOX_SQUAT_HARNESS", block: 2, sets: 4, reps: 5, load: 0.075 },
        { id: "KBOX_RDL", block: 2, sets: 4, reps: 5, load: 0.075 },
        { id: "DB_SL_RDL", block: 3, sets: 4, reps: 10, load: 10 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 4, reps: 60, load: 3 },
      ],
    };

    // GREEN + OPTIMAL : 0.075 autorisé (max 2 exos)
    const greenOpt = enforceSymbolicConstraints(heavyPlan, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });
    const exos075Green = greenOpt.exercises.filter((e) => e.load === 0.075);
    assert.equal(exos075Green.length, 2);
    assert.ok(exos075Green.length <= 2);

    // GREEN + MODERATE : 0.075 abaissé à 0.050
    const greenMod = enforceSymbolicConstraints(heavyPlan, {
      gate: "GREEN",
      readiness: "MODERATE",
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });
    assert.equal(greenMod.exercises[2].load, 0.05);
    assert.equal(greenMod.exercises[3].load, 0.05);

    // ORANGE + OPTIMAL : 0.075 abaissé à 0.050, sets <= 3 partout, recommended_k_ecc === 1.3
    const orangeOpt = enforceSymbolicConstraints(heavyPlan, {
      gate: "ORANGE",
      readiness: "OPTIMAL",
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });
    assert.equal(orangeOpt.recommended_k_ecc, 1.3);
    assert.equal(orangeOpt.exercises[2].load, 0.05);
    assert.equal(orangeOpt.exercises[3].load, 0.05);
    for (const ex of orangeOpt.exercises) {
      assert.ok(ex.sets <= 3, `En ORANGE, sets (${ex.sets}) doit être <= 3`);
    }
  });

  it("Règle 4 : alterne strictement KNEE_DOMINANT <-> HIP_DOMINANT selon last_dominant_pattern", () => {
    assert.equal(determineDominantPattern("KNEE_DOMINANT"), "HIP_DOMINANT");
    assert.equal(determineDominantPattern("HIP_DOMINANT"), "KNEE_DOMINANT");
    assert.equal(determineDominantPattern(null), "KNEE_DOMINANT");

    // Dernière séance KNEE_DOMINANT -> doit imposer HIP_DOMINANT même si le brut propose Squat
    const rawKnee = {
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 3, reps: 90, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 60, load: 2 },
        { id: "KBOX_SQUAT_BELT", block: 2, sets: 3, reps: 5, load: 0.05 },
        { id: "KBOX_CALF_ECC", block: 2, sets: 3, reps: 6, load: 0.025 },
        { id: "DB_STEP_DOWN", block: 3, sets: 3, reps: 10, load: 8 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 3 },
      ],
    };

    const forcedHip = enforceSymbolicConstraints(rawKnee, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      last_dominant_pattern: "KNEE_DOMINANT",
    });
    assert.equal(forcedHip.dominant_pattern, "HIP_DOMINANT");
    assert.equal(getCatalogExercise(forcedHip.exercises[2].id).pattern, "HIP_DOMINANT");

    // Dernière séance HIP_DOMINANT -> doit imposer KNEE_DOMINANT même si le brut propose Hip Thrust
    const rawHip = {
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 3, reps: 90, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 60, load: 2 },
        { id: "KBOX_HIP_THRUST", block: 2, sets: 3, reps: 5, load: 0.05 },
        { id: "KBOX_CALF_ECC", block: 2, sets: 3, reps: 6, load: 0.025 },
        { id: "DB_SL_RDL", block: 3, sets: 3, reps: 10, load: 8 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 3 },
      ],
    };

    const forcedKnee = enforceSymbolicConstraints(rawHip, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      last_dominant_pattern: "HIP_DOMINANT",
    });
    assert.equal(forcedKnee.dominant_pattern, "KNEE_DOMINANT");
    assert.equal(
      getCatalogExercise(forcedKnee.exercises[2].id).pattern,
      "KNEE_DOMINANT"
    );
  });

  it("Règle 5 & Snap Charges : garantit toujours 3 blocs × 2 exercices (pôles conformes) et ramène toute charge hors allowed_loads (0.062, 99)", () => {
    // 1. Plan vide -> reconstruit 3 blocs × 2 exercices conformes
    const fromEmpty = enforceSymbolicConstraints(
      {},
      { gate: "ORANGE", readiness: "OPTIMAL" }
    );
    assert.equal(fromEmpty.exercises.length, 6);
    assert.deepEqual(
      fromEmpty.exercises.map((e) => e.block),
      [1, 1, 2, 2, 3, 3]
    );
    for (const ex of fromEmpty.exercises) {
      const cat = getCatalogExercise(ex.id);
      if (ex.block === 1) assert.equal(cat.pole, "BAND_CORE");
      if (ex.block === 2) assert.equal(cat.pole, "KBOX");
      if (ex.block === 3) {
        assert.ok(cat.pole === "DUMBBELL" || cat.pole === "BAND_CORE");
      }
      assert.ok(cat.allowed_loads.includes(ex.load));
    }

    // 2. Plan corrompu avec mauvais pôles, surplus et charges hors bornes (0.062, 99)
    const malformedPlan = {
      exercises: [
        { id: "KBOX_RDL", block: 1, sets: 3, reps: 5, load: 99 }, // mauvais pôle en bloc 1
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 60, load: 99 }, // charge 99 -> 3
        { id: "KBOX_SQUAT_BELT", block: 2, sets: 3, reps: 5, load: 0.062 }, // 0.062 -> 0.050
        { id: "KBOX_CALF_ECC", block: 2, sets: 3, reps: 6, load: 99 }, // 99 -> 0.050
        { id: "KBOX_SQUAT_HARNESS", block: 3, sets: 3, reps: 5, load: 0.075 }, // mauvais pôle en bloc 3
        { id: "DB_SL_RDL", block: 3, sets: 3, reps: 10, load: 99 }, // 99 -> 10
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 99 }, // excédent bloc 3 ignoré
      ],
    };

    const sanitized = enforceSymbolicConstraints(malformedPlan, {
      gate: "GREEN",
      readiness: "OPTIMAL",
      last_dominant_pattern: "HIP_DOMINANT",
    });

    assert.equal(sanitized.exercises.length, 6);
    assert.deepEqual(
      sanitized.exercises.map((e) => e.block),
      [1, 1, 2, 2, 3, 3]
    );

    // Charges ramenées dans allowed_loads
    assert.equal(sanitized.exercises[1].load, 3); // BAND_MONSTER_WALK [2,3] <- 99
    assert.equal(sanitized.exercises[2].id, "KBOX_SQUAT_BELT");
    assert.equal(sanitized.exercises[2].load, 0.05); // 0.062 plus proche de 0.050 que 0.075
    assert.equal(sanitized.exercises[3].id, "KBOX_CALF_ECC");
    assert.equal(sanitized.exercises[3].load, 0.05); // KBOX_CALF_ECC [0.025, 0.050] <- 99

    for (const ex of sanitized.exercises) {
      const cat = getCatalogExercise(ex.id);
      assert.ok(
        cat.allowed_loads.includes(ex.load),
        `${ex.id}: charge ${ex.load} hors allowed_loads [${cat.allowed_loads.join(",")}]`
      );
      if (ex.block === 1) assert.equal(cat.pole, "BAND_CORE");
      if (ex.block === 2) assert.equal(cat.pole, "KBOX");
      if (ex.block === 3) {
        assert.ok(cat.pole === "DUMBBELL" || cat.pole === "BAND_CORE");
      }
    }
  });
});

// ============================================================================
// 5. Aller-retour Payload & [TELEMETRY_JSON] (engine.js)
// ============================================================================

describe("5. Aller-retour Payload & [TELEMETRY_JSON] (engine.js)", () => {
  it("formate external_id en heure locale, construit le nom exact selon kBox et sérialise/parse [TELEMETRY_JSON]", () => {
    const localDate = new Date(2026, 3, 5, 7, 9, 42); // 2026-04-05 07:09:42 locale
    assert.equal(formatExternalId(localDate), "pwa_strength_2026-04-05_0709");

    const session = generateFallbackSession({
      gate: "ORANGE",
      readiness: "OPTIMAL",
      lumbar_flag: false,
      yesterday_bike_hours: 2,
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    });

    const completedExercises = session.exercises.map((e) => ({
      ...e,
      completion: 1,
    }));

    const payload = buildManualActivityPayload({
      dateObj: localDate,
      theme: session.theme,
      rationale: session.rationale,
      notes: "RAS genou gauche",
      gate: "ORANGE",
      readiness: "OPTIMAL",
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      lumbar_flag: false,
      elapsed_time_sec: 2100,
      exercises: completedExercises,
    });

    // Champs racine Intervals.icu
    assert.match(payload.external_id, /^pwa_strength_\d{4}-\d{2}-\d{2}_\d{4}$/);
    assert.equal(payload.external_id, "pwa_strength_2026-04-05_0709");
    assert.equal(payload.start_date_local, "2026-04-05T07:09:42");
    assert.equal(payload.type, "WeightTraining");
    assert.equal(payload.name, `PPG kBox [0.050] - ${session.theme}`);
    assert.equal(payload.session_rpe, 7);
    assert.equal(payload.feeling, 3);
    assert.equal(payload.elapsed_time, 2100);

    // Champs custom obligatoires au 1er niveau JSON
    assert.equal(typeof payload.EccentricStrainIndex, "number");
    assert.equal(typeof payload.PpgEffectiveTut, "number");
    assert.equal(typeof payload.StrengthCompliancePct, "number");
    assert.equal(typeof payload.icu_training_load, "number");
    assert.equal(payload.moving_time, payload.PpgEffectiveTut);

    // Vérification de la dernière ligne [TELEMETRY_JSON] et aller-retour
    const lines = payload.description.split("\n");
    assert.ok(lines[lines.length - 1].startsWith("[TELEMETRY_JSON] "));

    const parsed = parseTelemetryJsonFromDescription(payload.description);
    assert.ok(parsed);
    assert.equal(parsed.schema_v, 1);
    assert.equal(parsed.gate, "ORANGE");
    assert.equal(parsed.readiness, "OPTIMAL");
    assert.equal(parsed.k_ecc, 1.3);
    assert.equal(parsed.rir, 2);
    assert.equal(parsed.lumbar_flag, false);
    assert.equal(parsed.dominant_pattern, "KNEE_DOMINANT");
    assert.equal(parsed.strain, payload.EccentricStrainIndex);
    assert.equal(parsed.tut, payload.PpgEffectiveTut);
    assert.equal(parsed.compliance, payload.StrengthCompliancePct);
    assert.equal(parsed.ex.length, 6);
    assert.equal(parsed.ex[2].id, "KBOX_SQUAT_BELT");
    assert.equal(parsed.ex[2].load, 0.05);
    assert.equal(parsed.ex[2].l, 0.05);
    assert.equal(parsed.ex[2].c, 1);

    // Vérification de la présence simultanée des noms complets et des alias courts Python
    for (const item of parsed.ex) {
      assert.equal(typeof item.sets, "number");
      assert.equal(typeof item.reps, "number");
      assert.equal(typeof item.load, "number");
      assert.equal(item.s, item.sets);
      assert.equal(item.r, item.reps);
      assert.equal(item.l, item.load);
      assert.equal(typeof item.c, "number");
    }

    // Résilience face aux sauts de ligne finaux (LF, CRLF, espaces)
    const parsedWithTrailingNewlines = parseTelemetryJsonFromDescription(
      `${payload.description}\n\r\n   \n`
    );
    assert.deepEqual(parsedWithTrailingNewlines, parsed);
  });

  it("nomme la séance 'PPG Core & Stabilité' si aucun exercice kBox n'est complété et retourne null sur description invalide", () => {
    const redSession = generateFallbackSession({
      gate: "RED",
      readiness: "COMPROMISED",
      hours_since_last_eccentric: 20,
    });
    const redPayload = buildManualActivityPayload({
      dateObj: new Date(2026, 3, 6, 18, 30, 0),
      theme: redSession.theme,
      gate: "RED",
      readiness: "COMPROMISED",
      k_ecc: 1.0,
      rir: 3,
      rpe: 5,
      lumbar_flag: false,
      elapsed_time_sec: 1320,
      exercises: redSession.exercises.map((e) => ({ ...e, completion: 1 })),
    });

    assert.equal(redPayload.name, "PPG Core & Stabilité");
    assert.equal(
      buildSessionName({
        exercises: [{ id: "KBOX_SQUAT_BELT", load: 0.05, completion: 0 }],
        theme: "Test",
      }),
      "PPG Core & Stabilité"
    );

    // Cas invalides parseTelemetryJsonFromDescription
    assert.equal(parseTelemetryJsonFromDescription(""), null);
    assert.equal(parseTelemetryJsonFromDescription(null), null);
    assert.equal(parseTelemetryJsonFromDescription("Texte sans balise"), null);
    assert.equal(
      parseTelemetryJsonFromDescription("Ligne 1\n[TELEMETRY_JSON] {invalide"),
      null
    );
  });
});

// ============================================================================
// 6. Résilience Stockage & Clients (vault.js, outbox.js, geminiClient.js)
// ============================================================================

describe("6. Résilience Stockage & Clients (vault.js, outbox.js, geminiClient.js)", () => {
  let restoreLocalStorage = null;
  let restoreNavigator = null;
  let restoreFetch = null;

  beforeEach(() => {
    const mockLs = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", {
      value: mockLs,
    });
  });

  afterEach(async () => {
    // Nettoie l'outbox avant de restaurer les descripteurs globaux
    const pending = await listPendingActivities();
    for (const item of pending) {
      await removePendingActivity(item.external_id);
    }
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    if (restoreNavigator) {
      restoreNavigator();
      restoreNavigator = null;
    }
    if (restoreLocalStorage) {
      restoreLocalStorage();
      restoreLocalStorage = null;
    }
  });

  it("vault.js préserve les clés tierces (CP_WATTS, W_PRIME_J), synchronise les 4 clés plates et survit à l'import/export", () => {
    // Simule un coffre préexistant alimenté par WebNeuro / PhysioPulse avec clés tierces
    globalThis.localStorage.setItem(
      VAULT_KEY,
      JSON.stringify({
        CP_WATTS: 325,
        W_PRIME_J: 21500,
        CUSTOM_ATHLETE_META: { team: "Endurance" },
        INTERVALS_ATHLETE_ID: "i99999",
      })
    );

    const saved = saveVault({
      INTERVALS_API_KEY: "dummy_intervals_key_123",
      GEMINI_API_KEY: "dummy_gemini_key_456",
      LLM_MODEL: "gemini-2.5-flash",
    });

    assert.equal(saved.CP_WATTS, 325);
    assert.equal(saved.W_PRIME_J, 21500);
    assert.deepEqual(saved.CUSTOM_ATHLETE_META, { team: "Endurance" });
    assert.equal(saved.INTERVALS_ATHLETE_ID, "i99999");

    // Vérifie la synchronisation des 4 clés plates
    for (const key of FLAT_KEYS) {
      assert.equal(globalThis.localStorage.getItem(key), saved[key]);
    }

    // Export puis réimport avec mise à jour partielle : clés tierces toujours intactes
    const exported = exportVaultJson();
    const parsedExport = JSON.parse(exported);
    assert.equal(parsedExport.CP_WATTS, 325);
    assert.equal(parsedExport.W_PRIME_J, 21500);

    const imported = importVaultJson(
      JSON.stringify({
        LLM_MODEL: "gemini-2.5-pro",
        NEW_THIRD_PARTY_KEY: "preserve_me",
      })
    );
    assert.equal(imported.CP_WATTS, 325);
    assert.equal(imported.W_PRIME_J, 21500);
    assert.equal(imported.NEW_THIRD_PARTY_KEY, "preserve_me");
    assert.equal(imported.LLM_MODEL, "gemini-2.5-pro");
    assert.equal(imported.INTERVALS_API_KEY, "dummy_intervals_key_123");

    // Repli si JSON principal corrompu : récupération depuis les clés plates résiduelles
    globalThis.localStorage.setItem(VAULT_KEY, "{corrompu");
    globalThis.localStorage.removeItem("INTERVALS_API_KEY");
    const recoveredFromFlat = loadVault();
    assert.equal(recoveredFromFlat.INTERVALS_ATHLETE_ID, "i99999");
    assert.equal(
      recoveredFromFlat.INTERVALS_API_KEY,
      DEFAULT_VAULT.INTERVALS_API_KEY
    );

    // Repli complet vers DEFAULT_VAULT si JSON corrompu ET clés plates absentes
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(VAULT_KEY, "{corrompu");
    const recoveredDefault = loadVault();
    assert.equal(
      recoveredDefault.INTERVALS_ATHLETE_ID,
      DEFAULT_VAULT.INTERVALS_ATHLETE_ID
    );
    assert.equal(recoveredDefault.LLM_MODEL, DEFAULT_VAULT.LLM_MODEL);

    assert.throws(() => importVaultJson(""), /vide/);
    assert.throws(() => importVaultJson("{bad"), /invalide/);
  });

  it("outbox.js garantit l'idempotence sur external_id et le vidage séquentiel FIFO avec gestion d'échecs partiels", async () => {
    const p1 = { external_id: "pwa_strength_2026-04-01_0800", order: 1 };
    const p2 = { external_id: "pwa_strength_2026-04-02_0800", order: 2 };
    const p3 = { external_id: "pwa_strength_2026-04-03_0800", order: 3 };

    // Enregistrement avec idempotence sur p1
    const first = await enqueueActivity(p1);
    const duplicate = await enqueueActivity({
      external_id: "pwa_strength_2026-04-01_0800",
      order: 999,
    });
    assert.equal(duplicate.payload.order, 1);
    assert.equal(first.external_id, duplicate.external_id);
    assert.equal(await getOutboxCount(), 1);

    await enqueueActivity(p2);
    await enqueueActivity(p3);
    assert.equal(await getOutboxCount(), 3);

    // Force des timestamps déterministes croissants pour vérifier l'ordre FIFO
    const rawList = JSON.parse(
      globalThis.localStorage.getItem(FALLBACK_STORAGE_KEY)
    );
    rawList[0].createdAt = "2026-04-01T08:00:00.000Z";
    rawList[1].createdAt = "2026-04-02T08:00:00.000Z";
    rawList[2].createdAt = "2026-04-03T08:00:00.000Z";
    globalThis.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(rawList));

    // Passe 1 : p2 échoue, p1 et p3 réussissent dans l'ordre exact
    const attemptedOrder = [];
    const pass1 = await flushOutbox(async (payload) => {
      attemptedOrder.push(payload.external_id);
      if (payload.external_id === p2.external_id) {
        throw new Error("HTTP 503 Temporaire");
      }
      return { ok: true };
    });

    assert.deepEqual(attemptedOrder, [
      p1.external_id,
      p2.external_id,
      p3.external_id,
    ]);
    assert.equal(pass1.sentCount, 2);
    assert.equal(pass1.failedCount, 1);
    assert.equal(pass1.remainingCount, 1);
    assert.deepEqual(pass1.errors, [
      { external_id: p2.external_id, error: "HTTP 503 Temporaire" },
    ]);

    const remaining = await listPendingActivities();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].external_id, p2.external_id);
    assert.equal(remaining[0].attempts, 1);
    assert.equal(remaining[0].lastError, "HTTP 503 Temporaire");

    // Passe 2 : p2 réussit -> file vide
    const pass2 = await flushOutbox(async () => ({ ok: true }));
    assert.equal(pass2.sentCount, 1);
    assert.equal(pass2.failedCount, 0);
    assert.equal(pass2.remainingCount, 0);
    assert.equal(await getOutboxCount(), 0);

    // Validation de garde sur payload invalide
    await assert.rejects(() => enqueueActivity({}), /external_id/);
  });

  it("geminiClient.js bascule automatiquement vers FALLBACK_LOCAL sans clé, hors-ligne et sur erreur mockée", async () => {
    const context = {
      gate: "ORANGE",
      readiness: "OPTIMAL",
      lumbar_flag: false,
      yesterday_bike_hours: 2,
      hours_since_last_eccentric: 72,
      last_dominant_pattern: "HIP_DOMINANT",
    };

    let fetchCalls = 0;
    restoreFetch = stubGlobalProperty("fetch", {
      value: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({}), { status: 500 });
      },
    });

    // 1. Sans clé API -> FALLBACK_LOCAL sans appel réseau
    const noKeyRes = await generateSessionWithGemini({
      apiKey: "",
      context,
    });
    assert.equal(noKeyRes.source, "FALLBACK_LOCAL");
    assert.equal(noKeyRes.plan.exercises.length, 6);
    assert.equal(fetchCalls, 0);

    // 2. Hors-ligne -> FALLBACK_LOCAL sans appel réseau
    restoreNavigator = stubGlobalProperty("navigator", {
      value: { onLine: false },
    });
    const offlineRes = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      context,
    });
    assert.equal(offlineRes.source, "FALLBACK_LOCAL");
    assert.equal(fetchCalls, 0);

    // Restaure navigateur en ligne
    restoreNavigator();
    restoreNavigator = null;

    // 3. Erreur HTTP 500 mockée -> repli propre vers FALLBACK_LOCAL
    const httpErrRes = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      context,
    });
    assert.equal(fetchCalls, 1);
    assert.equal(httpErrRes.source, "FALLBACK_LOCAL");
    assert.match(httpErrRes.fallbackReason, /HTTP 500/);
    assert.equal(httpErrRes.plan.exercises.length, 6);

    // 4. Erreur réseau -> repli propre
    restoreFetch();
    restoreFetch = stubGlobalProperty("fetch", {
      value: async () => {
        throw new Error("ECONNRESET simulé");
      },
    });
    const netErrRes = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      context,
    });
    assert.equal(netErrRes.source, "FALLBACK_LOCAL");
    assert.match(netErrRes.fallbackReason, /ECONNRESET simulé/);

    // 5. JSON malformé renvoyé par Gemini -> repli propre
    restoreFetch();
    restoreFetch = stubGlobalProperty("fetch", {
      value: async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{json_casse" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });
    const badJsonRes = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      context,
    });
    assert.equal(badJsonRes.source, "FALLBACK_LOCAL");
    assert.ok(badJsonRes.fallbackReason.length > 0);

    // 6. Timeout AbortController (500 ms) -> repli propre
    restoreFetch();
    restoreFetch = stubGlobalProperty("fetch", {
      value: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(init.signal.reason || new Error("Aborted"));
          });
        }),
    });
    const timeoutRes = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      context,
      timeoutMs: 500,
    });
    assert.equal(timeoutRes.source, "FALLBACK_LOCAL");
    assert.match(timeoutRes.fallbackReason, /Timeout Gemini dépassé/);
  });

  it("vault.js et outbox.js fonctionnent en repli mémoire Node.js pur sans localStorage ni IndexedDB", async () => {
    // Restaure le getter localStorage natif de Node.js (qui échoue sans --localstorage-file)
    restoreLocalStorage();
    restoreLocalStorage = null;

    const memSaved = saveVault({
      CP_WATTS: 310,
      LLM_MODEL: "gemini-2.5-flash",
    });
    assert.equal(memSaved.CP_WATTS, 310);
    assert.equal(loadVault().CP_WATTS, 310);

    await enqueueActivity({ external_id: "pwa_strength_2026-04-10_0900", ok: true });
    assert.equal(await getOutboxCount(), 1);
    const flushed = await flushOutbox(async () => ({ ok: true }));
    assert.equal(flushed.sentCount, 1);
    assert.equal(flushed.remainingCount, 0);
  });

  it("geminiClient.js passe toute réponse Gemini mockée dans enforceSymbolicConstraints (bloque Règle 1 et ID inventé)", async () => {
    const schema = buildResponseSchema();
    assert.deepEqual(
      schema.properties.exercises.items.properties.id.enum,
      [...EXERCISE_IDS]
    );

    let capturedUrl = "";
    let capturedApiKeyHeader = "";
    restoreFetch = stubGlobalProperty("fetch", {
      value: async (url, init) => {
        capturedUrl = url;
        capturedApiKeyHeader = init?.headers?.["x-goog-api-key"] ?? "";

        // Réponse Gemini simulée violant Règle 1 + inventant un ID + charge illégale
        const nonCompliantGeminiOutput = {
          theme: "Séance Gemini Non Conforme",
          rationale: "Tentative illégale kBox Squat Harness en RED",
          recommended_k_ecc: 1.5,
          recommended_rir: 0,
          recommended_rpe: 10,
          target_duration_sec: 3600,
          exercises: [
            { id: "ID_INVENTE_XYZ", block: 1, sets: 4, reps: 60, load: 99 },
            { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 45, load: 2 },
            { id: "KBOX_SQUAT_HARNESS", block: 2, sets: 4, reps: 6, load: 0.075 },
            { id: "KBOX_HIGH_PULL", block: 2, sets: 3, reps: 8, load: 0.05 },
            { id: "DB_SL_RDL", block: 3, sets: 3, reps: 8, load: 99 },
            { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 45, load: 2 },
          ],
        };

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { thought: true, text: "raisonnement interne ignoré" },
                    { text: JSON.stringify(nonCompliantGeminiOutput) },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const result = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      model: "gemini-2.5-flash",
      context: {
        gate: "RED",
        readiness: "COMPROMISED",
        hours_since_last_eccentric: 20,
      },
    });

    assert.equal(
      capturedUrl,
      `${GEMINI_BASE_URL}/gemini-2.5-flash:generateContent`
    );
    assert.equal(capturedApiKeyHeader, "dummy_gemini_key");
    assert.equal(result.source, "GEMINI");
    assert.equal(result.model, "gemini-2.5-flash");

    // Contraintes symboliques strictement appliquées malgré la réponse Gemini illégale
    const { plan } = result;
    assert.equal(plan.exercises.length, 6);
    assert.equal(plan.recommended_k_ecc, 1.0);
    assert.ok(plan.recommended_rir >= 3);
    assert.ok(plan.recommended_rpe <= 5);
    assert.equal(plan.target_duration_sec, 1320);

    // ID inventé remplacé par un ID valide du catalogue
    assert.equal(
      plan.exercises.some((e) => e.id === "ID_INVENTE_XYZ"),
      false
    );
    // KBOX_SQUAT_HARNESS éliminé (Règle 1)
    assert.equal(
      plan.exercises.some((e) => e.id === "KBOX_SQUAT_HARNESS"),
      false
    );
    // KBOX_HIGH_PULL forcé à 0.025
    const highPull = plan.exercises.find((e) => e.id === "KBOX_HIGH_PULL");
    assert.ok(highPull);
    assert.equal(highPull.load, 0.025);

    // Tous les exercices appartiennent au catalogue avec charge légale
    for (const ex of plan.exercises) {
      const cat = getCatalogExercise(ex.id);
      assert.ok(cat.allowed_loads.includes(ex.load));
    }
  });

  it("scoreGeminiModel classe les générations Flash et rejette les modèles incompatibles (tts/embedding/image)", () => {
    assert.equal(MODELS_CACHE_KEY, "PHYSIOPULSE_CACHED_MODELS_V2");
    assert.equal(DEFAULT_VAULT.LLM_MODEL, "gemini-3.5-flash");
    assert.ok(OBSOLETE_MODELS.has("gemini-2.5-flash"));

    const s50 = scoreGeminiModel("gemini-5.0-flash");
    const s38 = scoreGeminiModel("gemini-3.8-flash");
    const sLatest = scoreGeminiModel("gemini-flash-latest");
    const s35 = scoreGeminiModel("gemini-3.5-flash");
    const s35Lite = scoreGeminiModel("gemini-3.5-flash-lite");
    const s35Pro = scoreGeminiModel("gemini-3.5-pro");
    const s25 = scoreGeminiModel("gemini-2.5-flash");

    assert.ok(s50 > s38 && s38 > s35 && s35 > s25);
    assert.ok(s38 > sLatest && sLatest > s35);
    assert.ok(s35 > s35Lite);
    assert.ok(s35 > s35Pro);

    // Modèles incompatibles avec Structured Outputs JSON -> score < 0
    assert.ok(scoreGeminiModel("gemini-2.5-flash-tts") < 0);
    assert.ok(scoreGeminiModel("gemini-embedding-001") < 0);
    assert.ok(scoreGeminiModel("gemini-2.5-flash-image") < 0);
    assert.ok(scoreGeminiModel("gemma-3-27b-it") < 0);
  });

  it("pickBestAvailableModel remplace un modèle obsolète ou retiré tout en respectant un choix utilisateur actif", () => {
    const activeModels = [
      { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", score: 3920 },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", score: 3620 },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", score: 2620 },
    ];

    // Ancien défaut obsolète remplacé automatiquement par le meilleur actif
    assert.equal(
      pickBestAvailableModel(activeModels, "gemini-2.5-flash"),
      "gemini-3.8-flash"
    );

    // Modèle retiré de la liste active -> remplacé par le meilleur actif
    assert.equal(
      pickBestAvailableModel(activeModels, "gemini-3.0-flash"),
      "gemini-3.8-flash"
    );

    // Choix utilisateur explicite non-obsolète et présent -> conservé
    assert.equal(
      pickBestAvailableModel(activeModels, "gemini-3.5-flash"),
      "gemini-3.5-flash"
    );

    // Liste vide : remplace un obsolète par gemini-3.5-flash, préserve un choix valide
    assert.equal(pickBestAvailableModel([], "gemini-2.5-flash"), "gemini-3.5-flash");
    assert.equal(pickBestAvailableModel([], "gemini-3.8-flash"), "gemini-3.8-flash");
  });

  it("generateSessionWithGemini auto-répare un HTTP 404 via GET /v1beta/models, persiste le modèle et retourne autoUpgradedFrom", async () => {
    saveVault({ LLM_MODEL: "gemini-2.5-flash" });

    const calls = [];
    const validGeminiPlan = {
      theme: "Séance Auto-Upgraded",
      rationale: "Plan validé après bascule automatique",
      recommended_k_ecc: 1.3,
      recommended_rir: 2,
      recommended_rpe: 7,
      target_duration_sec: 2100,
      exercises: [
        { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 45, load: 2 },
        { id: "BAND_DEAD_BUG", block: 1, sets: 3, reps: 45, load: 2 },
        { id: "KBOX_SQUAT_BELT", block: 2, sets: 3, reps: 8, load: 0.05 },
        { id: "KBOX_HIGH_PULL", block: 2, sets: 3, reps: 8, load: 0.05 },
        { id: "DB_SL_RDL", block: 3, sets: 3, reps: 8, load: 16 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 45, load: 2 },
      ],
    };

    restoreFetch = stubGlobalProperty("fetch", {
      value: async (url, init) => {
        calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {} });

        if (url === `${GEMINI_BASE_URL}/gemini-2.5-flash:generateContent`) {
          return new Response(JSON.stringify({ error: { code: 404 } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url === `${GEMINI_BASE_URL}?pageSize=100`) {
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-2.5-flash-tts",
                  displayName: "TTS",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-3.5-flash",
                  displayName: "Gemini 3.5 Flash",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-3.8-flash",
                  displayName: "Gemini 3.8 Flash",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (url === `${GEMINI_BASE_URL}/gemini-3.8-flash:generateContent`) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(validGeminiPlan) }],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({}), { status: 500 });
      },
    });

    // Vérifie aussi fetchAvailableGeminiModels directement (en-tête x-goog-api-key, aucun ?key= en URL)
    const listed = await fetchAvailableGeminiModels("dummy_gemini_key");
    assert.deepEqual(
      listed.map((m) => m.id),
      ["gemini-3.8-flash", "gemini-3.5-flash"]
    );
    assert.equal(calls[0].headers["x-goog-api-key"], "dummy_gemini_key");
    assert.equal(calls[0].url.includes("?key="), false);

    calls.length = 0;
    const res = await generateSessionWithGemini({
      apiKey: "dummy_gemini_key",
      model: "gemini-2.5-flash",
      context: {
        gate: "ORANGE",
        readiness: "OPTIMAL",
        hours_since_last_eccentric: 72,
        last_dominant_pattern: "HIP_DOMINANT",
      },
    });

    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, `${GEMINI_BASE_URL}/gemini-2.5-flash:generateContent`);
    assert.equal(calls[1].url, `${GEMINI_BASE_URL}?pageSize=100`);
    assert.equal(calls[1].method, "GET");
    assert.equal(calls[2].url, `${GEMINI_BASE_URL}/gemini-3.8-flash:generateContent`);

    assert.equal(res.source, "GEMINI");
    assert.equal(res.model, "gemini-3.8-flash");
    assert.equal(res.autoUpgradedFrom, "gemini-2.5-flash");
    assert.equal(res.plan.exercises.length, 6);
    assert.equal(loadVault().LLM_MODEL, "gemini-3.8-flash");
  });

  it("ensureCustomActivityFields envoie content.code non vide sur POST /custom-item et gère le repli HTTP 422", async () => {
    const calls = [];
    const expectedCodes = CUSTOM_ACTIVITY_FIELDS.map((f) => f.code);
    assert.deepEqual(expectedCodes, [
      "EccentricStrainIndex",
      "PpgEffectiveTut",
      "StrengthCompliancePct",
    ]);

    const mockFetch = async (url, init = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });

      if (method === "GET") {
        // Aucun champ préexistant
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "POST") {
        assert.ok(
          typeof body?.content?.code === "string" && body.content.code.length > 0,
          "content.code doit toujours être non vide"
        );
        // Simule un HTTP 422 sur le schéma principal pour PpgEffectiveTut (2 replis jusqu'au succès)
        if (
          body.content.code === "PpgEffectiveTut" &&
          (body.content.label !== undefined || body.content.type === "numeric")
        ) {
          return new Response(JSON.stringify({ error: "Validation 422" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ id: `ci_${body.content.code}` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 500 });
    };

    const res = await ensureCustomActivityFields({
      athleteId: "i763697",
      apiKey: "dummy_intervals_key",
      fetchImpl: mockFetch,
    });

    assert.equal(res.checked, 3);
    assert.deepEqual(res.existing, []);
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.created, expectedCodes);

    const postCalls = calls.filter((c) => c.method === "POST");
    // 1er champ: 1 POST, 2e champ: 3 POST (principal + 2 replis 422), 3e champ: 1 POST
    assert.equal(postCalls.length, 5);
    assert.equal(
      postCalls[0].url,
      `${INTERVALS_BASE_URL}/athlete/i763697/custom-item`
    );
    assert.equal(postCalls[0].body.content.code, "EccentricStrainIndex");
    assert.equal(postCalls[0].body.content.aggregate, "SUM");
    assert.equal(postCalls[1].body.content.code, "PpgEffectiveTut");
    assert.equal(postCalls[2].body.content.type, "numeric");
    assert.equal(postCalls[3].body.name, "PpgEffectiveTut");
    assert.equal(postCalls[3].body.content.code, "PpgEffectiveTut");
    assert.equal(postCalls[4].body.content.code, "StrengthCompliancePct");
    assert.equal(postCalls[4].body.content.aggregate, "AVERAGE");
  });

  it("postManualActivity effectue POST /activities/manual puis PUT /activity/{id} avec icu_training_load et les 3 champs personnalisés", async () => {
    const calls = [];
    restoreFetch = stubGlobalProperty("fetch", {
      value: async (url, init = {}) => {
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url, method, body });

        if (
          method === "POST" &&
          url === `${INTERVALS_BASE_URL}/athlete/i763697/activities/manual`
        ) {
          return new Response(JSON.stringify({ id: "i999", name: body.name }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (
          method === "PUT" &&
          url === `${INTERVALS_BASE_URL}/activity/i999`
        ) {
          return new Response(JSON.stringify({ id: "i999", ...body }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({}), { status: 500 });
      },
    });

    const payload = {
      name: "[TEST] PPG kBox",
      icu_training_load: 64,
      EccentricStrainIndex: 142.5,
      PpgEffectiveTut: 360,
      StrengthCompliancePct: 100,
    };

    const created = await postManualActivity({
      athleteId: "i763697",
      apiKey: "dummy_intervals_key",
      payload,
    });

    assert.equal(created.id, "i999");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "POST");
    assert.equal(
      calls[0].url,
      `${INTERVALS_BASE_URL}/athlete/i763697/activities/manual`
    );
    assert.equal(calls[1].method, "PUT");
    assert.equal(calls[1].url, `${INTERVALS_BASE_URL}/activity/i999`);
    assert.deepEqual(calls[1].body, {
      icu_training_load: 64,
      EccentricStrainIndex: 142.5,
      PpgEffectiveTut: 360,
      StrengthCompliancePct: 100,
    });
  });
});

// ============================================================================
// 7. Mode Séance Libre (CUSTOM_*) & Import Markdown
// ============================================================================

describe("7. Mode Séance Libre (CUSTOM_*) & Import Markdown", () => {
  let restoreLocalStorage;
  let restoreFetch;
  let restoreNavigator;

  beforeEach(() => {
    const memStorage = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", {
      value: memStorage,
    });
  });

  afterEach(() => {
    restoreFetch?.();
    restoreNavigator?.();
    restoreLocalStorage?.();
  });

  it("CUSTOM_TEMPLATES figés, ALL_EXERCISE_IDS.length === 20 et résolution via getCatalogExercise", () => {
    assert.equal(Object.isFrozen(CUSTOM_TEMPLATES), true);
    assert.deepEqual(
      [...CUSTOM_TEMPLATE_IDS].sort(),
      ["CUSTOM_BAND_CORE", "CUSTOM_DUMBBELL", "CUSTOM_KBOX"]
    );

    for (const id of ["CUSTOM_KBOX", "CUSTOM_DUMBBELL", "CUSTOM_BAND_CORE"]) {
      assert.equal(Object.isFrozen(CUSTOM_TEMPLATES[id]), true);
      assert.equal(Object.isFrozen(CUSTOM_TEMPLATES[id].allowed_loads), true);
      const resolved = getCatalogExercise(id);
      assert.equal(resolved.id, id);
      assert.equal(resolved.is_custom, true);
      assert.equal(resolved.guide, null);
    }

    assert.equal(Object.isFrozen(ALL_EXERCISE_IDS), true);
    assert.equal(ALL_EXERCISE_IDS.length, 20);
    assert.equal(CATALOG.length + CUSTOM_TEMPLATE_IDS.length, 20);

    const schema = buildMarkdownParserSchema();
    const idEnum = schema.properties.exercises.items.properties.id.enum;
    assert.equal(idEnum.length, 20);
    assert.ok(idEnum.includes("CUSTOM_DUMBBELL"));
  });

  it("calculateSessionMetrics & buildManualActivityPayload supportent mix CATALOG + CUSTOM_*, custom_label et is_timed: false sur CUSTOM_BAND_CORE", () => {
    const exercises = [
      {
        id: "KBOX_SQUAT_BELT",
        block: 2,
        sets: 4,
        reps: 8,
        load: 0.05,
        completion: 1,
      },
      {
        id: "CUSTOM_DUMBBELL",
        block: 3,
        sets: 3,
        reps: 12,
        load: 10,
        completion: 1,
        custom_label: "Curl Marteau",
        is_timed: false,
      },
      {
        id: "CUSTOM_BAND_CORE",
        block: 1,
        sets: 4,
        reps: 10,
        load: 0,
        completion: 1,
        custom_label: "Tractions Pronation",
        is_timed: false,
      },
    ];

    const metrics = calculateSessionMetrics({
      exercises,
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      elapsed_time_sec: 2100,
    });

    // KBOX_SQUAT_BELT: 4*(8+0.3*2)*3.5 = 120.4s
    // CUSTOM_DUMBBELL: 3*12*3.5 = 126s
    // CUSTOM_BAND_CORE: 4*10*1.0 = 40s -> total TUT = 286.4 -> 286
    assert.equal(metrics.PpgEffectiveTut, 286);
    assert.equal(metrics.StrengthCompliancePct, 100);
    assert.ok(metrics.EccentricStrainIndex > 0);

    const payload = buildManualActivityPayload({
      dateObj: new Date("2026-11-19T08:00:00"),
      theme: "Séance Mixte Libre",
      rationale: "Test mixte catalogue + custom",
      gate: "ORANGE",
      readiness: "OPTIMAL",
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      lumbar_flag: false,
      elapsed_time_sec: 2100,
      exercises,
    });

    assert.ok(payload.description.includes("| Curl Marteau | 10 kg | 3×12 |"));
    assert.ok(
      payload.description.includes("| Tractions Pronation | 0 niv. | 4×10 |")
    );
    assert.ok(!payload.description.includes("| Tractions Pronation | 0 niv. | 4×10s |"));

    const telemetry = parseTelemetryJsonFromDescription(payload.description);
    assert.ok(telemetry);
    assert.equal(telemetry.ex.length, 3);

    const curlJson = telemetry.ex.find((e) => e.id === "CUSTOM_DUMBBELL");
    assert.ok(curlJson);
    assert.equal(curlJson.custom_label, "Curl Marteau");

    const pullupJson = telemetry.ex.find((e) => e.id === "CUSTOM_BAND_CORE");
    assert.ok(pullupJson);
    assert.equal(pullupJson.custom_label, "Tractions Pronation");
    assert.equal(pullupJson.is_timed, false);
  });

  it("parseMarkdownOffline parse un exemple Markdown mixte réel (catalogue + CUSTOM_* + temps/reps)", () => {
    const rawMd = [
      "# Séance Mixte Automne",
      "KBOX_SQUAT_BELT | 0.050 | 4x8",
      "- Curl Marteau | 10kg | 3x12",
      "- Planche | 0 | 3x60s",
      "- Tractions Pronation 4x10",
    ].join("\n");

    const plan = parseMarkdownOffline(rawMd);
    assert.equal(plan.theme, "Séance Mixte Automne");
    assert.equal(plan.is_free_mode, true);
    assert.deepEqual(plan.applied_rules, ["MODE_LIBRE"]);
    assert.equal(plan.exercises.length, 4);

    const [squat, curl, plank, pullups] = plan.exercises;

    assert.equal(squat.id, "KBOX_SQUAT_BELT");
    assert.equal(squat.load, 0.05);
    assert.equal(squat.sets, 4);
    assert.equal(squat.reps, 8);

    assert.equal(curl.id, "CUSTOM_DUMBBELL");
    assert.equal(curl.custom_label, "Curl Marteau");
    assert.equal(curl.load, 10);
    assert.equal(curl.sets, 3);
    assert.equal(curl.reps, 12);
    assert.equal(curl.is_timed, false);

    assert.equal(plank.id, "CUSTOM_BAND_CORE");
    assert.equal(plank.custom_label, "Planche");
    assert.equal(plank.load, 0);
    assert.equal(plank.sets, 3);
    assert.equal(plank.reps, 60);
    assert.equal(plank.is_timed, true);

    assert.equal(pullups.id, "CUSTOM_BAND_CORE");
    assert.equal(pullups.custom_label, "Tractions Pronation");
    assert.equal(pullups.load, 0);
    assert.equal(pullups.sets, 4);
    assert.equal(pullups.reps, 10);
    assert.equal(pullups.is_timed, false);
  });

  it("parseMarkdownWithGemini bascule offline sans clé API et parse une réponse Gemini mockée (CUSTOM_DUMBBELL + custom_label)", async () => {
    let fetchCalls = 0;
    restoreFetch = stubGlobalProperty("fetch", {
      value: async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        theme: "Force & Bras Gemini",
                        rationale: "Conversion structurée via Gemini",
                        recommended_k_ecc: 1.3,
                        recommended_rir: 2,
                        recommended_rpe: 7,
                        target_duration_sec: 1800,
                        exercises: [
                          {
                            id: "KBOX_SQUAT_BELT",
                            block: 2,
                            sets: 4,
                            reps: 8,
                            load: 0.05,
                            is_timed: false,
                          },
                          {
                            id: "CUSTOM_DUMBBELL",
                            block: 3,
                            sets: 3,
                            reps: 12,
                            load: 11,
                            custom_label: "Curl Marteau <script>alert(1)</script>",
                            is_timed: false,
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const mdSample = "KBOX_SQUAT_BELT | 0.050 | 4x8\n- Curl Marteau | 11kg | 3x12";

    // 1. Sans clé API -> bascule immédiate sur OFFLINE_PARSER sans appel réseau
    const offlineRes = await parseMarkdownWithGemini(mdSample, "");
    assert.equal(offlineRes.source, "OFFLINE_PARSER");
    assert.equal(fetchCalls, 0);
    assert.equal(offlineRes.plan.exercises.length, 2);

    // 2. Avec clé API -> appel Gemini mocké, snap charge 11kg -> 10kg et sanitisation custom_label
    const geminiRes = await parseMarkdownWithGemini(
      mdSample,
      "dummy_gemini_key",
      "gemini-3.5-flash"
    );
    assert.equal(fetchCalls, 1);
    assert.equal(geminiRes.source, "GEMINI_PARSER");
    assert.equal(geminiRes.model, "gemini-3.5-flash");
    assert.equal(geminiRes.plan.theme, "Force & Bras Gemini");
    assert.equal(geminiRes.plan.is_free_mode, true);

    const customEx = geminiRes.plan.exercises[1];
    assert.equal(customEx.id, "CUSTOM_DUMBBELL");
    assert.equal(customEx.load, snapLoadToTemplate(11, getCatalogExercise("CUSTOM_DUMBBELL")));
    assert.equal(customEx.load, 10);
    assert.equal(customEx.custom_label, sanitizeCustomLabel("Curl Marteau <script>alert(1)</script>"));
    assert.equal(customEx.custom_label, "Curl Marteau alert(1)");
    assert.equal(customEx.is_timed, false);
  });
});

// ============================================================================
// 8. Promotion Catalogue Dynamique (USER_*), Assainissement SVG & Export JSON
// ============================================================================

describe("8. Promotion Catalogue Dynamique (USER_*), Assainissement SVG & Export JSON", () => {
  let restoreLocalStorage;
  let restoreFetch;
  let restoreNavigator;

  beforeEach(() => {
    const memStorage = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", {
      value: memStorage,
    });
    clearUserExercises();
  });

  afterEach(() => {
    clearUserExercises();
    restoreFetch?.();
    restoreFetch = undefined;
    restoreNavigator?.();
    restoreNavigator = undefined;
    restoreLocalStorage?.();
    restoreLocalStorage = undefined;
  });

  it("generateUserExerciseId déterministe, collision multi-pôle, persistance USER_* et invariant EXERCISE_IDS.length === 17", () => {
    const id1 = generateUserExerciseId(
      "Rowing Inversé Anneaux",
      {},
      "BAND_CORE"
    );
    assert.equal(id1, "USER_ROWING_INVERSE_ANNEAUX");

    const tplBand = getCatalogExercise("CUSTOM_BAND_CORE");
    const guide1 = buildFallbackExerciseGuide({
      name: "Rowing Inversé Anneaux",
      pole: "BAND_CORE",
      isTimed: false,
      exerciseId: id1,
    });

    const saved1 = saveUserExercise({
      id: id1,
      name: "Rowing Inversé Anneaux",
      pole: tplBand.pole,
      pattern: tplBand.pattern,
      allowed_loads: [...tplBand.allowed_loads],
      parasitic_reps: tplBand.parasitic_reps,
      unit_tut_sec: tplBand.unit_tut_sec,
      cns_spinal_tax: tplBand.cns_spinal_tax,
      unit_label: tplBand.unit_label,
      is_timed: false,
      default_sets: 3,
      default_reps: 12,
      short_desc: guide1.short_desc,
      guide: guide1.guide,
      svg_inline: guide1.svg_inline,
    });

    assert.equal(saved1.id, id1);
    assert.equal(saved1.is_user_catalog, true);
    assert.equal(saved1.is_custom, false);

    // Vérifie la collision même nom sur un pôle différent -> suffixe _DUMBBELL
    const existingMap = loadUserExercises();
    assert.ok(Object.hasOwn(existingMap, id1));
    assert.ok(
      globalThis.localStorage.getItem(USER_EXERCISES_STORAGE_KEY) !== null
    );

    const idSamePole = generateUserExerciseId(
      "Rowing Inversé Anneaux",
      existingMap,
      "BAND_CORE"
    );
    assert.equal(idSamePole, id1);

    const idOtherPole = generateUserExerciseId(
      "Rowing Inversé Anneaux",
      existingMap,
      "DUMBBELL"
    );
    assert.equal(idOtherPole, "USER_ROWING_INVERSE_ANNEAUX_DUMBBELL");

    const resolved = getCatalogExercise(id1);
    assert.equal(resolved.id, id1);
    assert.equal(resolved.name, "Rowing Inversé Anneaux");

    const all = getAllCatalogExercises();
    assert.equal(all.length, ALL_OFFICIAL_EXERCISES.length + 1);
    assert.equal(all.length, 56);
    assert.ok(all.some((ex) => ex.id === id1));

    // Invariant strict du catalogue officiel
    assert.equal(EXERCISE_IDS.length, 17);
    assert.equal(CATALOG.length, 17);

    // Suppression unitaire propre -> retour à 55 exercices officiels (17 base + 3 intégrés + 35 étendus)
    assert.equal(removeUserExercise(id1), true);
    assert.equal(getUserExercisesList().length, 0);
    assert.equal(getAllCatalogExercises().length, 55);
  });

  it("Parité mathématique exacte entre CUSTOM_BAND_CORE et sa version promue USER_*", () => {
    const tpl = getCatalogExercise("CUSTOM_BAND_CORE");
    const promotedId = generateUserExerciseId(
      "Tirage Horizontal Élastique",
      {},
      tpl.pole
    );
    const guide = buildFallbackExerciseGuide({
      name: "Tirage Horizontal Élastique",
      pole: tpl.pole,
      isTimed: false,
      exerciseId: promotedId,
    });

    saveUserExercise({
      id: promotedId,
      name: "Tirage Horizontal Élastique",
      pole: tpl.pole,
      pattern: tpl.pattern,
      allowed_loads: [...tpl.allowed_loads],
      parasitic_reps: tpl.parasitic_reps,
      unit_tut_sec: tpl.unit_tut_sec,
      cns_spinal_tax: tpl.cns_spinal_tax,
      unit_label: tpl.unit_label,
      ...(tpl.beta_ecc !== undefined ? { beta_ecc: tpl.beta_ecc } : {}),
      is_timed: false,
      default_sets: 3,
      default_reps: 12,
      short_desc: guide.short_desc,
      guide: guide.guide,
      svg_inline: guide.svg_inline,
    });

    const commonMeta = {
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      elapsed_time_sec: 1800,
    };

    const customExercises = [
      {
        id: "CUSTOM_BAND_CORE",
        block: 1,
        sets: 4,
        reps: 15,
        load: 2,
        completion: 1,
        custom_label: "Tirage Horizontal Élastique",
        is_timed: false,
      },
    ];
    const promotedExercises = [
      {
        id: promotedId,
        block: 1,
        sets: 4,
        reps: 15,
        load: 2,
        completion: 1,
        is_timed: false,
      },
    ];

    const customMetrics = calculateSessionMetrics({
      ...commonMeta,
      exercises: customExercises,
    });
    const promotedMetrics = calculateSessionMetrics({
      ...commonMeta,
      exercises: promotedExercises,
    });

    assert.equal(
      promotedMetrics.EccentricStrainIndex,
      customMetrics.EccentricStrainIndex
    );
    assert.equal(promotedMetrics.PpgEffectiveTut, customMetrics.PpgEffectiveTut);
    assert.equal(
      promotedMetrics.StrengthCompliancePct,
      customMetrics.StrengthCompliancePct
    );

    const payloadParams = {
      dateIso: "2026-11-19",
      theme: "Test Parité Promotion",
      k_ecc: 1.3,
      rir: 2,
      rpe: 7,
      elapsed_time_sec: 1800,
      gate: "GREEN",
      readiness: "OPTIMAL",
      session_source: "FREE_BUILDER",
    };

    const customPayload = buildManualActivityPayload({
      ...payloadParams,
      exercises: customExercises,
    });
    const promotedPayload = buildManualActivityPayload({
      ...payloadParams,
      exercises: promotedExercises,
    });

    assert.equal(
      promotedPayload.icu_training_load,
      customPayload.icu_training_load
    );
    assert.equal(
      promotedPayload.EccentricStrainIndex,
      customPayload.EccentricStrainIndex
    );
    assert.equal(
      promotedPayload.PpgEffectiveTut,
      customPayload.PpgEffectiveTut
    );
    assert.equal(
      promotedPayload.StrengthCompliancePct,
      customPayload.StrengthCompliancePct
    );

    const customParsed = parseTelemetryJsonFromDescription(
      customPayload.description
    );
    const promotedParsed = parseTelemetryJsonFromDescription(
      promotedPayload.description
    );
    assert.equal(
      promotedParsed.EccentricStrainIndex,
      customParsed.EccentricStrainIndex
    );
    assert.equal(promotedParsed.PpgEffectiveTut, customParsed.PpgEffectiveTut);
    assert.equal(
      promotedParsed.StrengthCompliancePct,
      customParsed.StrengthCompliancePct
    );
    assert.equal(
      promotedParsed.icu_training_load,
      customParsed.icu_training_load
    );
  });

  it("parseMarkdownOffline résout automatiquement un exercice promu USER_* par son nom exact ou son ID USER_*", () => {
    const tpl = getCatalogExercise("CUSTOM_DUMBBELL");
    const userId = generateUserExerciseId(
      "Curl Incliné Haltères",
      {},
      tpl.pole
    );
    const guide = buildFallbackExerciseGuide({
      name: "Curl Incliné Haltères",
      pole: tpl.pole,
      isTimed: false,
      exerciseId: userId,
    });

    saveUserExercise({
      id: userId,
      name: "Curl Incliné Haltères",
      pole: tpl.pole,
      pattern: tpl.pattern,
      allowed_loads: [...tpl.allowed_loads],
      parasitic_reps: tpl.parasitic_reps,
      unit_tut_sec: tpl.unit_tut_sec,
      cns_spinal_tax: tpl.cns_spinal_tax,
      unit_label: tpl.unit_label,
      ...(tpl.beta_ecc !== undefined ? { beta_ecc: tpl.beta_ecc } : {}),
      is_timed: false,
      default_sets: 3,
      default_reps: 10,
      short_desc: guide.short_desc,
      guide: guide.guide,
      svg_inline: guide.svg_inline,
    });

    const mdByName = [
      "# Séance Haut du Corps",
      "- Curl Incliné Haltères | 8kg | 3x10",
    ].join("\n");
    const planByName = parseMarkdownOffline(mdByName);
    assert.equal(planByName.exercises.length, 1);
    assert.equal(planByName.exercises[0].id, userId);
    assert.equal(planByName.exercises[0].load, 8);
    assert.equal(planByName.exercises[0].sets, 3);
    assert.equal(planByName.exercises[0].reps, 10);

    const mdById = [
      "# Séance ID Explicite",
      `${userId} | 10 | 4x8`,
    ].join("\n");
    const planById = parseMarkdownOffline(mdById);
    assert.equal(planById.exercises.length, 1);
    assert.equal(planById.exercises[0].id, userId);
    assert.equal(planById.exercises[0].load, 10);
    assert.equal(planById.exercises[0].sets, 4);
    assert.equal(planById.exercises[0].reps, 8);
  });

  it("sanitizeSvgMarkup neutralise les vecteurs XSS, rejette les SVG sans primitives et préserve le SVG paramétrique conforme", () => {
    const dirtySvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" onload="alert(1)">',
      '<style>@import url("https://evil.example/a.css"); .bar { fill: #10b981; }</style>',
      "<script>alert(1)</script>",
      "<foreignObject><body xmlns=\"http://www.w3.org/1999/xhtml\"><p>XSS</p></body></foreignObject>",
      '<iframe src="https://evil.example"></iframe>',
      '<a href="javascript:alert(1)"><rect x="10" y="10" width="50" height="50" onclick=\'evil()\'/></a>',
      '<circle cx="120" cy="110" r="20" fill="#10b981"/>',
      "</svg>",
    ].join("");

    const cleaned = sanitizeSvgMarkup(dirtySvg);
    assert.equal(/<script/i.test(cleaned), false);
    assert.equal(/<foreignObject/i.test(cleaned), false);
    assert.equal(/<iframe/i.test(cleaned), false);
    assert.equal(/\bonload\s*=/i.test(cleaned), false);
    assert.equal(/\bonclick\s*=/i.test(cleaned), false);
    assert.equal(/javascript:/i.test(cleaned), false);
    assert.equal(/@import/i.test(cleaned), false);
    assert.ok(/<circle/i.test(cleaned));

    assert.throws(() => sanitizeSvgMarkup("<div>pas un svg</div>"));
    assert.throws(() =>
      sanitizeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    );

    const parametric = buildFallbackParametricSvg(
      "KBOX",
      "Squat Sangle Test",
      "USER_SQUAT_SANGLE_TEST"
    );
    const verifiedParametric = sanitizeSvgMarkup(parametric);
    assert.ok(verifiedParametric.includes("viewBox"));
    assert.ok(verifiedParametric.includes("#0d1117"));
    assert.ok(verifiedParametric.includes("#10b981"));
    assert.ok(verifiedParametric.includes("--anim-speed"));
    assert.ok(verifiedParametric.includes("--anim-state"));
  });

  it("generateExerciseCatalogEntryWithGemini offline/mocké XSS et exportUserExercisesJson propre", async () => {
    const schema = buildExerciseCatalogSchema();
    assert.ok(Array.isArray(schema.required));
    assert.ok(schema.required.includes("svg_inline"));

    let fetchCalls = 0;
    restoreFetch = stubGlobalProperty("fetch", {
      value: async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        short_desc: "Tirage poitrine élastique contrôlé.",
                        tempo_badge: "Tempo 2-1-2 • Élastique",
                        setup: "Ancrage solide face au buste.",
                        execution: [
                          "Engage les omoplates vers le bas.",
                          "Tire les coudes le long du buste.",
                          "Freine le retour sans cambrer.",
                        ],
                        errors: [
                          "Hausser les épaules.",
                          "Cambrer les lombaires.",
                          "Relâcher brusquement.",
                        ],
                        svg_inline:
                          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" onload="evil()"><script>evil()</script><rect x="20" y="20" width="200" height="180" fill="#0d1117"/><circle cx="120" cy="110" r="24" fill="#10b981"/></svg>',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    // 1. Sans clé API -> OFFLINE_FALLBACK, zéro fetch
    const offlineEntry = await generateExerciseCatalogEntryWithGemini({
      name: "Tirage Horizontal Élastique",
      pole: "BAND_CORE",
      isTimed: false,
      exerciseId: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
      apiKey: "",
    });
    assert.equal(fetchCalls, 0);
    assert.equal(offlineEntry.source, "OFFLINE_FALLBACK");
    assert.equal(offlineEntry.guide.execution.length, 3);
    assert.equal(offlineEntry.guide.errors.length, 3);
    assert.ok(offlineEntry.svg_inline.includes("<svg"));

    // 2. Avec clé API + payload Gemini contenant XSS -> assaini sans <script ni onload=
    const geminiEntry = await generateExerciseCatalogEntryWithGemini({
      name: "Tirage Horizontal Élastique",
      pole: "BAND_CORE",
      isTimed: false,
      exerciseId: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
      apiKey: "dummy_gemini_key",
      model: "gemini-2.5-flash",
    });
    assert.equal(fetchCalls, 1);
    assert.equal(geminiEntry.source, "GEMINI_CATALOG");
    assert.equal(/<script/i.test(geminiEntry.svg_inline), false);
    assert.equal(/\bonload\s*=/i.test(geminiEntry.svg_inline), false);
    assert.ok(geminiEntry.svg_inline.includes("<circle"));

    // 3. Sauvegarde + exportUserExercisesJson()
    const tpl = getCatalogExercise("CUSTOM_BAND_CORE");
    saveUserExercise({
      id: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
      name: "Tirage Horizontal Élastique",
      pole: tpl.pole,
      pattern: tpl.pattern,
      allowed_loads: [...tpl.allowed_loads],
      parasitic_reps: tpl.parasitic_reps,
      unit_tut_sec: tpl.unit_tut_sec,
      cns_spinal_tax: tpl.cns_spinal_tax,
      unit_label: tpl.unit_label,
      is_timed: false,
      default_sets: 3,
      default_reps: 12,
      short_desc: geminiEntry.short_desc,
      guide: geminiEntry.guide,
      svg_inline: geminiEntry.svg_inline,
    });

    const exportedRaw = exportUserExercisesJson();
    const exportedArr = JSON.parse(exportedRaw);
    assert.ok(Array.isArray(exportedArr));
    assert.equal(exportedArr.length, 1);
    const exportedItem = exportedArr[0];
    assert.equal(exportedItem.id, "USER_TIRAGE_HORIZONTAL_ELASTIQUE");
    assert.equal(exportedItem.pole, "BAND_CORE");
    assert.deepEqual(exportedItem.allowed_loads, tpl.allowed_loads);
    assert.equal(exportedItem.unit_tut_sec, tpl.unit_tut_sec);
    assert.equal(exportedItem.cns_spinal_tax, tpl.cns_spinal_tax);
    assert.equal(exportedItem.short_desc, geminiEntry.short_desc);
    assert.ok(exportedItem.guide);
    assert.equal(exportedItem.guide.svg_inline, undefined);
    assert.ok(typeof exportedItem.svg_inline === "string");
    assert.equal(/<script/i.test(exportedItem.svg_inline), false);
  });

  it("Exercices intégrés v1.7.1 : priorité, anti-doublon, SVG différenciés sur disque, fallback BAND_CORE et parseMarkdownOffline", () => {
    // 1. Immuabilité et présence des 2 exercices intégrés dans INTEGRATED_USER_EXERCISES
    assert.equal(Object.isFrozen(INTEGRATED_USER_EXERCISES), true);
    assert.equal(Object.isFrozen(INTEGRATED_USER_EXERCISES_BY_ID), true);
    assert.equal(INTEGRATED_USER_EXERCISES.length, 3);

    const plank = getCatalogExercise("USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND");
    const row = getCatalogExercise("USER_TIRAGE_HORIZONTAL_ELASTIQUE");
    assert.equal(plank.id, "USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND");
    assert.equal(plank.is_timed, true);
    assert.equal(plank.is_integrated_user, true);
    assert.equal(plank.is_user_catalog, true);
    assert.equal(plank.is_custom, false);
    assert.equal(row.id, "USER_TIRAGE_HORIZONTAL_ELASTIQUE");
    assert.equal(row.is_timed, false);
    assert.equal(row.is_integrated_user, true);
    assert.equal(row.is_user_catalog, true);
    assert.equal(row.is_custom, false);
    const birdDog = getCatalogExercise("USER_BIRD_DOG_ANTI_ROTATION_AU_SOL");
    assert.equal(birdDog.id, "USER_BIRD_DOG_ANTI_ROTATION_AU_SOL");
    assert.equal(birdDog.is_timed, true);
    assert.equal(birdDog.default_reps, 40);
    assert.equal(birdDog.is_integrated_user, true);
    assert.equal(birdDog.is_user_catalog, true);
    assert.equal(birdDog.is_custom, false);
    assert.equal(
      birdDog.guide.svg_path,
      "./assets/exos/USER_BIRD_DOG_ANTI_ROTATION_AU_SOL.svg"
    );

    // 2. Priorité sur localStorage & anti-doublon dans getAllCatalogExercises()
    const tplBand = getCatalogExercise("CUSTOM_BAND_CORE");
    const staleGuide = buildFallbackExerciseGuide({
      name: "Tirage Horizontal Élastique",
      pole: "BAND_CORE",
      isTimed: false,
      exerciseId: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
    });
    saveUserExercise({
      id: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
      name: "Tirage Horizontal Élastique (ancien local)",
      pole: tplBand.pole,
      pattern: tplBand.pattern,
      allowed_loads: [...tplBand.allowed_loads],
      parasitic_reps: tplBand.parasitic_reps,
      unit_tut_sec: tplBand.unit_tut_sec,
      cns_spinal_tax: tplBand.cns_spinal_tax,
      unit_label: tplBand.unit_label,
      is_timed: false,
      default_sets: 3,
      default_reps: 12,
      short_desc: staleGuide.short_desc,
      guide: staleGuide.guide,
      svg_inline: staleGuide.svg_inline,
    });

    const resolvedRow = getCatalogExercise("USER_TIRAGE_HORIZONTAL_ELASTIQUE");
    assert.equal(
      resolvedRow.guide.svg_path,
      "./assets/exos/USER_TIRAGE_HORIZONTAL_ELASTIQUE.svg"
    );
    assert.equal(resolvedRow.is_integrated_user, true);

    const allWithStale = getAllCatalogExercises();
    const matchingRowEntries = allWithStale.filter(
      (ex) => ex.id === "USER_TIRAGE_HORIZONTAL_ELASTIQUE"
    );
    assert.equal(matchingRowEntries.length, 1);
    assert.equal(allWithStale.length, 55);

    // 3. Vérification des 2 fichiers SVG sur disque
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const svgFiles = [
      "assets/exos/USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND.svg",
      "assets/exos/USER_TIRAGE_HORIZONTAL_ELASTIQUE.svg",
      "assets/exos/USER_BIRD_DOG_ANTI_ROTATION_AU_SOL.svg",
    ];
    const svgContents = [];

    for (const relPath of svgFiles) {
      const fullPath = path.join(rootDir, relPath);
      assert.equal(fs.existsSync(fullPath), true, `Fichier manquant : ${relPath}`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size < 8192, `SVG trop lourd (${stat.size} o) : ${relPath}`);
      const raw = fs.readFileSync(fullPath, "utf8");
      const clean = sanitizeSvgMarkup(raw);
      assert.ok(clean.includes('viewBox="0 0 240 220"'));
      assert.ok(clean.includes("#0d1117"));
      assert.ok(clean.includes("#10b981"));
      assert.ok(clean.includes("--anim-speed"));
      assert.ok(clean.includes("--anim-state"));
      assert.equal(/<script/i.test(clean), false);
      assert.equal(/<foreignObject/i.test(clean), false);
      assert.equal(/\bon[a-z]+\s*=/i.test(clean), false);
      svgContents.push(clean);
    }

    assert.notEqual(svgContents[0], svgContents[1]);
    assert.equal(/élastique|elastique/i.test(svgContents[0]), false);
    assert.equal(/#f59e0b/i.test(svgContents[0]), false);
    assert.notEqual(svgContents[2], svgContents[0]);
    assert.notEqual(svgContents[2], svgContents[1]);
    assert.equal(/élastique|elastique/i.test(svgContents[2]), false);
    assert.equal(/#f59e0b/i.test(svgContents[2]), false);

    // 4. Schémas paramétriques de repli distincts pour BAND_CORE (planche vs tirage)
    const fallbackPlank = buildFallbackParametricSvg(
      "BAND_CORE",
      "Planche ventrale test",
      "USER_TEST_PLANK"
    );
    const fallbackRow = buildFallbackParametricSvg(
      "BAND_CORE",
      "Tirage élastique test",
      "USER_TEST_ROW"
    );
    assert.notEqual(fallbackPlank, fallbackRow);
    assert.equal(/#f59e0b/i.test(fallbackPlank), false);
    assert.ok(/#f59e0b/i.test(fallbackRow));

    // 5. Résolution Markdown hors-ligne vers les 2 IDs intégrés
    const parsed = parseMarkdownOffline(
      [
        "Gainage planche ventrale gainage profond | 0 | 3x45s",
        "Tirage horizontal élastique | 1 | 3x12",
        "Bird-Dog anti-rotation au sol | 0 | 3x40s",
      ].join("\n")
    );
    assert.equal(parsed.exercises.length, 3);
    assert.equal(
      parsed.exercises[0].id,
      "USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND"
    );
    assert.equal(parsed.exercises[1].id, "USER_TIRAGE_HORIZONTAL_ELASTIQUE");
    assert.equal(parsed.exercises[2].id, "USER_BIRD_DOG_ANTI_ROTATION_AU_SOL");
  });
});

// ============================================================================
// 9. Sync Google Drive Webhook (driveSync.js & vault.js)
// ============================================================================

describe("9. Sync Google Drive Webhook (driveSync.js & vault.js)", () => {
  let restoreLocalStorage;

  beforeEach(() => {
    const ls = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", { value: ls });
  });

  afterEach(() => {
    restoreLocalStorage?.();
  });

  it("persiste DRIVE_WEBHOOK_URL/SECRET dans vault.js, masque le secret à l'export sans secrets et restaure via importVaultJson", () => {
    saveVault({
      INTERVALS_ATHLETE_ID: "i999",
      INTERVALS_API_KEY: "intervals-demo-key",
      GEMINI_API_KEY: "gemini-demo-key",
      LLM_MODEL: "gemini-3.5-flash",
      CP_WATTS: 325,
      DRIVE_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbTestDemo/exec",
      DRIVE_WEBHOOK_SECRET: "shared-secret-demo",
    });

    const loaded = loadVault();
    assert.equal(
      loaded.DRIVE_WEBHOOK_URL,
      "https://script.google.com/macros/s/AKfycbTestDemo/exec"
    );
    assert.equal(loaded.DRIVE_WEBHOOK_SECRET, "shared-secret-demo");
    assert.equal(loaded.CP_WATTS, 325);
    assert.equal(globalThis.localStorage.getItem("INTERVALS_ATHLETE_ID"), "i999");
    assert.equal(
      globalThis.localStorage.getItem("DRIVE_WEBHOOK_URL"),
      null,
      "Les clés Drive ne doivent pas être dupliquées dans FLAT_KEYS"
    );

    const maskedJson = exportVaultJson({ includeSecrets: false });
    const maskedObj = JSON.parse(maskedJson);
    assert.equal(
      maskedObj.DRIVE_WEBHOOK_URL,
      "https://script.google.com/macros/s/AKfycbTestDemo/exec"
    );
    assert.equal(maskedObj.DRIVE_WEBHOOK_SECRET, "");
    assert.equal(maskedObj.INTERVALS_API_KEY, "");
    assert.equal(maskedObj.GEMINI_API_KEY, "");

    const fullJson = exportVaultJson({ includeSecrets: true });
    globalThis.localStorage.clear();

    const imported = importVaultJson(fullJson);
    assert.equal(
      imported.DRIVE_WEBHOOK_URL,
      "https://script.google.com/macros/s/AKfycbTestDemo/exec"
    );
    assert.equal(imported.DRIVE_WEBHOOK_SECRET, "shared-secret-demo");
    assert.equal(imported.CP_WATTS, 325);
  });

  it("valide les URLs webhook HTTPS strictes et génère un nom de fichier horodaté valide", () => {
    const invalidCases = [
      "",
      "   ",
      "http://script.google.com/macros/s/abc/exec",
      "javascript:alert(1)",
      "not-a-url",
      "https://user:pass@script.google.com/macros/s/abc/exec",
    ];
    for (const raw of invalidCases) {
      const res = validateDriveWebhookUrl(raw);
      assert.equal(res.valid, false, `L'URL "${raw}" aurait dû être rejetée`);
      assert.ok(typeof res.error === "string" && res.error.length > 0);
    }

    const appsScriptRes = validateDriveWebhookUrl(
      "https://script.google.com/macros/s/AKfycbDemo123/exec"
    );
    assert.equal(appsScriptRes.valid, true);
    assert.equal(appsScriptRes.isAppsScript, true);
    assert.equal(appsScriptRes.error, null);

    const genericRes = validateDriveWebhookUrl(
      "https://webhook.example.com/hook"
    );
    assert.equal(genericRes.valid, true);
    assert.equal(genericRes.isAppsScript, false);
    assert.equal(genericRes.error, null);

    const filename = buildDriveExportFilename(new Date(2026, 10, 19, 8, 5, 9));
    assert.match(
      filename,
      /^webstrength-custom-exercises-\d{8}-\d{6}\.json$/
    );
    assert.equal(
      filename,
      "webstrength-custom-exercises-20261119-080509.json"
    );
  });

  it("envoie les exercices via POST text/plain sans preflight et gère les erreurs HTTP/JSON/timeout", async () => {
    const sampleExercises = [
      { id: "USER_TEST_EXO", label: "Exercice Test Drive", pole: "CORE" },
    ];
    const fixedDate = new Date("2026-11-19T08:30:00.000Z");
    let capturedUrl = null;
    let capturedInit = null;

    const okResult = await pushCustomExercisesToDrive({
      webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
      secret: "secret-123",
      exercisesJson: JSON.stringify(sampleExercises),
      now: fixedDate,
      fetchImpl: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              ok: true,
              fileId: "file_abc_123",
              fileName: "webstrength-custom-exercises-test.json",
              folderName: "WebStrength Exports",
              count: 1,
            }),
        };
      },
    });

    assert.equal(
      capturedUrl,
      "https://script.google.com/macros/s/AKfycbDemo123/exec"
    );
    assert.equal(capturedInit.method, "POST");
    assert.equal(
      capturedInit.headers["Content-Type"],
      "text/plain;charset=utf-8"
    );
    assert.equal(capturedInit.redirect, "follow");

    const sentBody = JSON.parse(capturedInit.body);
    assert.equal(sentBody.secret, "secret-123");
    assert.match(
      sentBody.filename,
      /^webstrength-custom-exercises-\d{8}-\d{6}\.json$/
    );
    assert.equal(sentBody.exported_at, fixedDate.toISOString());
    assert.equal(sentBody.app_version, DRIVE_APP_VERSION);
    assert.equal(DRIVE_APP_VERSION, "1.8.0");
    assert.deepEqual(sentBody.exercises, sampleExercises);

    assert.deepEqual(okResult, {
      ok: true,
      fileId: "file_abc_123",
      fileName: "webstrength-custom-exercises-test.json",
      folderName: "WebStrength Exports",
      count: 1,
    });

    await assert.rejects(
      () =>
        pushCustomExercisesToDrive({
          webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
          exercisesJson: "[]",
          fetchImpl: async () => {
            throw new Error("Ne doit pas être appelé");
          },
        }),
      /Aucun exercice/
    );

    await assert.rejects(
      () =>
        pushCustomExercisesToDrive({
          webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
          exercisesJson: "{}",
          fetchImpl: async () => {
            throw new Error("Ne doit pas être appelé");
          },
        }),
      /Aucun exercice/
    );

    await assert.rejects(
      () =>
        pushCustomExercisesToDrive({
          webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
          exercisesJson: sampleExercises,
          fetchImpl: async () => ({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: async () => "error",
          }),
        }),
      /500/
    );

    await assert.rejects(
      () =>
        pushCustomExercisesToDrive({
          webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
          exercisesJson: sampleExercises,
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({ ok: false, error: "unauthorized" }),
          }),
        }),
      /unauthorized/
    );

    await assert.rejects(
      () =>
        pushCustomExercisesToDrive({
          webhookUrl: "https://script.google.com/macros/s/AKfycbDemo123/exec",
          exercisesJson: sampleExercises,
          timeoutMs: 60,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener(
                "abort",
                () => {
                  const abortErr = new Error("Aborted");
                  abortErr.name = "AbortError";
                  reject(abortErr);
                },
                { once: true }
              );
            }),
        }),
      /Timeout/
    );
  });
});

// ============================================================================
// 10. Catalogue Étendu v1.9.0 (55 exercices), PDC, Vitesse/Pliométrie, SVG & SW
// ============================================================================

describe("10. Catalogue Étendu v1.9.0 (55 exercices), PDC, Vitesse/Pliométrie, SVG & Service Worker", () => {
  let restoreLocalStorage;

  beforeEach(() => {
    const memStorage = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", {
      value: memStorage,
    });
    clearUserExercises();
  });

  afterEach(() => {
    clearUserExercises();
    restoreLocalStorage?.();
    restoreLocalStorage = undefined;
  });

  it("respecte les invariants du catalogue 55 exercices, le gel profond et les 5 catégories (35 étendus)", () => {
    assert.equal(EXERCISE_IDS.length, 17);
    assert.equal(CATALOG.length, 17);
    assert.equal(INTEGRATED_USER_EXERCISES.length, 3);
    assert.equal(EXTENDED_EXERCISE_IDS.length, 35);
    assert.equal(EXTENDED_CATALOG_EXERCISES.length, 35);
    assert.equal(ALL_OFFICIAL_EXERCISES.length, 55);
    assert.equal(getAllCatalogExercises().length, 55);

    const uniqueOfficialIds = new Set(ALL_OFFICIAL_EXERCISES.map((ex) => ex.id));
    assert.equal(uniqueOfficialIds.size, 55);

    assert.equal(Object.isFrozen(EXTENDED_CATEGORIES), true);
    assert.equal(Object.isFrozen(EXTENDED_CATALOG_EXERCISES), true);
    assert.equal(Object.isFrozen(EXTENDED_CATALOG_BY_ID), true);
    assert.equal(Object.isFrozen(EXTENDED_EXERCISE_IDS), true);
    assert.equal(Object.isFrozen(ALL_OFFICIAL_EXERCISES), true);

    assert.throws(() => {
      // @ts-ignore test d'immuabilité
      EXTENDED_CATALOG_EXERCISES.push({});
    }, TypeError);

    const expectedCategoryCounts = {
      UPPER_BODY: 7,
      CORE_TRUNK: 8,
      POSTERIOR_HIP_ANKLE: 8,
      VELOCITY: 6,
      PLYOMETRICS: 6,
    };
    assert.deepEqual(
      Object.keys(EXTENDED_CATEGORIES).sort(),
      Object.keys(expectedCategoryCounts).sort()
    );

    const validPoles = new Set(["KBOX", "DUMBBELL", "BAND_CORE"]);
    const observedCounts = {
      UPPER_BODY: 0,
      CORE_TRUNK: 0,
      POSTERIOR_HIP_ANKLE: 0,
      VELOCITY: 0,
      PLYOMETRICS: 0,
    };

    for (const ex of EXTENDED_CATALOG_EXERCISES) {
      assert.equal(Object.isFrozen(ex), true, `${ex.id} doit être figé`);
      assert.equal(Object.isFrozen(ex.allowed_loads), true, `${ex.id}.allowed_loads doit être figé`);
      assert.equal(Object.isFrozen(ex.guide), true, `${ex.id}.guide doit être figé`);
      assert.equal(Object.isFrozen(ex.guide.execution), true, `${ex.id}.guide.execution doit être figé`);
      assert.equal(Object.isFrozen(ex.guide.errors), true, `${ex.id}.guide.errors doit être figé`);

      assert.throws(() => {
        // @ts-ignore test d'immuabilité
        ex.short_desc = "muté";
      }, TypeError);

      assert.equal(validPoles.has(ex.pole), true, `Pôle invalide pour ${ex.id}: ${ex.pole}`);
      assert.equal(
        Object.hasOwn(expectedCategoryCounts, ex.category),
        true,
        `Catégorie invalide pour ${ex.id}: ${ex.category}`
      );
      observedCounts[ex.category] += 1;

      assert.equal(
        typeof ex.short_desc === "string" && ex.short_desc.trim().length > 0,
        true,
        `${ex.id}.short_desc doit être non vide`
      );
      assert.equal(ex.guide.execution.length, 3, `${ex.id}.guide.execution doit avoir 3 items`);
      assert.equal(ex.guide.errors.length, 3, `${ex.id}.guide.errors doit avoir 3 items`);
      for (const step of [...ex.guide.execution, ...ex.guide.errors]) {
        assert.equal(typeof step === "string" && step.trim().length > 0, true);
      }

      assert.equal(getCatalogExercise(ex.id), ex);
    }

    assert.deepEqual(observedCounts, expectedCategoryCounts);
  });

  it("gère les tractions pronation sans hypertrophie, le PDC (load=0 / load>0) et préserve DB_COPENHAGEN à load=0", () => {
    const pullStrict = getCatalogExercise("PULL_UP_PRONATION_STRICT_BW");
    const pullTempo = getCatalogExercise("PULL_UP_PRONATION_TEMPO_ECC");
    const pullScap = getCatalogExercise("PULL_UP_PRONATION_SCAP_ISOMETRIC");

    for (const pullEx of [pullStrict, pullTempo, pullScap]) {
      assert.equal(pullEx.is_bodyweight, true);
      assert.equal(pullEx.category, "UPPER_BODY");
      assert.equal(pullEx.default_sets, 3);
      assert.equal(pullEx.bodyweight_base_kg >= 65, true);
    }

    // Force / excentrique sans hypertrophie (<= 5 reps) et maintien isométrique (20s)
    assert.equal(pullStrict.is_timed, false);
    assert.equal(pullStrict.default_reps, 4);
    assert.equal(pullTempo.is_timed, false);
    assert.equal(pullTempo.default_reps, 3);
    assert.equal(pullTempo.beta_ecc, 1.25);
    assert.equal(pullScap.is_timed, true);
    assert.equal(pullScap.default_reps, 20);

    // Vérification PDC à load=0 et PDC +2 kg à load=2 sur 3 exercices PDC distincts
    const pdcSpecs = [
      { id: "PULL_UP_PRONATION_STRICT_BW", sets: 3, reps: 4, extraLoad: 2 },
      { id: "AB_WHEEL_ROLLOUT_KNEES", sets: 3, reps: 8, extraLoad: 2 },
      { id: "PLYO_ANKLE_POGO_DOUBLE", sets: 4, reps: 15, extraLoad: 2 },
    ];

    for (const spec of pdcSpecs) {
      const exCat = getCatalogExercise(spec.id);
      assert.equal(exCat.is_bodyweight, true);
      assert.equal(
        Number(exCat.bodyweight_base_kg) > 0 || Number(exCat.bodyweight_base_load) > 0,
        true,
        `${spec.id} doit définir bodyweight_base_kg ou bodyweight_base_load`
      );

      const mZero = calculateSessionMetrics({
        exercises: [{ id: spec.id, sets: spec.sets, reps: spec.reps, load: 0, completion: 1 }],
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        elapsed_time_sec: 900,
      });
      assert.ok(mZero.EccentricStrainIndex > 0, `${spec.id} doit avoir strain > 0 à load=0`);

      const payloadZero = buildManualActivityPayload({
        dateObj: new Date("2026-11-20T08:00:00"),
        theme: "Test PDC 0",
        gate: "GREEN",
        readiness: "OPTIMAL",
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        lumbar_flag: false,
        elapsed_time_sec: 900,
        exercises: [{ id: spec.id, block: 1, sets: spec.sets, reps: spec.reps, load: 0, completion: 1 }],
      });
      assert.ok(
        payloadZero.description.includes(`| ${exCat.name} | PDC |`),
        `${spec.id} à load=0 doit formater la charge en PDC`
      );

      const mPlus = calculateSessionMetrics({
        exercises: [{ id: spec.id, sets: spec.sets, reps: spec.reps, load: spec.extraLoad, completion: 1 }],
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        elapsed_time_sec: 900,
      });
      assert.ok(
        mPlus.EccentricStrainIndex > mZero.EccentricStrainIndex,
        `${spec.id} doit avoir strain(load=${spec.extraLoad}) > strain(load=0)`
      );

      const payloadPlus = buildManualActivityPayload({
        dateObj: new Date("2026-11-20T08:00:00"),
        theme: "Test PDC +2",
        gate: "GREEN",
        readiness: "OPTIMAL",
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        lumbar_flag: false,
        elapsed_time_sec: 900,
        exercises: [{ id: spec.id, block: 1, sets: spec.sets, reps: spec.reps, load: spec.extraLoad, completion: 1 }],
      });
      assert.ok(
        payloadPlus.description.includes(`| ${exCat.name} | PDC +${spec.extraLoad} kg |`),
        `${spec.id} à load=${spec.extraLoad} doit formater la charge en PDC +${spec.extraLoad} kg`
      );
    }

    // Non-régression Suite 2 : DB_COPENHAGEN à load=0 reste à strain=0 et "0 kg"
    const copMetrics = calculateSessionMetrics({
      exercises: [{ id: "DB_COPENHAGEN", sets: 2, reps: 30, load: 0, completion: 1 }],
      k_ecc: 1.0,
      rir: 3,
      rpe: 5,
      elapsed_time_sec: 600,
    });
    assert.equal(copMetrics.PpgEffectiveTut, 60);
    assert.equal(copMetrics.EccentricStrainIndex, 0);

    const copPayload = buildManualActivityPayload({
      dateObj: new Date("2026-11-20T08:00:00"),
      theme: "Non-régression Copenhagen",
      gate: "GREEN",
      readiness: "OPTIMAL",
      k_ecc: 1.0,
      rir: 3,
      rpe: 5,
      lumbar_flag: false,
      elapsed_time_sec: 600,
      exercises: [{ id: "DB_COPENHAGEN", block: 1, sets: 2, reps: 30, load: 0, completion: 1 }],
    });
    assert.ok(copPayload.description.includes("| 0 kg |"));
    assert.equal(copPayload.description.includes("| PDC |"), false);
  });

  it("calcule proprement tous les exercices des catégories VELOCITY (6) et PLYOMETRICS (6)", () => {
    const velocityExos = EXTENDED_CATALOG_EXERCISES.filter((ex) => ex.category === "VELOCITY");
    const plyoExos = EXTENDED_CATALOG_EXERCISES.filter((ex) => ex.category === "PLYOMETRICS");

    assert.equal(velocityExos.length, 6);
    assert.equal(plyoExos.length, 6);

    for (const [catName, list] of [
      ["VELOCITY", velocityExos],
      ["PLYOMETRICS", plyoExos],
    ]) {
      const sessionItems = list.map((ex, idx) => ({
        id: ex.id,
        block: (idx % 3) + 1,
        sets: ex.default_sets,
        reps: ex.default_reps,
        load: ex.allowed_loads[0],
        completion: 1,
      }));

      const groupMetrics = calculateSessionMetrics({
        exercises: sessionItems,
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        elapsed_time_sec: 1800,
      });

      assert.equal(Number.isFinite(groupMetrics.PpgEffectiveTut) && groupMetrics.PpgEffectiveTut > 0, true);
      assert.equal(Number.isFinite(groupMetrics.EccentricStrainIndex) && groupMetrics.EccentricStrainIndex > 0, true);
      assert.equal(groupMetrics.StrengthCompliancePct, 100);
      assert.equal(Number.isFinite(groupMetrics.icu_training_load) && groupMetrics.icu_training_load > 0, true);
      assert.equal(["GREEN", "ORANGE", "RED"].includes(groupMetrics.strain_zone), true);

      const payload = buildManualActivityPayload({
        dateObj: new Date("2026-11-20T09:00:00"),
        theme: `Séance ${catName}`,
        gate: "GREEN",
        readiness: "OPTIMAL",
        k_ecc: 1.3,
        rir: 2,
        rpe: 7,
        lumbar_flag: false,
        elapsed_time_sec: 1800,
        exercises: sessionItems,
      });
      const parsedTelemetry = parseTelemetryJsonFromDescription(payload.description);
      assert.ok(parsedTelemetry);
      assert.equal(parsedTelemetry.ex.length, 6);

      for (const item of sessionItems) {
        const singleMetrics = calculateSessionMetrics({
          exercises: [item],
          k_ecc: 1.3,
          rir: 2,
          rpe: 7,
          elapsed_time_sec: 600,
        });
        assert.equal(Number.isFinite(singleMetrics.PpgEffectiveTut) && singleMetrics.PpgEffectiveTut > 0, true, item.id);
        assert.equal(Number.isFinite(singleMetrics.EccentricStrainIndex) && singleMetrics.EccentricStrainIndex > 0, true, item.id);
      }
    }
  });

  it("valide les 55 fichiers SVG sur disque : unicité des chemins, taille < 8192 o et assainissement XSS strict", () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const seenPaths = new Set();

    for (const ex of ALL_OFFICIAL_EXERCISES) {
      const svgPath = ex.guide?.svg_path;
      assert.equal(
        typeof svgPath === "string" && svgPath.startsWith("./assets/exos/") && svgPath.endsWith(".svg"),
        true,
        `Chemin SVG invalide pour ${ex.id}: ${svgPath}`
      );
      assert.equal(seenPaths.has(svgPath), false, `Chemin SVG dupliqué : ${svgPath}`);
      seenPaths.add(svgPath);

      const fullPath = path.join(rootDir, svgPath.replace(/^\.\//, ""));
      assert.equal(fs.existsSync(fullPath), true, `Fichier SVG manquant sur disque : ${svgPath}`);

      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 0 && stat.size < 8192, `${svgPath} pèse ${stat.size} o (attendu < 8192)`);

      const rawSvg = fs.readFileSync(fullPath, "utf8");
      const cleanSvg = sanitizeSvgMarkup(rawSvg);
      assert.equal(typeof cleanSvg === "string" && cleanSvg.trim().length > 0, true);
      assert.equal(cleanSvg.includes("<svg") && cleanSvg.includes("</svg>"), true, svgPath);
      assert.equal(/<script\b/i.test(cleanSvg), false, `${svgPath} contient <script>`);
      assert.equal(/<foreignObject\b/i.test(cleanSvg), false, `${svgPath} contient <foreignObject>`);
      assert.equal(/<iframe\b/i.test(cleanSvg), false, `${svgPath} contient <iframe>`);
      assert.equal(/\bon[a-z0-9_-]+\s*=/i.test(cleanSvg), false, `${svgPath} contient un attribut on*`);
      assert.equal(/javascript\s*:/i.test(cleanSvg), false, `${svgPath} contient javascript:`);
    }

    assert.equal(seenPaths.size, 55);
  });

  it("vérifie le Service Worker sw.js v1.10.0 : CACHE_NAME, extendedCatalog.js et pré-cache des 55 SVG", () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const swContent = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");

    assert.match(swContent, /const\s+CACHE_NAME\s*=\s*["']webstrength-v1\.10\.0["']\s*;/);

    const precacheMatch = swContent.match(/const\s+PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
    assert.ok(precacheMatch, "PRECACHE_ASSETS introuvable dans sw.js");

    const precachedPaths = new Set(
      Array.from(precacheMatch[1].matchAll(/["']([^"']+)["']/g), (m) => m[1])
    );

    assert.equal(
      precachedPaths.has("./extendedCatalog.js"),
      true,
      "./extendedCatalog.js doit être dans PRECACHE_ASSETS"
    );

    for (const ex of ALL_OFFICIAL_EXERCISES) {
      assert.equal(
        precachedPaths.has(ex.guide.svg_path),
        true,
        `${ex.guide.svg_path} manquant dans PRECACHE_ASSETS de sw.js`
      );
    }
  });

  it("résout les nouveaux exercices dans mdParser.js et préserve la non-régression Suite 7 sur 'Tractions Pronation'", () => {
    const planExtended = parseMarkdownOffline(
      [
        "# Séance Étendue v1.9.0",
        "Traction Pronation Stricte 3x4",
        "Ab Wheel Rollout 3x10",
        "Pogo Cheville Deux Pieds 4x15",
        "PLYO_ANKLE_POGO_DOUBLE 4x15",
      ].join("\n")
    );

    assert.equal(planExtended.exercises.length, 4);
    assert.equal(planExtended.exercises[0].id, "PULL_UP_PRONATION_STRICT_BW");
    assert.equal(planExtended.exercises[0].sets, 3);
    assert.equal(planExtended.exercises[0].reps, 4);

    assert.equal(planExtended.exercises[1].id, "AB_WHEEL_ROLLOUT_KNEES");
    assert.equal(planExtended.exercises[1].sets, 3);
    assert.equal(planExtended.exercises[1].reps, 10);

    assert.equal(planExtended.exercises[2].id, "PLYO_ANKLE_POGO_DOUBLE");
    assert.equal(planExtended.exercises[2].sets, 4);
    assert.equal(planExtended.exercises[2].reps, 15);

    assert.equal(planExtended.exercises[3].id, "PLYO_ANKLE_POGO_DOUBLE");
    assert.equal(planExtended.exercises[3].sets, 4);
    assert.equal(planExtended.exercises[3].reps, 15);

    // Non-régression Suite 7 : "- Tractions Pronation 4x10" reste CUSTOM_BAND_CORE
    const planRegression = parseMarkdownOffline("- Tractions Pronation 4x10");
    assert.equal(planRegression.exercises.length, 1);
    assert.equal(planRegression.exercises[0].id, "CUSTOM_BAND_CORE");
    assert.equal(planRegression.exercises[0].custom_label, "Tractions Pronation");
    assert.equal(planRegression.exercises[0].sets, 4);
    assert.equal(planRegression.exercises[0].reps, 10);
    assert.equal(planRegression.exercises[0].is_timed, false);
  });
});

// ============================================================================
// 11. Catalogue Complet & Filtrage Multi-Critères v1.10.0
// ============================================================================

describe("11. Catalogue Complet & Filtrage Multi-Critères v1.10.0", () => {
  let restoreLocalStorage;

  /**
   * Crée et persiste un 4e exercice utilisateur dynamique `USER_*` isolé.
   * @param {string} [name]
   * @returns {Readonly<Record<string, any>>}
   */
  function createDynamicUserExercise(name = "Rowing Anneaux Élastique Perso") {
    const tpl = getCatalogExercise("CUSTOM_BAND_CORE");
    const id = generateUserExerciseId(name, loadUserExercises(), tpl.pole);
    const fallbackGuide = buildFallbackExerciseGuide({
      name,
      pole: tpl.pole,
      isTimed: false,
      exerciseId: id,
    });
    return saveUserExercise({
      id,
      name,
      pole: tpl.pole,
      pattern: tpl.pattern,
      allowed_loads: [...tpl.allowed_loads],
      parasitic_reps: tpl.parasitic_reps,
      unit_tut_sec: tpl.unit_tut_sec,
      cns_spinal_tax: tpl.cns_spinal_tax,
      unit_label: tpl.unit_label,
      is_timed: false,
      default_sets: 3,
      default_reps: 12,
      short_desc: fallbackGuide.short_desc,
      guide: fallbackGuide.guide,
      svg_inline: fallbackGuide.svg_inline,
    });
  }

  beforeEach(() => {
    const memStorage = createMemoryLocalStorage();
    restoreLocalStorage = stubGlobalProperty("localStorage", {
      value: memStorage,
    });
    clearUserExercises();
  });

  afterEach(() => {
    clearUserExercises();
    restoreLocalStorage?.();
    restoreLocalStorage = undefined;
  });

  it("recense les 55 officiels + 1 USER_* dynamique (56 au total) et préserve EXERCISE_IDS.length === 17", () => {
    assert.equal(EXERCISE_IDS.length, 17);
    assert.equal(ALL_OFFICIAL_EXERCISES.length, 55);
    assert.equal(getAllCatalogExercises().length, 55);
    assert.equal(filterCatalogExercises(getAllCatalogExercises()).length, 55);

    const saved = createDynamicUserExercise();
    assert.equal(saved.id.startsWith("USER_"), true);
    assert.equal(EXERCISE_IDS.length, 17);

    const allWithUser = getAllCatalogExercises();
    assert.equal(allWithUser.length, 56);
    assert.equal(filterCatalogExercises(allWithUser).length, 56);

    // Cas limites défensifs de filterCatalogExercises
    assert.deepEqual(filterCatalogExercises(null), []);
    assert.deepEqual(filterCatalogExercises(undefined), []);
    assert.deepEqual(filterCatalogExercises([null, undefined, 42]), []);
    assert.equal(
      filterCatalogExercises(allWithUser, {
        query: null,
        category: "",
        equipment: "",
      }).length,
      56
    );
  });

  it("filtre exhaustivement les 7 catégories DIRECTORY_CATEGORIES (55 officiels et 56 avec USER_* dynamique)", () => {
    assert.equal(Object.isFrozen(DIRECTORY_CATEGORIES), true);
    assert.deepEqual(
      DIRECTORY_CATEGORIES.map((entry) => entry.id),
      [
        "ALL",
        "UPPER_BODY",
        "CORE_TRUNK",
        "POSTERIOR_HIP_ANKLE",
        "VELOCITY",
        "PLYOMETRICS",
        "PERSO",
      ]
    );

    const expectedOfficialCounts = {
      ALL: 55,
      UPPER_BODY: 10,
      CORE_TRUNK: 14,
      POSTERIOR_HIP_ANKLE: 19,
      VELOCITY: 6,
      PLYOMETRICS: 6,
      PERSO: 3,
    };

    for (const { id: catId } of DIRECTORY_CATEGORIES) {
      const filteredOfficial = filterCatalogExercises(ALL_OFFICIAL_EXERCISES, {
        category: catId,
      });
      assert.equal(
        filteredOfficial.length,
        expectedOfficialCounts[catId],
        `Comptage officiel inattendu pour catégorie ${catId}`
      );
      if (catId === "PERSO") {
        assert.equal(
          filteredOfficial.every(
            (ex) => Boolean(ex.is_user_catalog) || ex.id.startsWith("USER_")
          ),
          true
        );
      } else if (catId !== "ALL") {
        assert.equal(
          filteredOfficial.every((ex) => ex.category === catId),
          true
        );
      }
    }

    createDynamicUserExercise();
    const allWithDynamic = getAllCatalogExercises();
    const expectedDynamicCounts = {
      ...expectedOfficialCounts,
      ALL: 56,
      PERSO: 4,
    };

    for (const { id: catId } of DIRECTORY_CATEGORIES) {
      const filteredDynamic = filterCatalogExercises(allWithDynamic, {
        category: catId,
      });
      assert.equal(
        filteredDynamic.length,
        expectedDynamicCounts[catId],
        `Comptage avec USER_* dynamique inattendu pour catégorie ${catId}`
      );
    }
  });

  it("filtre exhaustivement les 7 équipements DIRECTORY_EQUIPMENTS et valide getExerciseEquipments", () => {
    assert.equal(Object.isFrozen(DIRECTORY_EQUIPMENTS), true);
    const equipmentIds = DIRECTORY_EQUIPMENTS.map((entry) => entry.id);
    assert.deepEqual(equipmentIds, [
      "ALL",
      "KBOX",
      "BAND",
      "DUMBBELL",
      "BARBELL",
      "KETTLEBELL",
      "AB_WHEEL",
      "PDC",
    ]);

    const concreteEquipments = equipmentIds.filter((id) => id !== "ALL");
    const expectedOfficialEqCounts = {
      KBOX: 11,
      BAND: 13,
      DUMBBELL: 8,
      BARBELL: 4,
      KETTLEBELL: 7,
      AB_WHEEL: 2,
      PDC: 20,
    };

    assert.equal(
      filterCatalogExercises(ALL_OFFICIAL_EXERCISES, { equipment: "ALL" }).length,
      55
    );

    for (const eqCode of concreteEquipments) {
      const subset = filterCatalogExercises(ALL_OFFICIAL_EXERCISES, {
        equipment: eqCode,
      });
      assert.ok(subset.length > 0, `Aucun exercice trouvé pour l'équipement ${eqCode}`);
      assert.equal(
        subset.length,
        expectedOfficialEqCounts[eqCode],
        `Comptage officiel inattendu pour équipement ${eqCode}`
      );
      for (const ex of subset) {
        assert.equal(
          getExerciseEquipments(ex).includes(eqCode),
          true,
          `${ex.id} doit inclure l'équipement ${eqCode}`
        );
      }
    }

    assert.deepEqual(
      getExerciseEquipments(getCatalogExercise("PULL_UP_PRONATION_STRICT_BW")),
      ["PDC"]
    );

    const abWheelEqs = getExerciseEquipments(
      getCatalogExercise("AB_WHEEL_ROLLOUT_KNEES")
    );
    assert.equal(abWheelEqs.includes("AB_WHEEL"), true);
    assert.equal(abWheelEqs.includes("PDC"), true);

    assert.equal(
      getExerciseEquipments(getCatalogExercise("KB_SUITCASE_CARRY")).includes(
        "KETTLEBELL"
      ),
      true
    );
    assert.equal(
      getExerciseEquipments(
        getCatalogExercise("BARBELL_BENT_ROW_OVERHAND")
      ).includes("BARBELL"),
      true
    );

    // Cas limite défensif et couverture complète sur les 55 officiels
    assert.deepEqual(getExerciseEquipments(null), ["BAND"]);
    for (const ex of ALL_OFFICIAL_EXERCISES) {
      const eqs = getExerciseEquipments(ex);
      assert.ok(Array.isArray(eqs) && eqs.length > 0, `${ex.id} sans équipement`);
      for (const code of eqs) {
        assert.equal(concreteEquipments.includes(code), true, `Code inconnu: ${code}`);
      }
    }
  });

  it("valide les combinaisons croisées (catégorie + équipement + recherche NFD insensible à la casse et aux accents)", () => {
    const saved = createDynamicUserExercise("Rowing Anneaux Élastique Perso");
    const allCatalog = getAllCatalogExercises();

    const pronationPdc = filterCatalogExercises(allCatalog, {
      category: "UPPER_BODY",
      equipment: "PDC",
      query: "pronation",
    });
    assert.equal(pronationPdc.length, 3);
    assert.deepEqual(
      pronationPdc.map((ex) => ex.id),
      [
        "PULL_UP_PRONATION_STRICT_BW",
        "PULL_UP_PRONATION_TEMPO_ECC",
        "PULL_UP_PRONATION_SCAP_ISOMETRIC",
      ]
    );

    // Normalisation NFD : accents, majuscules et espaces périphériques
    const qAccented = filterCatalogExercises(ALL_OFFICIAL_EXERCISES, {
      query: "élastiques",
    });
    const qUpperAscii = filterCatalogExercises(ALL_OFFICIAL_EXERCISES, {
      query: "ELASTIQUES",
    });
    const qPaddedMixed = filterCatalogExercises(ALL_OFFICIAL_EXERCISES, {
      query: "  ÉLaStIqUeS  ",
    });
    assert.equal(qAccented.length, 13);
    assert.deepEqual(
      qAccented.map((ex) => ex.id),
      qUpperAscii.map((ex) => ex.id)
    );
    assert.deepEqual(
      qAccented.map((ex) => ex.id),
      qPaddedMixed.map((ex) => ex.id)
    );

    const abWheelQuery = filterCatalogExercises(allCatalog, {
      equipment: "AB_WHEEL",
      query: "roue",
    });
    assert.equal(abWheelQuery.length, 2);
    assert.deepEqual(
      abWheelQuery.map((ex) => ex.id),
      ["AB_WHEEL_ROLLOUT_KNEES", "AB_WHEEL_OFFSET_ANGLE"]
    );

    const plyoPogo = filterCatalogExercises(allCatalog, {
      category: "PLYOMETRICS",
      query: "pogo",
    });
    assert.equal(plyoPogo.length, 2);
    assert.deepEqual(
      plyoPogo.map((ex) => ex.id),
      ["PLYO_ANKLE_POGO_DOUBLE", "PLYO_ANKLE_POGO_SINGLE"]
    );

    // Recherche croisée ciblant le 4e exercice dynamique dans PERSO
    const persoQuery = filterCatalogExercises(allCatalog, {
      category: "PERSO",
      query: "anneaux elastique",
    });
    assert.equal(persoQuery.length, 1);
    assert.equal(persoQuery[0].id, saved.id);

    // Combinaison incompatible -> ensemble vide sans exception
    assert.deepEqual(
      filterCatalogExercises(allCatalog, {
        category: "PLYOMETRICS",
        equipment: "BARBELL",
      }),
      []
    );
  });

  it("contrôle les SVG des 55 exercices officiels sur disque et l'assainissement svg_inline du USER_* dynamique", () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    for (const ex of ALL_OFFICIAL_EXERCISES) {
      const svgPath = ex.guide?.svg_path;
      assert.equal(
        typeof svgPath === "string" &&
          svgPath.startsWith("./assets/exos/") &&
          svgPath.endsWith(".svg"),
        true,
        `guide.svg_path invalide pour ${ex.id}`
      );
      const diskPath = path.join(rootDir, svgPath.replace(/^\.\//, ""));
      assert.equal(
        fs.existsSync(diskPath),
        true,
        `Fichier SVG manquant sur disque : ${svgPath}`
      );
    }

    const saved = createDynamicUserExercise("Fente Dynamique Perso");
    assert.equal(
      typeof saved.svg_inline === "string" && saved.svg_inline.length > 0,
      true
    );
    const cleaned = sanitizeSvgMarkup(saved.svg_inline);
    assert.equal(cleaned.includes("<svg") && cleaned.includes("</svg>"), true);
    assert.equal(/<script\b/i.test(cleaned), false);
    assert.equal(/\bon[a-z0-9_-]+\s*=/i.test(cleaned), false);
    assert.equal(/javascript\s*:/i.test(cleaned), false);
  });

  it("vérifie les contrôles statiques DOM (#catalog-directory-view), la CSP (index.html) et 0 innerHTML (app.js)", () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
    const appJs = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");

    const requiredIds = [
      "open-catalog-directory-btn",
      "catalog-directory-view",
      "close-catalog-directory-btn",
      "directory-results-count",
      "directory-search-input",
      "directory-grid",
    ];
    for (const domId of requiredIds) {
      assert.equal(
        new RegExp(`id\\s*=\\s*["']${domId}["']`).test(indexHtml),
        true,
        `ID DOM manquant dans index.html : #${domId}`
      );
    }

    for (const { id: catId } of DIRECTORY_CATEGORIES) {
      assert.equal(
        new RegExp(`data-dir-category\\s*=\\s*["']${catId}["']`).test(indexHtml),
        true,
        `Bouton data-dir-category="${catId}" manquant dans index.html`
      );
    }

    for (const { id: eqId } of DIRECTORY_EQUIPMENTS) {
      assert.equal(
        new RegExp(`data-dir-equipment\\s*=\\s*["']${eqId}["']`).test(indexHtml),
        true,
        `Bouton data-dir-equipment="${eqId}" manquant dans index.html`
      );
    }

    const cspMatch = indexHtml.match(
      /http-equiv=(["'])Content-Security-Policy\1[\s\S]*?content=(["'])([\s\S]*?)\2/i
    );
    assert.ok(cspMatch, "Balise meta CSP introuvable dans index.html");
    const cspContent = cspMatch[3];
    assert.equal(cspContent.includes("img-src 'self' data:"), true);
    assert.equal(cspContent.includes("script-src 'self'"), true);
    assert.equal(cspContent.includes("object-src 'none'"), true);

    assert.equal(
      /\binnerHTML\b/i.test(appJs),
      false,
      "app.js ne doit contenir aucune occurrence d'innerHTML (sécurité XSS)"
    );
  });
});
