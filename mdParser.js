/**
 * Parseur Markdown hors-ligne et normalisateur de séances libres pour WebStrength.
 * Transforme du texte brut, des listes ou des tableaux Markdown en plan structuré
 * compatible avec le moteur biomécanique (`engine.js`) et le Mode Libre.
 */

import {
  CUSTOM_TEMPLATES,
  getAllCatalogExercises,
  getCatalogExercise,
} from "./catalog.js";
import { sanitizeCustomLabel } from "./engine.js";

/**
 * Normalise une chaîne pour la recherche lexicale (minuscules, sans accents, alphanumérique).
 * @param {unknown} str
 * @returns {string}
 */
function normalizeLexical(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Aligne une charge numérique sur la valeur la plus proche de `cat.allowed_loads`.
 * En cas d'égalité de distance, privilégie la charge inférieure par sécurité.
 * @param {number} load
 * @param {ReturnType<typeof getCatalogExercise>} cat
 * @returns {number}
 */
export function snapLoadToTemplate(load, cat) {
  const allowed = Array.isArray(cat?.allowed_loads) ? cat.allowed_loads : [0];
  const num = Number(load);
  if (!Number.isFinite(num)) {
    return allowed[0];
  }

  let best = allowed[0];
  let bestDiff = Math.abs(num - best);

  for (let i = 1; i < allowed.length; i++) {
    const candidate = allowed[i];
    const diff = Math.abs(num - candidate);
    if (
      diff < bestDiff - 1e-9 ||
      (Math.abs(diff - bestDiff) <= 1e-9 && candidate < best)
    ) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
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
 * Déduit le bloc par défaut (1: BAND_CORE, 2: KBOX, 3: DUMBBELL) selon le pôle matériel.
 * @param {string} pole
 * @returns {1|2|3}
 */
function inferDefaultBlockForPole(pole) {
  if (pole === "BAND_CORE") return 1;
  if (pole === "KBOX") return 2;
  return 3;
}

/**
 * Normalise une liste d'exercices libres en un plan complet compatible UI / Intervals.icu.
 * @param {object} params
 * @param {string} [params.title]
 * @param {Array<{ id: string, block?: number, sets?: number, reps?: number, load?: number, custom_label?: string, is_timed?: boolean }>} params.exercises
 * @param {string} [params.sourceLabel]
 * @param {string} [params.rationale]
 * @param {string} [params.gate]
 * @param {string} [params.readiness]
 * @param {boolean} [params.preserveOrder]
 */
export function buildFreeSessionPlan({
  title,
  exercises,
  sourceLabel = "",
  rationale = "",
  gate,
  readiness,
  preserveOrder = false,
} = {}) {
  if (!Array.isArray(exercises) || exercises.length === 0) {
    throw new Error("Aucun exercice valide fourni pour construire la séance libre.");
  }

  const normalizedExercises = exercises.map((rawEx) => {
    const cat = getCatalogExercise(rawEx.id);
    const defaultSets = cat.default_sets ?? 3;
    const defaultReps = cat.default_reps ?? (cat.is_timed ? 45 : 10);

    const sets = clampInt(rawEx.sets, 1, 10, defaultSets);
    const reps = clampInt(rawEx.reps, 1, 300, defaultReps);
    const load = snapLoadToTemplate(
      rawEx.load !== undefined && rawEx.load !== null ? rawEx.load : cat.allowed_loads[0],
      cat
    );

    const rawBlock = Number(rawEx.block);
    const block =
      rawBlock === 1 || rawBlock === 2 || rawBlock === 3
        ? rawBlock
        : inferDefaultBlockForPole(cat.pole);

    const item = {
      id: cat.id,
      block,
      sets,
      reps,
      load,
    };

    const customLabel = sanitizeCustomLabel(rawEx.custom_label);
    if (customLabel) {
      item.custom_label = customLabel;
    }

    if (typeof rawEx.is_timed === "boolean") {
      item.is_timed = rawEx.is_timed;
    }

    return item;
  });

  const cleanTitle = sanitizeCustomLabel(title);
  const cleanSource = sanitizeCustomLabel(sourceLabel);
  const theme =
    cleanTitle ||
    (cleanSource ? `Séance Libre — ${cleanSource}` : "Séance Libre Importée");

  const rawRationale =
    typeof rationale === "string"
      ? rationale
          .replace(/<[^>]*>/g, "")
          .replace(/[\u0000-\u001F\u007F]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 280)
      : "";

  const contextTag =
    gate || readiness
      ? ` [Gate: ${gate || "?"} / Readiness: ${readiness || "?"}]`
      : "";
  const finalRationale =
    rawRationale ||
    `Mode libre (${normalizedExercises.length} exercices${cleanSource ? `, ${cleanSource}` : ""})${contextTag}.`;

  const rawDurationSec = Math.max(1200, normalizedExercises.length * 330);
  const target_duration_sec = Math.max(900, Math.round(rawDurationSec / 60) * 60);

  return {
    theme,
    rationale: finalRationale,
    recommended_k_ecc: 1.3,
    recommended_rir: 2,
    recommended_rpe: 7,
    target_duration_sec,
    applied_rules: ["MODE_LIBRE"],
    is_free_mode: true,
    preserve_order: Boolean(preserveOrder),
    exercises: normalizedExercises,
  };
}

/**
 * Table de synonymes normalisés vers les IDs du catalogue officiel.
 * Ordonnée du plus spécifique au plus générique.
 */
const CATALOG_SYNONYMS = [
  // Spécifiques v1.9.0 placés avant les synonymes génériques correspondants
  { id: "KBOX_SINGLE_LEG_RDL", phrases: ["kbox single leg rdl", "rdl unilat kbox", "souleve de terre unipodal kbox"] },
  { id: "KBOX_CALF_PRESS_BENT_KNEE", phrases: ["calf press", "presse mollet genou flechi", "soleaire genou flechi"] },
  { id: "KBOX_HIGH_PULL_VELOCITY", phrases: ["high pull velocite", "kbox high pull velocite", "tirage haut velocite"] },
  { id: "KBOX_SQUAT_VELOCITY_LIGHT", phrases: ["squat velocite", "kbox squat velocite"] },
  { id: "KB_HIP_THRUST_SINGLE", phrases: ["hip thrust unilat", "hip thrust unilateral", "hip thrust une jambe", "kb hip thrust"] },
  { id: "BARBELL_ROMANIAN_DEADLIFT_TEMPO", phrases: ["souleve de terre roumain barre tempo", "rdl barre tempo", "romanian deadlift tempo"] },
  { id: "BAND_PALLOF_PRESS_SPLIT", phrases: ["pallof split", "pallof fente", "pallof press split"] },
  { id: "KB_SUITCASE_CARRY", phrases: ["suitcase carry", "kb suitcase carry", "porte valise kb"] },
  { id: "KB_RACK_MARCH", phrases: ["rack march", "kb rack march", "marche kettlebell rack"] },

  // Catalogue de base (17)
  { id: "KBOX_SQUAT_BELT", phrases: ["belt squat", "ceinture pelvienne", "squat ceinture"] },
  { id: "KBOX_SQUAT_HARNESS", phrases: ["squat harnais", "harnais epaules", "squat bilateral harnais"] },
  { id: "KBOX_SPLIT_SQUAT", phrases: ["bulgare", "split squat", "fente unilaterale"] },
  { id: "DB_SL_RDL", phrases: ["rdl unilat", "sl rdl", "single leg rdl", "rdl unipodal", "tempo 3 1 1"] },
  { id: "KBOX_RDL", phrases: ["souleve de terre roumain", "roumain barre", "kbox rdl", "rdl kbox"] },
  { id: "KBOX_HIP_THRUST", phrases: ["hip thrust", "pull through"] },
  { id: "KBOX_CALF_ECC", phrases: ["mollet", "calf", "achille", "soleaire"] },
  { id: "KBOX_HIGH_PULL", phrases: ["tirage haut", "high pull", "rowing poignees"] },
  { id: "DB_STEP_DOWN", phrases: ["step down", "descente 4s"] },
  { id: "DB_COPENHAGEN", phrases: ["copenhagen", "adducteurs"] },
  { id: "DB_FARMER_UNI", phrases: ["farmer", "fermier", "valise", "carre des lombes"] },
  { id: "DB_RENEGADE_ROW", phrases: ["renegade", "planche dynamique"] },
  { id: "BAND_MONSTER_WALK", phrases: ["monster walk", "marche laterale", "moyen fessier"] },
  { id: "BAND_PALLOF_PRESS", phrases: ["pallof", "anti rotation"] },
  { id: "BAND_PSOAS_MARCH", phrases: ["psoas", "flexion de hanche resistee"] },
  { id: "BAND_FACE_PULL", phrases: ["face pull", "rotation externe scapulaire"] },
  { id: "CORE_MCGILL_BIG3", phrases: ["mcgill", "big 3", "big3", "curl up", "bird dog"] },

  // Reste du catalogue étendu v1.9.0
  { id: "PULL_UP_PRONATION_TEMPO_ECC", phrases: ["traction tempo", "traction excentrique"] },
  { id: "PULL_UP_PRONATION_SCAP_ISOMETRIC", phrases: ["traction scapulaire", "scapulaire isometrique"] },
  { id: "PULL_UP_PRONATION_STRICT_BW", phrases: ["traction stricte"] },
  { id: "BARBELL_BENT_ROW_OVERHAND", phrases: ["bent row", "rowing barre buste penche"] },
  { id: "BARBELL_OVERHEAD_PRESS_STRICT", phrases: ["overhead press", "developpe militaire strict"] },
  { id: "DB_ONE_ARM_ROW_BRACE", phrases: ["one arm row", "rowing un bras", "rowing unilateral haltere"] },
  { id: "KB_STRICT_PRESS_BOTTOM_UP", phrases: ["bottom up press", "press bottom up", "kettlebell bottom up"] },
  { id: "AB_WHEEL_OFFSET_ANGLE", phrases: ["ab wheel offset", "roue abdo oblique", "roue abdominale oblique"] },
  { id: "AB_WHEEL_ROLLOUT_KNEES", phrases: ["ab wheel", "roue abdo", "roue abdominale"] },
  { id: "BAND_CHOP_DIAGONAL", phrases: ["diagonal chop", "band chop", "bucheron diagonal"] },
  { id: "DB_DEADBUG_HOLD_LOAD", phrases: ["deadbug charge", "deadbug isometrique", "dead bug hold"] },
  { id: "KB_WINDMILL_LIGHT", phrases: ["windmill", "moulin kettlebell"] },
  { id: "BAND_CLAMSHELL_RESISTED", phrases: ["clamshell", "coquillage resiste"] },
  { id: "BAND_TIBIALIS_DORSIFLEXION", phrases: ["tibialis", "tibial anterieur", "dorsiflexion elastique"] },
  { id: "DB_STEP_UP_HIGH_BOX", phrases: ["step up", "montee sur banc"] },
  { id: "KB_GOBLET_COSSACK_SQUAT", phrases: ["cossack", "squat cosaque"] },
  { id: "BAND_HIGH_KNEE_DRIVE_FAST", phrases: ["high knee", "montee de genou explosive"] },
  { id: "BAND_ACCELERATION_STEP_OUT", phrases: ["acceleration step", "pas d acceleration"] },
  { id: "BARBELL_HANG_HIGH_PULL_LIGHT", phrases: ["hang high pull", "tirage suspension leger"] },
  { id: "KB_SWING_SNAP_VELOCITY", phrases: ["kb swing", "kettlebell swing", "swing snap"] },
  { id: "PLYO_ANKLE_POGO_SINGLE", phrases: ["pogo unipodal", "pogo single", "pogo une jambe"] },
  { id: "PLYO_ANKLE_POGO_DOUBLE", phrases: ["pogo", "rebonds pogo"] },
  { id: "PLYO_BOX_JUMP_STEP_DOWN", phrases: ["box jump"] },
  { id: "PLYO_LATERAL_SKATER_BOUND", phrases: ["skater", "bonds lateraux patineur"] },
  { id: "PLYO_SPLIT_SCISSOR_SWITCH", phrases: ["split scissor", "fentes sautees", "scissor switch"] },
  { id: "PLYO_PUSH_UP_EXPLOSIVE_INCLINE", phrases: ["pompes explosives", "push up explosive"] },

  // Sprints v1.12.0
  {
    id: "SPRINT_RESISTED_BAND_START",
    phrases: [
      "depart sprint resiste",
      "sprint resiste",
      "resisted sprint",
      "sprint elastique",
      "depart resiste elastique",
    ],
  },
  {
    id: "SPRINT_UPHILL_POWER_DRIVE",
    phrases: ["sprint en cote", "sprint cote", "hill sprint", "uphill sprint"],
  },
  {
    id: "SPRINT_FLYING_CADENCE_BURST",
    phrases: ["sprint lance", "flying sprint", "sprint velocite", "sprint cadence"],
  },
  {
    id: "SPRINT_DECEL_STICK_LANDING",
    phrases: [
      "freinage sprint",
      "sprint freinage",
      "deceleration sprint",
      "sprint deceleration",
      "stick landing",
      "arret controle stick",
    ],
  },
  {
    id: "SPRINT_ACCEL_DRIVE_15M",
    phrases: [
      "acceleration courte",
      "acceleration 15",
      "accel drive",
      "poussee 15 m",
      "poussee 15m",
      "sprint 15 m",
      "sprint 15m",
      "sprint acceleration",
    ],
  },
];

/**
 * Construit dynamiquement la table d'indexation des identifiants connus
 * (catalogue officiel + exercices utilisateur + modèles libres).
 * @param {Array<ReturnType<typeof getCatalogExercise>>} allExercises
 * @returns {Map<string, string>}
 */
function buildIdsByUpperMap(allExercises) {
  return new Map([
    ...allExercises.map((ex) => [ex.id.toUpperCase(), ex.id]),
    ...Object.keys(CUSTOM_TEMPLATES).map((id) => [id.toUpperCase(), id]),
  ]);
}

/**
 * Tente d'associer un libellé brut à un exercice du catalogue (officiel ou utilisateur).
 * Retourne l'ID catalogue ou `null` si aucune correspondance fiable.
 * @param {string} rawText
 * @returns {string | null}
 */
function matchCatalogExerciseId(rawText) {
  const allExercises = getAllCatalogExercises();
  const idsByUpper = buildIdsByUpperMap(allExercises);

  const upperTrimmed = rawText.trim().toUpperCase();
  if (idsByUpper.has(upperTrimmed)) {
    return idsByUpper.get(upperTrimmed);
  }

  // Recherche d'un ID explicite dans les tokens (ex: `KBOX_SQUAT_BELT` ou `USER_PLAN_GAINAGE`)
  const idTokens = upperTrimmed.match(/\b(?:KBOX|DB|BAND|CORE|CUSTOM|USER|PULL_UP|BARBELL|KB|AB_WHEEL|PLYO|SPRINT)_[A-Z0-9_]+\b/g);
  if (idTokens) {
    for (const token of idTokens) {
      if (idsByUpper.has(token)) {
        return idsByUpper.get(token);
      }
    }
  }

  const norm = normalizeLexical(rawText);
  if (!norm) return null;

  // Priorité à une correspondance exacte normalisée sur les exercices utilisateur promus ou catégorisés
  for (const ex of allExercises) {
    if ((ex.is_user_catalog || ex.category) && normalizeLexical(ex.name) === norm) {
      return ex.id;
    }
  }

  // Règle explicite : rdl + kbox -> KBOX_RDL
  if (/\brdl\b/.test(norm) && /\bkbox\b/.test(norm)) {
    return "KBOX_RDL";
  }

  // Correspondance par synonymes courants
  for (const entry of CATALOG_SYNONYMS) {
    for (const phrase of entry.phrases) {
      if (norm.includes(phrase)) {
        return entry.id;
      }
    }
  }

  // Score par mots-clés exacts sur le nom officiel (catalogue officiel + utilisateur)
  const stopWords = new Set(["avec", "pour", "dans", "sans", "sur", "libre", "tempo", "haut", "bas"]);
  const inputTokens = new Set(
    norm.split(" ").filter((t) => t.length >= 4 && !stopWords.has(t))
  );
  if (inputTokens.size < 2) {
    return null;
  }

  let bestId = null;
  let bestScore = 0;

  for (const ex of allExercises) {
    const nameTokens = normalizeLexical(ex.name)
      .split(" ")
      .filter((t) => t.length >= 4 && !stopWords.has(t));
    let matches = 0;
    for (const tok of nameTokens) {
      if (inputTokens.has(tok)) {
        matches++;
      }
    }
    if (matches >= 2 && matches > bestScore) {
      bestScore = matches;
      bestId = ex.id;
    }
  }

  return bestId;
}

/**
 * Sélectionne le modèle `CUSTOM_*` adapté si l'exercice n'appartient pas au catalogue.
 * @param {string} rawLine
 * @param {number | null} parsedLoad
 * @returns {"CUSTOM_KBOX" | "CUSTOM_DUMBBELL" | "CUSTOM_BAND_CORE"}
 */
function inferCustomTemplateId(rawLine, parsedLoad) {
  const norm = normalizeLexical(rawLine);
  const hasKboxInertia =
    parsedLoad !== null &&
    (Math.abs(parsedLoad - 0.025) < 1e-6 ||
      Math.abs(parsedLoad - 0.05) < 1e-6 ||
      Math.abs(parsedLoad - 0.075) < 1e-6);

  if (
    hasKboxInertia ||
    /\b(kbox|inertie|kgm2|flywheel)\b/.test(norm) ||
    /kg[·.]m²/i.test(rawLine)
  ) {
    return "CUSTOM_KBOX";
  }

  if (
    /\b(kg|kilo|kilos|halt|haltere|halteres|db|curl|barre|kettlebell|kb|gobelet)\b/.test(norm) ||
    (parsedLoad !== null && parsedLoad > 4)
  ) {
    return "CUSTOM_DUMBBELL";
  }

  return "CUSTOM_BAND_CORE";
}

/**
 * Vérifie si une ligne de tableau Markdown est une ligne d'en-tête ou de séparateur.
 * @param {string} line
 * @param {string[]} cells
 * @returns {boolean}
 */
function isTableHeaderOrSeparator(line, cells) {
  if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line)) {
    return true;
  }
  const joined = normalizeLexical(cells.join(" "));
  if (
    /\b(exercice|id ou nom)\b/.test(joined) &&
    /\b(charge|series|reps|bloc|statut)\b/.test(joined)
  ) {
    return true;
  }
  return false;
}

/**
 * Extrait le volume (`sets`, `reps`, `hasTimeUnit`) et le texte restant sans ce motif.
 * @param {string} text
 * @returns {{ sets: number | null, reps: number | null, hasTimeUnit: boolean, foundVolume: boolean, rest: string }}
 */
function extractVolume(text) {
  const volRegex = /(\d+)\s*[x×*]\s*(\d+)\s*(s|sec|secondes?)?\b/i;
  const match = text.match(volRegex);
  if (!match) {
    return {
      sets: null,
      reps: null,
      hasTimeUnit: false,
      foundVolume: false,
      rest: text,
    };
  }
  const rest = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
    .replace(/\s+/g, " ")
    .trim();
  return {
    sets: Number(match[1]),
    reps: Number(match[2]),
    hasTimeUnit: Boolean(match[3]),
    foundVolume: true,
    rest,
  };
}

/**
 * Extrait une charge / inertie depuis un texte libre et retourne le texte nettoyé.
 * @param {string} text
 * @param {boolean} allowBareNumber
 * @returns {{ load: number | null, rest: string }}
 */
function extractLoad(text, allowBareNumber = false) {
  // 1. Inertie kBox explicite (0.010 / 0.025 / 0.050 / 0.075)
  const inertiaMatch = text.match(
    /(?:^|\s)(0[.,](?:0?10?|0?25|0?50?|0?75))\s*(?:kg[·.]?m²|kgm2|inertie)?(?=\s|$)/i
  );
  if (inertiaMatch) {
    const val = Number(inertiaMatch[1].replace(",", "."));
    const rest = text.replace(inertiaMatch[0], " ").replace(/\s+/g, " ").trim();
    return { load: val, rest };
  }

  // 2. Charge suivie d'une unité (kg, niv)
  const unitMatch = text.match(
    /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|niv\.?|niveau)(?=\s|$)/i
  );
  if (unitMatch) {
    const val = Number(unitMatch[1].replace(",", "."));
    const rest = text.replace(unitMatch[0], " ").replace(/\s+/g, " ").trim();
    return { load: val, rest };
  }

  // 3. Nombre isolé (en colonne de tableau ou fin de ligne après retrait du volume)
  if (allowBareNumber) {
    const bareMatch = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (bareMatch) {
      return { load: Number(bareMatch[1].replace(",", ".")), rest: "" };
    }
    const trailingMatch = text.match(/^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*$/);
    if (trailingMatch) {
      const prefix = trailingMatch[1].trim();
      if (!/\b(?:big|phase|bloc|step|level|etape)$/i.test(prefix)) {
        return {
          load: Number(trailingMatch[2].replace(",", ".")),
          rest: prefix,
        };
      }
    }
  }

  return { load: null, rest: text };
}

/**
 * Nettoie les marqueurs de mise en forme Markdown d'un nom d'exercice.
 * @param {string} raw
 * @returns {string}
 */
function cleanExerciseLabel(raw) {
  return raw
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse une ligne avec séparateurs `|` (tableau Markdown ou format tuyau).
 * @param {string} line
 * @returns {object | null}
 */
function parsePipeLine(line) {
  let rawCells = line.split("|").map((c) => c.trim());
  if (line.trim().startsWith("|") && rawCells[0] === "") {
    rawCells.shift();
  }
  if (line.trim().endsWith("|") && rawCells[rawCells.length - 1] === "") {
    rawCells.pop();
  }
  const cells = rawCells.filter((c) => c.length > 0);
  if (cells.length === 0 || isTableHeaderOrSeparator(line, cells)) {
    return null;
  }

  let explicitBlock;
  if (/^B[123]$/i.test(cells[0])) {
    explicitBlock = Number(cells[0][1]);
    cells.shift();
  }
  if (cells.length === 0) return null;

  let nameCell = "";
  let sets = null;
  let reps = null;
  let hasTimeUnit = false;
  let foundVolume = false;
  let parsedLoad = null;

  for (const cell of cells) {
    if (!foundVolume) {
      const vol = extractVolume(cell);
      if (vol.foundVolume) {
        sets = vol.sets;
        reps = vol.reps;
        hasTimeUnit = vol.hasTimeUnit;
        foundVolume = true;
        if (vol.rest && !nameCell) {
          const maybeLoad = extractLoad(vol.rest, true);
          if (maybeLoad.load !== null && parsedLoad === null) {
            parsedLoad = maybeLoad.load;
          }
          if (maybeLoad.rest && /[a-zA-ZÀ-ÿ]/.test(maybeLoad.rest)) {
            nameCell = maybeLoad.rest;
          }
        }
        continue;
      }
    }

    if (parsedLoad === null) {
      const loadInfo = extractLoad(cell, true);
      if (loadInfo.load !== null && !loadInfo.rest) {
        parsedLoad = loadInfo.load;
        continue;
      }
    }

    if (!nameCell && !/^\d+%(\s*\(Skip\))?$/i.test(cell)) {
      nameCell = cell;
    }
  }

  if (!nameCell) return null;

  const catalogId = matchCatalogExerciseId(nameCell);
  const cleanLabel = cleanExerciseLabel(nameCell);

  if (catalogId) {
    const cat = getCatalogExercise(catalogId);
    const finalLoad =
      parsedLoad !== null ? parsedLoad : cat.allowed_loads[0];
    return {
      id: cat.id,
      block: explicitBlock,
      sets: sets ?? cat.default_sets ?? 3,
      reps: reps ?? cat.default_reps ?? (cat.is_timed ? 45 : 10),
      load: finalLoad,
    };
  }

  const customId = inferCustomTemplateId(`${nameCell} ${line}`, parsedLoad);
  const customCat = getCatalogExercise(customId);
  return {
    id: customId,
    block: explicitBlock,
    sets: sets ?? customCat.default_sets,
    reps: reps ?? customCat.default_reps,
    load: parsedLoad !== null ? parsedLoad : customCat.allowed_loads[0],
    custom_label: sanitizeCustomLabel(cleanLabel),
    is_timed: foundVolume ? hasTimeUnit : customCat.is_timed,
  };
}

/**
 * Parse une ligne de liste ou de texte libre (sans pipes).
 * @param {string} line
 * @returns {object | null}
 */
function parseTextLine(line) {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("[TELEMETRY_JSON]") ||
    /^[-*_]{3,}$/.test(trimmed)
  ) {
    return null;
  }

  // Ignore les lignes de métadonnées WebStrength
  if (/^[-*]\s*\*\*(?:Gate|Readiness|k_ecc|TUT Effectif|Notes)\b/i.test(trimmed)) {
    return null;
  }

  const isBullet = /^\s*(?:[-*+•]|\d+[.)])\s+/.test(trimmed);
  const withoutBullet = trimmed.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").trim();
  if (!withoutBullet) return null;

  const vol = extractVolume(withoutBullet);
  const loadInfo = extractLoad(vol.rest, true);
  const catalogMatchFirst = matchCatalogExerciseId(withoutBullet);

  // Évite de parser une phrase de prose quelconque sans puce, sans volume et sans ID connu
  if (!isBullet && !vol.foundVolume && !catalogMatchFirst) {
    return null;
  }

  const labelCandidate = cleanExerciseLabel(loadInfo.rest);
  if (!labelCandidate && !catalogMatchFirst) {
    return null;
  }

  const catalogId =
    matchCatalogExerciseId(labelCandidate) || catalogMatchFirst;

  if (catalogId) {
    const cat = getCatalogExercise(catalogId);
    return {
      id: cat.id,
      sets: vol.sets ?? cat.default_sets ?? 3,
      reps: vol.reps ?? cat.default_reps ?? (cat.is_timed ? 45 : 10),
      load:
        loadInfo.load !== null ? loadInfo.load : cat.allowed_loads[0],
    };
  }

  // Repli sur modèle générique CUSTOM_*
  const customId = inferCustomTemplateId(withoutBullet, loadInfo.load);
  const customCat = getCatalogExercise(customId);
  const cleanLabel = sanitizeCustomLabel(labelCandidate || withoutBullet);
  if (!cleanLabel) return null;

  return {
    id: customId,
    sets: vol.sets ?? customCat.default_sets,
    reps: vol.reps ?? customCat.default_reps,
    load:
      loadInfo.load !== null ? loadInfo.load : customCat.allowed_loads[0],
    custom_label: cleanLabel,
    is_timed: vol.foundVolume ? vol.hasTimeUnit : customCat.is_timed,
  };
}

/**
 * Parse un texte Markdown / brut hors-ligne pour en extraire un plan complet en Mode Libre.
 * Lève une erreur explicite si aucun exercice n'est reconnu.
 * @param {string} rawMarkdown
 */
export function parseMarkdownOffline(rawMarkdown) {
  if (typeof rawMarkdown !== "string" || rawMarkdown.trim().length === 0) {
    throw new Error("Aucun exercice reconnu dans le texte Markdown.");
  }

  const lines = rawMarkdown.split(/\r?\n/);
  let title = "";
  const parsedExercises = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!title && /^#{1,3}\s+/.test(trimmed)) {
      title = cleanExerciseLabel(trimmed.replace(/^#{1,3}\s+/, ""));
      continue;
    }

    const parsed = trimmed.includes("|")
      ? parsePipeLine(trimmed)
      : parseTextLine(trimmed);

    if (parsed) {
      parsedExercises.push(parsed);
    }
  }

  if (parsedExercises.length === 0) {
    throw new Error("Aucun exercice reconnu dans le texte Markdown.");
  }

  return buildFreeSessionPlan({
    title,
    exercises: parsedExercises,
    sourceLabel: "Parseur Offline",
  });
}
