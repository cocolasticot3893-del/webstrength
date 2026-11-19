/**
 * Moteur mathématique et générateur de télémétrie Intervals.icu pour WebStrength.
 * Calcul 100 % déterministe des métriques biomécaniques (TUT effectif, Strain Excentrique,
 * Compliance pondérée, Load Intervals.icu) et sérialisation / parsing de payload.
 */

import { getCatalogExercise } from "./catalog.js";

/**
 * Formate un entier sur 2 chiffres.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Formate une date en ISO local sans fuseau (`YYYY-MM-DDTHH:mm:ss`).
 * @param {Date} dateObj
 * @returns {string}
 */
function formatLocalIsoDateTime(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Formate l'identifiant externe unique Intervals.icu en heure locale.
 * Format : `pwa_strength_YYYY-MM-DD_HHmm`.
 * @param {Date} dateObj
 * @returns {string}
 */
export function formatExternalId(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return `pwa_strength_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

/**
 * Convertit le RPE de séance (1..10) en échelle de ressenti Intervals.icu (1..5).
 * @param {number} rpe
 * @returns {1|2|3|4|5}
 */
export function mapRpeToFeeling(rpe) {
  if (rpe <= 4) return 1;
  if (rpe <= 6) return 2;
  if (rpe <= 7) return 3;
  if (rpe <= 9) return 4;
  return 5;
}

/**
 * Assainit un libellé personnalisé (supprime balises HTML, caractères de contrôle et pipes `|`)
 * puis tronque à 80 caractères.
 * @param {unknown} label
 * @returns {string}
 */
export function sanitizeCustomLabel(label) {
  if (typeof label !== "string") return "";
  return label
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

/**
 * Calcule la contribution TUT et Strain Excentrique pour un exercice unitaire.
 * @param {{ id: string, sets: number, reps: number, load: number, completion: number, is_timed?: boolean }} ex
 * @param {number} k_ecc
 * @param {number} rir
 * @returns {{ cat: ReturnType<typeof getCatalogExercise>, tut: number, strain: number, weightedDone: number, weightedTotal: number }}
 */
function computeExerciseContribution(ex, k_ecc, rir) {
  const cat = getCatalogExercise(ex.id);
  const sets = Number(ex.sets) || 0;
  const reps = Number(ex.reps) || 0;
  const load = Number(ex.load) || 0;
  const completion = Number(ex.completion) || 0;
  const sEff = sets * completion;

  const tut = sEff * (reps + 0.3 * cat.parasitic_reps) * cat.unit_tut_sec;

  let strain = 0;
  if (cat.pole === "KBOX") {
    strain =
      sEff *
      reps *
      2.5 *
      Math.pow(load / 0.025, 1.15) *
      k_ecc *
      cat.cns_spinal_tax;
  } else if (cat.pole === "DUMBBELL") {
    const isTimed =
      typeof ex.is_timed === "boolean" ? ex.is_timed : cat.is_timed;
    const rNorm = isTimed ? reps / 4 : reps;
    const betaEcc = cat.beta_ecc ?? 1.0;
    strain =
      sEff * rNorm * (load / 10) * ((10 - rir) / 10) * betaEcc * 0.8;
  } else if (cat.pole === "BAND_CORE") {
    const tutBand = sEff * reps * cat.unit_tut_sec;
    strain = tutBand * 0.02 * load;
  }

  return {
    cat,
    tut,
    strain,
    weightedDone: completion * sets * cat.cns_spinal_tax,
    weightedTotal: sets * cat.cns_spinal_tax,
  };
}

/**
 * Calcule de manière 100 % déterministe toutes les métriques de la séance.
 * @param {object} params
 * @param {Array<{ id: string, sets: number, reps: number, load: number, completion: number }>} params.exercises
 * @param {number} params.k_ecc
 * @param {number} params.rir
 * @param {number} params.rpe
 * @param {number} params.elapsed_time_sec
 */
export function calculateSessionMetrics({
  exercises,
  k_ecc,
  rir,
  rpe,
  elapsed_time_sec,
}) {
  let rawTutSum = 0;
  let sumKboxStrain = 0;
  let sumDbStrain = 0;
  let sumBandStrain = 0;
  let weightedDoneSum = 0;
  let weightedTotalSum = 0;
  let maxKboxInertia = null;

  const poleBreakdown = {
    KBOX: { tut: 0, strain: 0 },
    DUMBBELL: { tut: 0, strain: 0 },
    BAND_CORE: { tut: 0, strain: 0 },
  };

  for (const ex of exercises) {
    const contrib = computeExerciseContribution(ex, k_ecc, rir);
    const { cat, tut, strain, weightedDone, weightedTotal } = contrib;

    rawTutSum += tut;
    weightedDoneSum += weightedDone;
    weightedTotalSum += weightedTotal;

    poleBreakdown[cat.pole].tut += tut;
    poleBreakdown[cat.pole].strain += strain;

    if (cat.pole === "KBOX") {
      sumKboxStrain += strain;
      if ((Number(ex.completion) || 0) > 0 && (Number(ex.sets) || 0) > 0) {
        const loadVal = Number(ex.load) || 0;
        if (maxKboxInertia === null || loadVal > maxKboxInertia) {
          maxKboxInertia = loadVal;
        }
      }
    } else if (cat.pole === "DUMBBELL") {
      sumDbStrain += strain;
    } else if (cat.pole === "BAND_CORE") {
      sumBandStrain += strain;
    }
  }

  const PpgEffectiveTut = Math.round(rawTutSum);
  const EccentricStrainIndex = Math.round(
    sumKboxStrain + sumDbStrain + sumBandStrain
  );
  const StrengthCompliancePct =
    weightedTotalSum <= 0
      ? 0
      : Math.round((100 * weightedDoneSum) / weightedTotalSum);

  const safeElapsed = Math.max(0, Number(elapsed_time_sec) || 0);
  const t_eff_min =
    (PpgEffectiveTut + 0.2 * Math.max(0, safeElapsed - PpgEffectiveTut)) /
    60;

  const icu_training_load = Math.round(
    t_eff_min * Math.pow(rpe / 10, 2) * 1.8 + 0.08 * EccentricStrainIndex
  );

  let strain_zone = "GREEN";
  if (EccentricStrainIndex > 180) {
    strain_zone = "RED";
  } else if (EccentricStrainIndex >= 80) {
    strain_zone = "ORANGE";
  }

  // Arrondi propre des sous-totaux par pôle pour lecture UI
  for (const pole of Object.keys(poleBreakdown)) {
    poleBreakdown[pole].tut = Math.round(poleBreakdown[pole].tut);
    poleBreakdown[pole].strain = Math.round(poleBreakdown[pole].strain);
  }

  return {
    PpgEffectiveTut,
    EccentricStrainIndex,
    StrengthCompliancePct,
    icu_training_load,
    t_eff_min,
    strain_zone,
    max_kbox_inertia: maxKboxInertia,
    pole_breakdown: poleBreakdown,
  };
}

/**
 * Construit le nom officiel de la séance pour Intervals.icu.
 * @param {object} params
 * @param {Array<{ id: string, load: number, completion: number, sets?: number }>} params.exercises
 * @param {string} params.theme
 * @returns {string}
 */
export function buildSessionName({ exercises, theme }) {
  let maxInertia = null;
  for (const ex of exercises) {
    const cat = getCatalogExercise(ex.id);
    if (cat.pole === "KBOX" && (Number(ex.completion) || 0) > 0) {
      const loadVal = Number(ex.load) || 0;
      if (maxInertia === null || loadVal > maxInertia) {
        maxInertia = loadVal;
      }
    }
  }

  if (maxInertia !== null) {
    return `PPG kBox [${maxInertia.toFixed(3)}] - ${theme}`;
  }
  return "PPG Core & Stabilité";
}

/**
 * Formate la charge d'un exercice avec son unité catalogue.
 * @param {number} load
 * @param {ReturnType<typeof getCatalogExercise>} cat
 * @returns {string}
 */
function formatLoadLabel(load, cat) {
  if (cat.pole === "KBOX") {
    return `${Number(load).toFixed(3)} ${cat.unit_label}`;
  }
  return `${load} ${cat.unit_label}`;
}

/**
 * Formate le statut d'exécution d'un exercice pour le tableau Markdown.
 * @param {number} completion
 * @returns {string}
 */
function formatCompletionStatus(completion) {
  if (completion >= 1) return "100%";
  if (completion >= 0.75) return "75%";
  if (completion >= 0.5) return "50%";
  return "0% (Skip)";
}

/**
 * Déduit la dominante biomécanique principale (KNEE_DOMINANT ou HIP_DOMINANT) de la séance.
 * @param {Array<{ id: string, block?: number }>} exercises
 * @returns {string}
 */
function inferDominantPattern(exercises) {
  const block2 = exercises.filter((ex) => ex.block === 2);
  const candidates = block2.length > 0 ? block2 : exercises;

  for (const ex of candidates) {
    const cat = getCatalogExercise(ex.id);
    if (cat.pattern === "KNEE_DOMINANT" || cat.pattern === "HIP_DOMINANT") {
      return cat.pattern;
    }
  }
  for (const ex of exercises) {
    const cat = getCatalogExercise(ex.id);
    if (cat.pattern === "KNEE_DOMINANT" || cat.pattern === "HIP_DOMINANT") {
      return cat.pattern;
    }
  }
  return "LUMBO_PELVIC";
}

/**
 * Construit le payload complet prêt pour `POST /api/v1/athlete/{id}/activities/manual`.
 * Inclut la description Markdown structurée et la ligne finale `[TELEMETRY_JSON]`.
 * @param {object} params
 * @param {Date} params.dateObj
 * @param {string} params.theme
 * @param {string} [params.rationale]
 * @param {string} [params.notes]
 * @param {string} params.gate
 * @param {string} params.readiness
 * @param {number} params.k_ecc
 * @param {number} params.rir
 * @param {number} params.rpe
 * @param {boolean} params.lumbar_flag
 * @param {number} params.elapsed_time_sec
 * @param {Array<{ id: string, block?: number, sets: number, reps: number, load: number, completion: number }>} params.exercises
 */
export function buildManualActivityPayload({
  dateObj,
  theme,
  rationale = "",
  notes = "",
  gate,
  readiness,
  k_ecc,
  rir,
  rpe,
  lumbar_flag,
  elapsed_time_sec,
  exercises,
}) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const metrics = calculateSessionMetrics({
    exercises,
    k_ecc,
    rir,
    rpe,
    elapsed_time_sec,
  });

  const external_id = formatExternalId(d);
  const start_date_local = formatLocalIsoDateTime(d);
  const name = buildSessionName({ exercises, theme });
  const dominant_pattern = inferDominantPattern(exercises);

  const lines = [
    `### WebStrength Telemetry — ${theme}`,
    `- **Gate**: ${gate} | **Readiness**: ${readiness} | **Dominante**: ${dominant_pattern} | **Lombaire**: ${lumbar_flag ? "DÉCHARGE" : "NORMAL"}`,
    `- **k_ecc**: ${k_ecc} | **RIR**: ${rir} | **RPE**: ${rpe}/10 | **Compliance**: ${metrics.StrengthCompliancePct}%`,
    `- **TUT Effectif**: ${metrics.PpgEffectiveTut} s | **Strain Excentrique**: ${metrics.EccentricStrainIndex} (${metrics.strain_zone}) | **Load**: ${metrics.icu_training_load}`,
  ];

  if (rationale && rationale.trim().length > 0) {
    lines.push("", `> ${rationale.trim()}`);
  }

  lines.push(
    "",
    "| Bloc | Exercice | Charge | Séries×Reps | Statut | TUT | Strain |",
    "| :--- | :--- | :--- | :--- | :--- | ---: | ---: |"
  );

  const compactExercises = exercises.map((ex, idx) => {
    const blockNum = ex.block ?? (idx < 2 ? 1 : idx < 4 ? 2 : 3);
    const contrib = computeExerciseContribution(ex, k_ecc, rir);
    const { cat, tut, strain } = contrib;
    const customLabel = sanitizeCustomLabel(ex.custom_label);
    const displayName = customLabel || cat.name;
    const isTimed =
      typeof ex.is_timed === "boolean" ? ex.is_timed : cat.is_timed;
    const unitSuffix = isTimed ? "s" : "";
    const loadStr = formatLoadLabel(ex.load, cat);
    const volStr = `${ex.sets}×${ex.reps}${unitSuffix}`;
    const statusStr = formatCompletionStatus(Number(ex.completion) || 0);

    lines.push(
      `| B${blockNum} | ${displayName} | ${loadStr} | ${volStr} | ${statusStr} | ${Math.round(tut)}s | ${Math.round(strain)} |`
    );

    const compact = {
      id: ex.id,
      block: blockNum,
      sets: Number(ex.sets),
      reps: Number(ex.reps),
      load: Number(ex.load),
      s: Number(ex.sets),
      r: Number(ex.reps),
      l: Number(ex.load),
      c: Number(ex.completion),
    };
    if (customLabel) {
      compact.custom_label = customLabel;
    }
    if (isTimed !== cat.is_timed) {
      compact.is_timed = isTimed;
    }
    return compact;
  });

  if (notes && notes.trim().length > 0) {
    lines.push("", `**Notes athlète** : ${notes.trim()}`);
  }

  const telemetryPayload = {
    schema_v: 1,
    gate,
    readiness,
    k_ecc,
    rir,
    lumbar_flag: Boolean(lumbar_flag),
    dominant_pattern,
    strain: metrics.EccentricStrainIndex,
    tut: metrics.PpgEffectiveTut,
    compliance: metrics.StrengthCompliancePct,
    ex: compactExercises,
  };

  lines.push("", `[TELEMETRY_JSON] ${JSON.stringify(telemetryPayload)}`);

  return {
    external_id,
    start_date_local,
    type: "WeightTraining",
    name,
    moving_time: metrics.PpgEffectiveTut,
    elapsed_time: Math.round(elapsed_time_sec),
    icu_training_load: metrics.icu_training_load,
    session_rpe: rpe,
    feeling: mapRpeToFeeling(rpe),
    EccentricStrainIndex: metrics.EccentricStrainIndex,
    PpgEffectiveTut: metrics.PpgEffectiveTut,
    StrengthCompliancePct: metrics.StrengthCompliancePct,
    description: lines.join("\n"),
  };
}

/**
 * Extrait et parse le JSON de télémétrie situé après `[TELEMETRY_JSON]` à la dernière ligne.
 * Retourne `null` si absent ou invalide.
 * @param {string} description
 * @returns {object | null}
 */
export function parseTelemetryJsonFromDescription(description) {
  if (typeof description !== "string" || description.trim().length === 0) {
    return null;
  }

  const lines = description.trimEnd().split(/\r?\n/);
  const lastLine = lines[lines.length - 1]?.trim() ?? "";
  const prefix = "[TELEMETRY_JSON]";

  if (!lastLine.startsWith(prefix)) {
    return null;
  }

  const jsonPart = lastLine.slice(prefix.length).trim();
  if (!jsonPart) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonPart);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
