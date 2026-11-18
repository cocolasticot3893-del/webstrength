/**
 * Suite complète de tests unitaires et d'invariants biomécaniques pour WebStrength.
 * Exécution : node --test tests/engine.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG,
  CATALOG_BY_ID,
  EXERCISE_IDS,
  getCatalogExercise,
} from "../catalog.js";
import {
  formatExternalId,
  mapRpeToFeeling,
  calculateSessionMetrics,
  buildSessionName,
  buildManualActivityPayload,
  parseTelemetryJsonFromDescription,
} from "../engine.js";
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
  scoreGeminiModel,
  fetchAvailableGeminiModels,
  pickBestAvailableModel,
  generateSessionWithGemini,
} from "../geminiClient.js";
import {
  INTERVALS_BASE_URL,
  CUSTOM_ACTIVITY_FIELDS,
  ensureCustomActivityFields,
  postManualActivity,
} from "../intervalsClient.js";

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
    assert.equal(parsed.ex.length, 6);
    assert.equal(parsed.ex[2].id, "KBOX_SQUAT_BELT");
    assert.equal(parsed.ex[2].load, 0.05);
    assert.equal(parsed.ex[2].c, 1);

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
