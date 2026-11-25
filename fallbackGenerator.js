/**
 * Générateur déterministe local et moteur de contraintes symboliques (garde-fou).
 * Garantit le respect strict des 5 règles biomécaniques WebStrength avant tout affichage
 * ou export, que la séance provienne de Gemini ou du fallback hors-ligne.
 */

import {
  CATALOG_BY_ID,
  filterExercisesByEquipment,
  getAllCatalogExercises,
  getCatalogExercise,
  getExerciseEquipments,
  isEquipmentProfileFull,
  isExerciseAvailable,
  normalizeEquipmentProfile,
} from "./catalog.js";

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
function isPoleAllowedInBlock(pole, block, isRule1Active, allowNoKboxBlock2 = false) {
  if (block === 1) return pole === "BAND_CORE";
  if (block === 2) {
    if (isRule1Active || allowNoKboxBlock2) {
      return pole === "DUMBBELL" || pole === "BAND_CORE" || pole === "KBOX";
    }
    return pole === "KBOX";
  }
  return pole === "DUMBBELL" || pole === "BAND_CORE";
}

/**
 * Construit une erreur typée lorsqu'aucun exercice du catalogue n'est compatible avec le matériel.
 * @returns {Error & { code: string }}
 */
function createNoCompatibleExercisesError() {
  const err = new Error("Aucun exercice compatible avec le matériel disponible.");
  err.code = "NO_COMPATIBLE_EXERCISES";
  return err;
}

/**
 * Résout le pool d'exercices autorisés si le profil matériel est restreint.
 * Retourne `null` si le profil est absent ou complet (mode 17 exercices standard).
 * @param {object} context
 * @returns {{ profile: Record<string, boolean>, pool: Array<Record<string, any>>, byId: Map<string, Record<string, any>> } | null}
 */
function resolveConstrainedEquipmentContext(context) {
  if (!context?.equipment_profile || isEquipmentProfileFull(context.equipment_profile)) {
    return null;
  }
  const profile = normalizeEquipmentProfile(context.equipment_profile);
  const pool = filterExercisesByEquipment(getAllCatalogExercises(), profile);
  if (pool.length === 0) {
    throw createNoCompatibleExercisesError();
  }
  return {
    profile,
    pool,
    byId: new Map(pool.map((ex) => [ex.id, ex])),
  };
}

/**
 * Vérifie si un exercice respecte les règles biomécaniques 1 (RED/excentrique) et 2 (lombaire)
 * ainsi que la disponibilité matérielle stricte.
 * @param {Record<string, any>} cat
 * @param {Record<string, boolean>} profile
 * @param {boolean} isRule1Active
 * @param {boolean} isRule2Active
 * @returns {boolean}
 */
function isCandidateCompliantWithRules(cat, profile, isRule1Active, isRule2Active) {
  if (!cat || !isExerciseAvailable(cat, profile)) {
    return false;
  }
  if (isRule1Active && cat.pole === "KBOX" && cat.id !== "KBOX_HIGH_PULL") {
    return false;
  }
  if (isRule2Active && (cat.id === "KBOX_SQUAT_HARNESS" || cat.id === "KBOX_RDL")) {
    return false;
  }
  return true;
}

/**
 * Résout un exercice de référence de manière sûre (retourne `null` si l'ID est inconnu).
 * @param {unknown} id
 * @returns {Record<string, any> | null}
 */
function safeLookupExercise(id) {
  if (typeof id !== "string" || !id) {
    return null;
  }
  try {
    return getCatalogExercise(id);
  } catch {
    return null;
  }
}

/**
 * Calcule un score de pertinence pour choisir un substitut ou un exercice de repli
 * dans le pool autorisé selon le bloc, le pattern, le pôle et la catégorie.
 * @param {Record<string, any>} cand
 * @param {object} opts
 * @returns {number}
 */
function scoreCandidateForSlot(cand, {
  referenceCat,
  blockNum,
  slotIdx,
  equipmentProfile,
  isRule1Active,
  targetPattern,
}) {
  let score = 0;

  if (referenceCat) {
    if (cand.pattern === referenceCat.pattern) {
      score += 120;
    } else if (
      (referenceCat.pattern === "HIP_DOMINANT" && cand.pattern === "HINGE") ||
      (referenceCat.pattern === "HINGE" && cand.pattern === "HIP_DOMINANT") ||
      (referenceCat.pattern === "KNEE_DOMINANT" && cand.pattern === "SQUAT") ||
      (referenceCat.pattern === "SQUAT" && cand.pattern === "KNEE_DOMINANT") ||
      (referenceCat.pattern === "LUMBO_PELVIC" && cand.pattern === "CORE") ||
      (referenceCat.pattern === "CORE" && cand.pattern === "LUMBO_PELVIC")
    ) {
      score += 50;
    }
    if (cand.pole === referenceCat.pole) {
      score += 60;
    }
    if (cand.category === referenceCat.category) {
      score += 30;
    }
  }

  const equips = getExerciseEquipments(cand);
  const isPdc = cand.is_bodyweight === true || equips.includes("PDC");

  if (blockNum === 1) {
    if (cand.pole === "BAND_CORE") score += 45;
    if (cand.category === "CORE_TRUNK") score += 35;
    if (isPdc) score += 15;
    if (cand.id === "CORE_MCGILL_BIG3" || cand.id === "BAND_MONSTER_WALK") score += 10;
  } else if (blockNum === 2) {
    if (!isRule1Active && equipmentProfile.KBOX !== false) {
      if (cand.pole === "KBOX") score += 70;
      if (slotIdx === 0 && cand.pattern === targetPattern) score += 45;
      if (slotIdx === 1 && cand.id === "KBOX_CALF_ECC") score += 25;
    } else {
      if (slotIdx === 0 && cand.pattern === targetPattern) score += 45;
      if (cand.category === "POSTERIOR_HIP_ANKLE") score += 35;
      if (
        cand.pattern === "KNEE_DOMINANT" ||
        cand.pattern === "HIP_DOMINANT" ||
        cand.pattern === "SQUAT" ||
        cand.pattern === "HINGE" ||
        cand.pattern === "PULL" ||
        cand.pattern === "PUSH"
      ) {
        score += 25;
      }
      if (cand.pole === "DUMBBELL") score += 15;
      if (cand.category === "UPPER_BODY") score += 10;
    }
  } else {
    if (cand.pole === "DUMBBELL" || cand.pole === "BAND_CORE") score += 35;
    if (
      cand.category === "UPPER_BODY" ||
      cand.category === "VELOCITY" ||
      cand.category === "PLYOMETRICS" ||
      cand.category === "CORE_TRUNK"
    ) {
      score += 25;
    }
    if (isPdc) score += 10;
  }

  return score;
}

/**
 * Sélectionne le meilleur exercice compatible et non encore utilisé dans `usedIds`.
 * Retourne `null` si aucun candidat unique ne reste disponible.
 */
function pickBestSubstitute({
  desiredId,
  blockNum,
  slotIdx,
  usedIds,
  allowedPool,
  equipmentProfile,
  isRule1Active,
  isRule2Active,
  targetPattern,
}) {
  const referenceCat = safeLookupExercise(desiredId);
  let best = null;
  let bestScore = -Infinity;

  for (const cand of allowedPool) {
    if (usedIds.has(cand.id)) {
      continue;
    }
    if (!isCandidateCompliantWithRules(cand, equipmentProfile, isRule1Active, isRule2Active)) {
      continue;
    }
    const score = scoreCandidateForSlot(cand, {
      referenceCat,
      blockNum,
      slotIdx,
      equipmentProfile,
      isRule1Active,
      targetPattern,
    });
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}

/**
 * Construit une entrée d'exercice normalisée à partir d'un candidat brut et de sa fiche catalogue.
 */
function buildNormalizedSlotEntry(cat, blockNum, candidate, isRule1Active, allowCandidateLoad = true) {
  const maxReps = cat.is_timed ? 300 : 30;
  const defaultReps = cat.is_timed ? (isRule1Active ? 45 : 60) : cat.pole === "KBOX" ? 5 : 8;
  const sets = candidate
    ? Math.round(clampFiniteNumber(candidate.sets, 1, 6, isRule1Active ? 2 : 3))
    : isRule1Active
      ? 2
      : 3;
  const reps = candidate
    ? Math.round(clampFiniteNumber(candidate.reps, 1, maxReps, defaultReps))
    : defaultReps;
  const rawLoad =
    allowCandidateLoad && candidate && candidate.load !== undefined && candidate.load !== null
      ? Number(candidate.load)
      : cat.allowed_loads[0];

  return {
    id: cat.id,
    block: blockNum,
    sets,
    reps,
    load: Number.isFinite(rawLoad) ? rawLoad : cat.allowed_loads[0],
  };
}

/**
 * Applique les contraintes symboliques en mode profil matériel restreint :
 * filtre sur le pool autorisé, remplace tout exercice incompatible/hors-règle
 * sans jamais dupliquer d'ID, lève l'exigence kBox sur le Bloc 2 si `KBOX === false`,
 * et applique les Règles 1, 2, 3, 4 + snap des charges.
 */
function buildConstrainedExercises({
  buckets,
  equipmentCtx,
  isRule1Active,
  isRule2Active,
  allow075,
  gate,
  targetPattern,
  appliedRules,
}) {
  const { profile, pool, byId } = equipmentCtx;
  const isKboxEnabled = profile.KBOX !== false;
  const hasUnusedKbox = (usedIds) =>
    isKboxEnabled &&
    !isRule1Active &&
    pool.some(
      (ex) =>
        ex.pole === "KBOX" &&
        !usedIds.has(ex.id) &&
        isCandidateCompliantWithRules(ex, profile, isRule1Active, isRule2Active)
    );

  // Passe 1 : conserver les candidats valides, disponibles et conformes aux règles
  /** @type {Array<{ blockNum: 1|2|3, slotIdx: number, entry: any | null, desiredId: string | null, candidate: any | null }>} */
  const slots = [];
  const usedIds = new Set();

  for (const blockNum of [1, 2, 3]) {
    for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
      const candidate = buckets[blockNum][slotIdx] ?? null;
      const desiredId = typeof candidate?.id === "string" ? candidate.id : null;
      let entry = null;

      if (desiredId && byId.has(desiredId) && !usedIds.has(desiredId)) {
        const cat = byId.get(desiredId);
        if (isCandidateCompliantWithRules(cat, profile, isRule1Active, isRule2Active)) {
          // Hors Règle 1 et si kBox disponible, Bloc 2 privilégie KBOX si au moins un KBOX reste dispo
          const blockKboxMismatch =
            blockNum === 2 &&
            isKboxEnabled &&
            !isRule1Active &&
            cat.pole !== "KBOX" &&
            pool.some(
              (ex) =>
                ex.pole === "KBOX" &&
                isCandidateCompliantWithRules(ex, profile, isRule1Active, isRule2Active)
            );
          if (!blockKboxMismatch) {
            entry = buildNormalizedSlotEntry(cat, blockNum, candidate, isRule1Active, true);
            usedIds.add(cat.id);
          }
        }
      }

      slots.push({ blockNum, slotIdx, entry, desiredId, candidate });
    }
  }

  // Passe 2 : substituer les emplacements vides ou incompatibles sans jamais dupliquer d'ID
  for (const slot of slots) {
    if (slot.entry) {
      continue;
    }

    // Règle 2 directe si l'exercice demandé était interdit lombaire mais son substitut direct est dispo
    let directRule2Id = null;
    if (isRule2Active && slot.desiredId === "KBOX_SQUAT_HARNESS") {
      directRule2Id = "KBOX_SQUAT_BELT";
    } else if (isRule2Active && slot.desiredId === "KBOX_RDL") {
      directRule2Id = "KBOX_HIP_THRUST";
    }

    if (directRule2Id && byId.has(directRule2Id) && !usedIds.has(directRule2Id)) {
      const cat = byId.get(directRule2Id);
      if (isCandidateCompliantWithRules(cat, profile, isRule1Active, isRule2Active)) {
        slot.entry = buildNormalizedSlotEntry(cat, slot.blockNum, slot.candidate, isRule1Active, true);
        usedIds.add(cat.id);
        continue;
      }
    }

    const sub = pickBestSubstitute({
      desiredId: slot.desiredId,
      blockNum: slot.blockNum,
      slotIdx: slot.slotIdx,
      usedIds,
      allowedPool: pool,
      equipmentProfile: profile,
      isRule1Active,
      isRule2Active,
      targetPattern,
    });

    if (sub) {
      const refCat = safeLookupExercise(slot.desiredId);
      const keepLoad = refCat && refCat.pole === sub.pole;
      slot.entry = buildNormalizedSlotEntry(sub, slot.blockNum, slot.candidate, isRule1Active, keepLoad);
      usedIds.add(sub.id);
    }
  }

  // Règle 4 sur Bloc 2 slot 0 uniquement si kBox est actif et hors Règle 1
  const block2Slot0 = slots.find((s) => s.blockNum === 2 && s.slotIdx === 0);
  if (block2Slot0?.entry && isKboxEnabled && !isRule1Active) {
    const curCat = getCatalogExercise(block2Slot0.entry.id);
    if (curCat.pattern !== targetPattern) {
      const preferredKboxId =
        targetPattern === "KNEE_DOMINANT" ? "KBOX_SQUAT_BELT" : "KBOX_HIP_THRUST";
      if (byId.has(preferredKboxId) && !usedIds.has(preferredKboxId)) {
        const prefCat = byId.get(preferredKboxId);
        if (isCandidateCompliantWithRules(prefCat, profile, isRule1Active, isRule2Active)) {
          usedIds.delete(block2Slot0.entry.id);
          block2Slot0.entry.id = prefCat.id;
          usedIds.add(prefCat.id);
          appliedRules.push(`RÈGLE_4_ALTERNANCE_${targetPattern}`);
        }
      } else if (!hasUnusedKbox(usedIds)) {
        // Aucun KBOX alternatif disponible : conserver l'exercice compatible
      }
    }
  }

  // Finalisation : Règle 1/3, snap allowed_loads, bornage sets/reps
  let count075 = 0;
  const finalExercises = [];
  for (const slot of slots) {
    if (!slot.entry) {
      continue;
    }
    const next = { ...slot.entry };
    const finalCat = getCatalogExercise(next.id);

    if (isRule1Active && finalCat.id === "KBOX_HIGH_PULL") {
      next.load = 0.025;
      next.sets = Math.min(next.sets, 2);
    }

    next.load = snapToAllowedLoad(next.load, finalCat.allowed_loads);

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

    const maxSets = isRule1Active ? 2 : gate === "ORANGE" ? 3 : 6;
    const maxReps = finalCat.is_timed ? 300 : 30;
    next.sets = Math.min(maxSets, Math.max(1, Math.round(next.sets)));
    next.reps = Math.min(maxReps, Math.max(1, Math.round(next.reps)));

    finalExercises.push(next);
  }

  return finalExercises;
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
 * @param {Record<string, boolean> | null} [context.equipment_profile]
 */
export function enforceSymbolicConstraints(rawPlan, context = {}) {
  const equipmentCtx = resolveConstrainedEquipmentContext(context);
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

  // Normalisation de la structure exacte : 3 blocs × 2 exercices = 6 exercices (ou moins si pool < 6)
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

  let finalExercises;
  if (equipmentCtx) {
    finalExercises = buildConstrainedExercises({
      buckets,
      equipmentCtx,
      isRule1Active,
      isRule2Active,
      allow075,
      gate,
      targetPattern,
      appliedRules,
    });
  } else {
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
    finalExercises = normalizedExercises.map((ex, idx) => {
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
  }

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
 * Construit un brouillon de séance déterministe adapté au pool d'exercices autorisés
 * lorsque le profil matériel n'est pas complet.
 */
function buildConstrainedFallbackDraft({
  equipmentCtx,
  gate,
  readiness,
  isRule1Active,
  isRule2Active,
  dominantPattern,
}) {
  const { profile, pool } = equipmentCtx;
  const isGreenOptimal = gate === "GREEN" && readiness === "OPTIMAL" && !isRule1Active;
  const setsCount = isRule1Active ? 2 : 3;
  const usedIds = new Set();
  const picked = [];

  // Prioriser le bloc principal (Bloc 2) puis Bloc 1 et Bloc 3 afin de répartir au mieux si pool < 6
  const slotOrder = [
    [2, 0],
    [1, 0],
    [3, 0],
    [2, 1],
    [1, 1],
    [3, 1],
  ];

  for (const [blockNum, slotIdx] of slotOrder) {
    const chosen = pickBestSubstitute({
      desiredId: null,
      blockNum,
      slotIdx,
      usedIds,
      allowedPool: pool,
      equipmentProfile: profile,
      isRule1Active,
      isRule2Active,
      targetPattern: dominantPattern,
    });
    if (!chosen) {
      continue;
    }
    usedIds.add(chosen.id);
    const defaultLoad =
      chosen.pole === "KBOX"
        ? isRule1Active
          ? 0.025
          : isGreenOptimal
            ? 0.075
            : 0.05
        : chosen.allowed_loads[0];
    picked.push({
      id: chosen.id,
      block: blockNum,
      _slot: slotIdx,
      sets: setsCount,
      reps: chosen.is_timed ? (isRule1Active ? 45 : 60) : chosen.pole === "KBOX" ? 5 : 8,
      load: snapToAllowedLoad(defaultLoad, chosen.allowed_loads),
    });
  }

  picked.sort((a, b) => a.block - b.block || a._slot - b._slot);
  const exercises = picked.map(({ _slot, ...entry }) => entry);

  if (isRule1Active) {
    return {
      theme: "Décharge Neuromusculaire & Matériel Adapté",
      rationale:
        "Gate RED ou délai < 36h : séance de récupération adaptée au matériel disponible sans surcharge kBox bas du corps.",
      recommended_k_ecc: 1.0,
      recommended_rir: 3,
      recommended_rpe: 5,
      target_duration_sec: 1320,
      exercises,
    };
  }

  const theme =
    dominantPattern === "KNEE_DOMINANT"
      ? "Force & Stabilité Genou (Matériel Adapté)"
      : "Chaîne Postérieure & Gainage (Matériel Adapté)";
  const rationale = isGreenOptimal
    ? `Feu vert (GREEN / OPTIMAL) adapté au matériel disponible (${exercises.length} exercices compatibles).`
    : `Vigilance ${gate} adaptée au matériel disponible (${exercises.length} exercices compatibles, volume maîtrisé).`;

  return {
    theme,
    rationale,
    recommended_k_ecc: isGreenOptimal ? 1.4 : 1.3,
    recommended_rir: isGreenOptimal ? 1 : 2,
    recommended_rpe: isGreenOptimal ? 8 : 7,
    target_duration_sec: isGreenOptimal ? 2400 : 2100,
    exercises,
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
 * @param {Record<string, boolean> | null} [context.equipment_profile]
 */
export function generateFallbackSession(context = {}) {
  const equipmentCtx = resolveConstrainedEquipmentContext(context);
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

  if (equipmentCtx) {
    const constrainedDraft = buildConstrainedFallbackDraft({
      equipmentCtx,
      gate,
      readiness,
      isRule1Active,
      isRule2Active,
      dominantPattern,
    });
    return enforceSymbolicConstraints(constrainedDraft, context);
  }

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
