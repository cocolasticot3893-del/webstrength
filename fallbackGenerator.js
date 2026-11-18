/**
 * Générateur déterministe local et moteur de contraintes symboliques (garde-fou).
 * Garantit le respect strict des 5 règles biomécaniques WebStrength avant tout affichage
 * ou export, que la séance provienne de Gemini ou du fallback hors-ligne.
 */

import { CATALOG_BY_ID, getCatalogExercise } from "./catalog.js";

/**
 * Arrondit / aligne une charge sur la valeur autorisée la plus proche dans `allowed_loads`.
 * En cas d'égalité de distance, privilégie la charge inférieure par sécurité.
 * @param {number} targetLoad
 * @param {readonly number[]} allowedLoads
 * @returns {number}
 */
function snapToAllowedLoad(targetLoad, allowedLoads) {
  const num = Number(targetLoad);
  if (!Number.isFinite(num)) {
    return allowedLoads[0];
  }
  let best = allowedLoads[0];
  let bestDiff = Math.abs(num - best);

  for (let i = 1; i < allowedLoads.length; i++) {
    const candidate = allowedLoads[i];
    const diff = Math.abs(num - candidate);
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && candidate < best)) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Détermine la dominante biomécanique alternée (Règle 4).
 * Si la dernière dominante était KNEE_DOMINANT, bascule sur HIP_DOMINANT, et inversement.
 * @param {string | null | undefined} lastDominantPattern
 * @returns {"KNEE_DOMINANT" | "HIP_DOMINANT"}
 */
export function determineDominantPattern(lastDominantPattern) {
  return lastDominantPattern === "KNEE_DOMINANT"
    ? "HIP_DOMINANT"
    : "KNEE_DOMINANT";
}

/**
 * Convertit une valeur en nombre fini borné ou retourne un repli sûr.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampFiniteNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * Parse un nombre optionnel en retournant `null` si absent ou non fini.
 * @param {unknown} value
 * @returns {number | null}
 */
function toOptionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Assainit un texte généré (supprime balises HTML et caractères de contrôle)
 * et le tronque proprement à `maxLen` caractères sur une seule ligne.
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizePlanText(value, maxLen) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trimEnd() : cleaned;
}

/**
 * Retourne un exercice de repli valide correspondant au bloc (1, 2 ou 3) et au contexte.
 * @param {1|2|3} block
 * @param {number} slotIndex
 * @param {boolean} isRule1Active
 * @param {"KNEE_DOMINANT"|"HIP_DOMINANT"} targetPattern
 */
function getSafeSlotFallback(block, slotIndex, isRule1Active, targetPattern) {
  if (block === 1) {
    return slotIndex === 0
      ? { id: "CORE_MCGILL_BIG3", block: 1, sets: 3, reps: 90, load: 1 }
      : { id: "BAND_MONSTER_WALK", block: 1, sets: 3, reps: 60, load: 2 };
  }

  if (block === 2) {
    if (isRule1Active) {
      return slotIndex === 0
        ? { id: "DB_COPENHAGEN", block: 2, sets: 2, reps: 30, load: 0 }
        : { id: "BAND_FACE_PULL", block: 2, sets: 2, reps: 45, load: 1 };
    }
    if (slotIndex === 0) {
      return {
        id:
          targetPattern === "KNEE_DOMINANT"
            ? "KBOX_SQUAT_BELT"
            : "KBOX_HIP_THRUST",
        block: 2,
        sets: 3,
        reps: 5,
        load: 0.05,
      };
    }
    return { id: "KBOX_CALF_ECC", block: 2, sets: 3, reps: 6, load: 0.025 };
  }

  // Bloc 3
  if (isRule1Active) {
    return slotIndex === 0
      ? { id: "DB_RENEGADE_ROW", block: 3, sets: 2, reps: 8, load: 6 }
      : { id: "BAND_PALLOF_PRESS", block: 3, sets: 2, reps: 45, load: 2 };
  }
  return slotIndex === 0
    ? {
        id: targetPattern === "KNEE_DOMINANT" ? "DB_SL_RDL" : "DB_STEP_DOWN",
        block: 3,
        sets: 3,
        reps: 10,
        load: 8,
      }
    : { id: "BAND_PALLOF_PRESS", block: 3, sets: 3, reps: 60, load: 3 };
}

/**
 * Vérifie si un pôle est autorisé dans le bloc donné.
 * @param {string} pole
 * @param {1|2|3} block
 * @param {boolean} isRule1Active
 * @returns {boolean}
 */
function isPoleAllowedInBlock(pole, block, isRule1Active) {
  if (block === 1) return pole === "BAND_CORE";
  if (block === 2) {
    return isRule1Active
      ? pole === "DUMBBELL" || pole === "BAND_CORE" || pole === "KBOX"
      : pole === "KBOX";
  }
  return pole === "DUMBBELL" || pole === "BAND_CORE";
}

/**
 * Applique strictement les 5 règles biomécaniques symboliques sur un plan brut.
 * @param {object} rawPlan
 * @param {object} context
 * @param {"GREEN"|"ORANGE"|"RED"} context.gate
 * @param {"OPTIMAL"|"MODERATE"|"COMPROMISED"|string} context.readiness
 * @param {boolean} [context.lumbar_flag]
 * @param {number} [context.yesterday_bike_hours]
 * @param {number | null} [context.hours_since_last_eccentric]
 * @param {string | null} [context.last_dominant_pattern]
 */
export function enforceSymbolicConstraints(rawPlan, context = {}) {
  const gate = context.gate ?? "ORANGE";
  const readiness = context.readiness ?? "OPTIMAL";
  const lumbarFlag = Boolean(context.lumbar_flag);
  const yesterdayBikeHours = clampFiniteNumber(
    context.yesterday_bike_hours,
    0,
    24,
    0
  );
  const hoursSinceEcc = toOptionalFiniteNumber(
    context.hours_since_last_eccentric
  );

  const isRule1Active =
    gate === "RED" || (Number.isFinite(hoursSinceEcc) && hoursSinceEcc < 36);
  const isRule2Active = lumbarFlag || yesterdayBikeHours > 4;
  const allow075 = gate === "GREEN" && readiness === "OPTIMAL" && !isRule1Active;
  const targetPattern = determineDominantPattern(context.last_dominant_pattern);

  const appliedRules = [];
  if (isRule1Active) {
    appliedRules.push(
      gate === "RED"
        ? "RÈGLE_1_RED_GATE_DECHARGE"
        : "RÈGLE_1_DELAI_EXCENTRIQUE_INF_36H"
    );
  }
  if (isRule2Active) {
    appliedRules.push(
      lumbarFlag
        ? "RÈGLE_2_DECHARGE_LOMBAIRE_ACTIVE"
        : "RÈGLE_2_POST_VELO_SUP_4H"
    );
  }

  // Normalisation de la structure exacte : 3 blocs × 2 exercices = 6 exercices
  const sourceExercises = Array.isArray(rawPlan?.exercises)
    ? rawPlan.exercises
    : [];

  const buckets = { 1: [], 2: [], 3: [] };
  sourceExercises.forEach((item, idx) => {
    const inferredBlock =
      item?.block === 1 || item?.block === 2 || item?.block === 3
        ? item.block
        : idx < 2
          ? 1
          : idx < 4
            ? 2
            : 3;
    if (buckets[inferredBlock].length < 2) {
      buckets[inferredBlock].push(item);
    }
  });

  const normalizedExercises = [];
  for (const blockNum of [1, 2, 3]) {
    for (let slot = 0; slot < 2; slot++) {
      const candidate = buckets[blockNum][slot];
      let ex;

      if (candidate && typeof candidate.id === "string" && Object.hasOwn(CATALOG_BY_ID, candidate.id)) {
        const cat = getCatalogExercise(candidate.id);
        if (isPoleAllowedInBlock(cat.pole, blockNum, isRule1Active)) {
          const maxReps = cat.is_timed ? 300 : 30;
          const defaultReps = cat.is_timed ? 60 : 5;
          ex = {
            id: cat.id,
            block: blockNum,
            sets: Math.round(clampFiniteNumber(candidate.sets, 1, 6, 3)),
            reps: Math.round(
              clampFiniteNumber(candidate.reps, 1, maxReps, defaultReps)
            ),
            load: Number(candidate.load ?? cat.allowed_loads[0]),
          };
        } else {
          ex = getSafeSlotFallback(blockNum, slot, isRule1Active, targetPattern);
        }
      } else {
        ex = getSafeSlotFallback(blockNum, slot, isRule1Active, targetPattern);
      }

      normalizedExercises.push(ex);
    }
  }

  // Application des Règles 1, 2, 3 et 4 sur les 6 exercices
  let count075 = 0;
  const finalExercises = normalizedExercises.map((ex, idx) => {
    let next = { ...ex };

    // Règle 1 : interdiction KBOX sauf KBOX_HIGH_PULL <= 0.025
    if (isRule1Active) {
      const cat = getCatalogExercise(next.id);
      if (cat.pole === "KBOX") {
        if (next.id === "KBOX_HIGH_PULL") {
          next.load = 0.025;
          next.sets = Math.min(next.sets, 2);
        } else {
          // Remplacement ciblé Pôle B/C selon le bloc et la fente
          const replacementPool = [
            { id: "DB_COPENHAGEN", reps: 30, load: 0 },
            { id: "BAND_FACE_PULL", reps: 45, load: 1 },
            { id: "DB_RENEGADE_ROW", reps: 8, load: 6 },
            { id: "BAND_PALLOF_PRESS", reps: 45, load: 2 },
          ];
          const chosen =
            next.block === 2
              ? idx % 2 === 0
                ? replacementPool[0]
                : replacementPool[1]
              : idx % 2 === 0
                ? replacementPool[2]
                : replacementPool[3];
          next = {
            id: chosen.id,
            block: next.block,
            sets: Math.min(next.sets, 2),
            reps: chosen.reps,
            load: chosen.load,
          };
        }
      }
    }

    // Règle 2 : décharge L4-L5
    if (isRule2Active) {
      if (next.id === "KBOX_SQUAT_HARNESS") {
        next.id = "KBOX_SQUAT_BELT";
      } else if (next.id === "KBOX_RDL") {
        next.id = "KBOX_HIP_THRUST";
      }
    }

    // Règle 4 : alternance du Bloc 2 (slot 0) hors RED Gate / Règle 1
    if (!isRule1Active && next.block === 2 && idx === 2) {
      const cat = getCatalogExercise(next.id);
      if (cat.pattern !== targetPattern) {
        next.id =
          targetPattern === "KNEE_DOMINANT"
            ? "KBOX_SQUAT_BELT"
            : "KBOX_HIP_THRUST";
        appliedRules.push(`RÈGLE_4_ALTERNANCE_${targetPattern}`);
      }
    }

    // Snap vers allowed_loads du catalogue final
    const finalCat = getCatalogExercise(next.id);
    next.load = snapToAllowedLoad(next.load, finalCat.allowed_loads);

    // Règle 3 : plafond d'inertie 0.075 et restrictions ORANGE
    if (finalCat.pole === "KBOX") {
      if (next.load >= 0.075) {
        if (allow075 && count075 < 2) {
          count075 += 1;
        } else {
          next.load = snapToAllowedLoad(0.05, finalCat.allowed_loads);
          appliedRules.push("RÈGLE_3_PLAFOND_INERTIE_0.050");
        }
      }
      if (gate === "ORANGE" && next.load > 0.05) {
        next.load = snapToAllowedLoad(0.05, finalCat.allowed_loads);
      }
    }

    // Plafonds stricts de séries et de répétitions
    const maxSets = isRule1Active ? 2 : gate === "ORANGE" ? 3 : 6;
    const maxReps = finalCat.is_timed ? 300 : 30;
    next.sets = Math.min(maxSets, Math.max(1, Math.round(next.sets)));
    next.reps = Math.min(maxReps, Math.max(1, Math.round(next.reps)));

    return next;
  });

  // Détermination des paramètres globaux contraints (validation finie + bornes strictes)
  let recommended_k_ecc = clampFiniteNumber(
    rawPlan?.recommended_k_ecc,
    1.0,
    1.7,
    1.3
  );
  let recommended_rir = Math.round(
    clampFiniteNumber(rawPlan?.recommended_rir, 0, 5, 2)
  );
  let recommended_rpe = Math.round(
    clampFiniteNumber(rawPlan?.recommended_rpe, 1, 10, 7)
  );
  let target_duration_sec = Math.round(
    clampFiniteNumber(rawPlan?.target_duration_sec, 600, 5400, 2100)
  );

  if (isRule1Active) {
    recommended_k_ecc = 1.0;
    recommended_rir = Math.min(5, Math.max(recommended_rir, 3));
    recommended_rpe = Math.max(1, Math.min(recommended_rpe, 5));
    target_duration_sec = 1320;
  } else if (gate === "ORANGE") {
    recommended_k_ecc = 1.3;
    recommended_rir = Math.min(5, Math.max(recommended_rir, 2));
    recommended_rpe = Math.max(1, Math.min(recommended_rpe, 7));
    target_duration_sec = Math.min(target_duration_sec, 2100);
    if (!appliedRules.includes("RÈGLE_3_ORANGE_KECC_1.3_MAX3SETS")) {
      appliedRules.push("RÈGLE_3_ORANGE_KECC_1.3_MAX3SETS");
    }
  } else if (gate === "GREEN" && readiness === "OPTIMAL") {
    if (!appliedRules.includes("RÈGLE_3_GREEN_OPTIMAL")) {
      appliedRules.push("RÈGLE_3_GREEN_OPTIMAL");
    }
  }

  const defaultTheme = isRule1Active
    ? "Récupération Neuromusculaire & Stabilité"
    : `Force Excentrique ${targetPattern === "KNEE_DOMINANT" ? "Genou" : "Hanche"}`;
  const defaultRationale = `Séance validée sous garde-fou symbolique (Gate ${gate}, Readiness ${readiness}).`;

  const safeTheme = sanitizePlanText(rawPlan?.theme, 100);
  const safeRationale = sanitizePlanText(rawPlan?.rationale, 300);

  return {
    theme: safeTheme || sanitizePlanText(defaultTheme, 100),
    rationale: safeRationale || sanitizePlanText(defaultRationale, 300),
    recommended_k_ecc,
    recommended_rir,
    recommended_rpe,
    target_duration_sec,
    dominant_pattern: isRule1Active ? "LUMBO_PELVIC" : targetPattern,
    applied_rules: [...new Set(appliedRules)],
    exercises: finalExercises,
  };
}

/**
 * Génère instantanément une séance complète déterministe sans appel réseau (mode fallback).
 * Calibrée pour produire en ORANGE standard (35 min, RPE 7, k_ecc 1.3, RIR 2) :
 * icu_training_load dans [28, 38] et EccentricStrainIndex dans [130, 175].
 * @param {object} context
 * @param {"GREEN"|"ORANGE"|"RED"} context.gate
 * @param {"OPTIMAL"|"MODERATE"|"COMPROMISED"|string} context.readiness
 * @param {boolean} [context.lumbar_flag]
 * @param {number} [context.yesterday_bike_hours]
 * @param {number | null} [context.hours_since_last_eccentric]
 * @param {string | null} [context.last_dominant_pattern]
 */
export function generateFallbackSession(context = {}) {
  const gate = context.gate ?? "ORANGE";
  const readiness = context.readiness ?? "OPTIMAL";
  const lumbarFlag = Boolean(context.lumbar_flag);
  const yesterdayBikeHours = clampFiniteNumber(
    context.yesterday_bike_hours,
    0,
    24,
    0
  );
  const hoursSinceEcc = toOptionalFiniteNumber(
    context.hours_since_last_eccentric
  );

  const isRule1Active =
    gate === "RED" || (Number.isFinite(hoursSinceEcc) && hoursSinceEcc < 36);
  const isRule2Active = lumbarFlag || yesterdayBikeHours > 4;
  const dominantPattern = determineDominantPattern(context.last_dominant_pattern);

  if (isRule1Active) {
    const redDraft = {
      theme: "Décharge Neuromusculaire & Gainage Pelvien",
      rationale:
        "Gate RED ou délai < 36h depuis le dernier stimulus excentrique : suppression kBox bas du corps, priorité contrôle lombo-pelvien et mobilité scapulaire (22 min).",
      recommended_k_ecc: 1.0,
      recommended_rir: 3,
      recommended_rpe: 5,
      target_duration_sec: 1320,
      exercises: [
        { id: "CORE_MCGILL_BIG3", block: 1, sets: 2, reps: 60, load: 1 },
        { id: "BAND_MONSTER_WALK", block: 1, sets: 2, reps: 45, load: 2 },
        { id: "DB_COPENHAGEN", block: 2, sets: 2, reps: 30, load: 0 },
        { id: "BAND_FACE_PULL", block: 2, sets: 2, reps: 45, load: 1 },
        { id: "DB_RENEGADE_ROW", block: 3, sets: 2, reps: 8, load: 6 },
        { id: "BAND_PALLOF_PRESS", block: 3, sets: 2, reps: 45, load: 2 },
      ],
    };
    return enforceSymbolicConstraints(redDraft, context);
  }

  const isGreenOptimal = gate === "GREEN" && readiness === "OPTIMAL";
  const kboxPrimaryLoad = isGreenOptimal ? 0.075 : 0.05;
  const setsCount = 3;

  const kboxPrimaryId =
    dominantPattern === "KNEE_DOMINANT"
      ? isRule2Active || !isGreenOptimal
        ? "KBOX_SQUAT_BELT"
        : "KBOX_SQUAT_HARNESS"
      : isRule2Active || !isGreenOptimal
        ? "KBOX_HIP_THRUST"
        : "KBOX_RDL";

  const dbComplementId =
    dominantPattern === "KNEE_DOMINANT" ? "DB_SL_RDL" : "DB_STEP_DOWN";

  const theme =
    dominantPattern === "KNEE_DOMINANT"
      ? "Force Excentrique Genou & Raideur Tendineuse"
      : "Chaîne Postérieure & Stabilité Lombo-Pelvienne";

  const rationale = isGreenOptimal
    ? `Feu vert (GREEN / OPTIMAL) : surcharge inertielle ${kboxPrimaryLoad.toFixed(3)} kg·m² sur dominante ${dominantPattern}${isRule2Active ? " avec décharge lombaire L4-L5" : ""}.`
    : `Vigilance ORANGE : inertie plafonnée à 0.050 kg·m², k_ecc=1.3 et volume strict à 3 séries pour contenir l'indice de strain excentrique dans la zone cible.`;

  const draftPlan = {
    theme,
    rationale,
    recommended_k_ecc: isGreenOptimal ? 1.4 : 1.3,
    recommended_rir: isGreenOptimal ? 1 : 2,
    recommended_rpe: isGreenOptimal ? 8 : 7,
    target_duration_sec: isGreenOptimal ? 2400 : 2100,
    exercises: [
      { id: "CORE_MCGILL_BIG3", block: 1, sets: setsCount, reps: 90, load: 1 },
      { id: "BAND_MONSTER_WALK", block: 1, sets: setsCount, reps: 60, load: 2 },
      { id: kboxPrimaryId, block: 2, sets: setsCount, reps: 5, load: kboxPrimaryLoad },
      { id: "KBOX_CALF_ECC", block: 2, sets: setsCount, reps: 6, load: 0.025 },
      { id: dbComplementId, block: 3, sets: setsCount, reps: 10, load: 8 },
      { id: "BAND_PALLOF_PRESS", block: 3, sets: setsCount, reps: 60, load: 3 },
    ],
  };

  return enforceSymbolicConstraints(draftPlan, context);
}
