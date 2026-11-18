/**
 * Table de vérité biomécanique immuable pour WebStrength.
 * Contient les 17 exercices officiels répartis sur les 3 pôles (KBOX, DUMBBELL, BAND_CORE).
 * Compatible ES2024+ natif zéro-build (Navigateur & Node.js ESM).
 */

/**
 * Gèle récursivement un objet ou un tableau pour garantir une immuabilité totale.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(obj);
}

/**
 * Définition brute du catalogue des 17 exercices biomécaniques.
 * Chaque entrée inclut son identifiant unique, son pôle matériel et ses constantes physiologiques.
 */
const RAW_CATALOG = [
  // --- Pôle A : Volant d'inertie kBox (KBOX) ---
  {
    id: "KBOX_SQUAT_HARNESS",
    pole: "KBOX",
    name: "Squat Bilatéral Harnais Épaules",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 1.8,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_SQUAT_BELT",
    pole: "KBOX",
    name: "Belt Squat Ceinture Pelvienne (Décharge L4-L5 100%)",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 0.8,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_SPLIT_SQUAT",
    pole: "KBOX",
    name: "Squat Bulgare / Fente Unilatérale",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 3.0,
    cns_spinal_tax: 1.3,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_RDL",
    pole: "KBOX",
    name: "Soulevé de Terre Roumain Barre",
    pattern: "HIP_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 4.0,
    cns_spinal_tax: 2.0,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_HIP_THRUST",
    pole: "KBOX",
    name: "Hip Thrust / Pull-Through Ceinture",
    pattern: "HIP_DOMINANT",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 2.5,
    cns_spinal_tax: 0.9,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_CALF_ECC",
    pole: "KBOX",
    name: "Extension Mollets Excentrique (Raideur Achille)",
    pattern: "ANKLE_STIFFNESS",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 0.5,
    is_timed: false,
    unit_label: "kg·m²",
  },
  {
    id: "KBOX_HIGH_PULL",
    pole: "KBOX",
    name: "Tirage Haut / Rowing Poignées",
    pattern: "UPPER_PULL",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 2.5,
    cns_spinal_tax: 1.1,
    is_timed: false,
    unit_label: "kg·m²",
  },

  // --- Pôle B : Haltères & Poids de corps chargé (DUMBBELL) ---
  {
    id: "DB_SL_RDL",
    pole: "DUMBBELL",
    name: "RDL Unilatéral Tempo 3-1-1",
    pattern: "HIP_DOMINANT",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 5.0,
    beta_ecc: 1.4,
    cns_spinal_tax: 1.1,
    is_timed: false,
    unit_label: "kg",
  },
  {
    id: "DB_STEP_DOWN",
    pole: "DUMBBELL",
    name: "Step-Down Excentrique Lent (Descente 4s)",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 5.0,
    beta_ecc: 1.4,
    cns_spinal_tax: 1.0,
    is_timed: false,
    unit_label: "kg",
  },
  {
    id: "DB_COPENHAGEN",
    pole: "DUMBBELL",
    name: "Adducteurs Copenhagen (Isométrique secondes)",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [0, 4, 6],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 0.8,
    is_timed: true,
    unit_label: "kg",
  },
  {
    id: "DB_RENEGADE_ROW",
    pole: "DUMBBELL",
    name: "Planche Dynamique + Tirage Unilatéral",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 4.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 1.0,
    is_timed: false,
    unit_label: "kg",
  },
  {
    id: "DB_FARMER_UNI",
    pole: "DUMBBELL",
    name: "Marche du Fermier / Valise Unilatérale (Carré des lombes)",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [10],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 0.9,
    is_timed: true,
    unit_label: "kg",
  },

  // --- Pôle C : Élastiques & Gainage neuromusculaire (BAND_CORE) ---
  {
    id: "BAND_MONSTER_WALK",
    pole: "BAND_CORE",
    name: "Marche Latérale / Monster Walk (Moyen Fessier)",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [2, 3],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.4,
    is_timed: true,
    unit_label: "niv.",
  },
  {
    id: "BAND_PALLOF_PRESS",
    pole: "BAND_CORE",
    name: "Pallof Press Anti-Rotation Iso-Dynamique",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
  },
  {
    id: "BAND_PSOAS_MARCH",
    pole: "BAND_CORE",
    name: "Flexion de Hanche Résistée Psoas",
    pattern: "HIP_DOMINANT",
    allowed_loads: [2, 3],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
  },
  {
    id: "BAND_FACE_PULL",
    pole: "BAND_CORE",
    name: "Face Pull + Rotation Externe Scapulaire",
    pattern: "UPPER_PULL",
    allowed_loads: [1, 2],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.4,
    is_timed: true,
    unit_label: "niv.",
  },
  {
    id: "CORE_MCGILL_BIG3",
    pole: "BAND_CORE",
    name: "Trilogie de McGill (Curl-up, Side Bridge, Bird-Dog)",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [1],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
  },
];

/** Liste ordonnée et immuable des 17 exercices. */
export const CATALOG = deepFreeze(RAW_CATALOG);

/** Dictionnaire immuable indexé par ID d'exercice. */
export const CATALOG_BY_ID = deepFreeze(
  Object.fromEntries(CATALOG.map((ex) => [ex.id, ex]))
);

/** Liste immuable des identifiants valides du catalogue. */
export const EXERCISE_IDS = deepFreeze(CATALOG.map((ex) => ex.id));

/**
 * Récupère un exercice du catalogue par son identifiant.
 * Lève une erreur explicite si l'identifiant est inconnu.
 * @param {string} id
 * @returns {Readonly<typeof RAW_CATALOG[number]>}
 */
export function getCatalogExercise(id) {
  if (typeof id !== "string" || !Object.hasOwn(CATALOG_BY_ID, id)) {
    throw new Error(
      `Exercice inconnu dans le catalogue WebStrength : "${String(id)}". IDs valides : ${EXERCISE_IDS.join(", ")}`
    );
  }
  return CATALOG_BY_ID[id];
}
