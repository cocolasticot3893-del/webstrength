/**
 * Table de vérité biomécanique immuable pour WebStrength.
 * Contient les 17 exercices officiels répartis sur les 3 pôles (KBOX, DUMBBELL, BAND_CORE).
 * Compatible ES2024+ natif zéro-build (Navigateur & Node.js ESM).
 */

import { sanitizeSvgMarkup } from "./svgHelper.js";
import {
  EXTENDED_CATEGORIES,
  EXTENDED_CATALOG_EXERCISES,
  EXTENDED_CATALOG_BY_ID,
  EXTENDED_EXERCISE_IDS,
} from "./extendedCatalog.js";

/**
 * Catégorie fonctionnelle par défaut pour les 17 exercices de base et les 3 intégrés.
 */
const BASE_CATEGORY_BY_ID = Object.freeze({
  KBOX_SQUAT_HARNESS: "POSTERIOR_HIP_ANKLE",
  KBOX_SQUAT_BELT: "POSTERIOR_HIP_ANKLE",
  KBOX_SPLIT_SQUAT: "POSTERIOR_HIP_ANKLE",
  KBOX_RDL: "POSTERIOR_HIP_ANKLE",
  KBOX_HIP_THRUST: "POSTERIOR_HIP_ANKLE",
  KBOX_CALF_ECC: "POSTERIOR_HIP_ANKLE",
  KBOX_HIGH_PULL: "UPPER_BODY",
  DB_SL_RDL: "POSTERIOR_HIP_ANKLE",
  DB_STEP_DOWN: "POSTERIOR_HIP_ANKLE",
  DB_COPENHAGEN: "POSTERIOR_HIP_ANKLE",
  DB_RENEGADE_ROW: "CORE_TRUNK",
  DB_FARMER_UNI: "CORE_TRUNK",
  BAND_MONSTER_WALK: "POSTERIOR_HIP_ANKLE",
  BAND_PALLOF_PRESS: "CORE_TRUNK",
  BAND_PSOAS_MARCH: "POSTERIOR_HIP_ANKLE",
  BAND_FACE_PULL: "UPPER_BODY",
  CORE_MCGILL_BIG3: "CORE_TRUNK",
  USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND: "CORE_TRUNK",
  USER_TIRAGE_HORIZONTAL_ELASTIQUE: "UPPER_BODY",
  USER_BIRD_DOG_ANTI_ROTATION_AU_SOL: "CORE_TRUNK",
});

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
    short_desc: "Quadriceps & chaîne antérieure — freinage profond harnais épaules (compression axiale haute).",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 1.8,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_SQUAT_HARNESS.svg",
      tempo_badge: "Freinage tardif bas • 3.5s/rep",
      setup: "Pieds largeur d'épaules centrés sur la poulie kBox, harnais ajusté au plus court en extension quasi complète genoux déverrouillés.",
      execution: [
        "Amorce par 2 répétitions progressives pour lancer le volant d'inertie dans l'axe vertical.",
        "Pousse fort à travers le médio-pied en expirant sur la phase concentrique sans verrouiller les genoux.",
        "Absorbe la descente en freinant tardivement sur le dernier tiers bas pour maximiser la surcharge excentrique."
      ],
      errors: [
        "Arrondir le bas du dos L4-L5 sous la traction du harnais en fin de flexion.",
        "Laisser les genoux rentrer en valgus interne lors du freinage excentrique.",
        "Décoller les talons du plateau kBox au point bas du squat."
      ],
    },
  },
  {
    id: "KBOX_SQUAT_BELT",
    pole: "KBOX",
    name: "Belt Squat Ceinture Pelvienne (Décharge L4-L5 100%)",
    short_desc: "Quadriceps fort stimulus excentrique — traction pelvienne zéro compression lombaire L4-L5.",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 0.8,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_SQUAT_BELT.svg",
      tempo_badge: "Freinage tardif bas • 3.5s/rep",
      setup: "Ceinture pelvienne calée sur les crêtes iliaques au-dessus du sacrum, sangle tendue en position haute et mains en appui léger devant soi.",
      execution: [
        "Lance l'inertie sur 2 répétitions de mise en vitesse en gardant le buste vertical.",
        "Pousse le sol en alignant rotules et 2e orteil sur toute l'extension de hanche et de genou.",
        "Freine puissamment la descente dans le tiers inférieur en conservant le rachis lombaire totalement déchargé."
      ],
      errors: [
        "Placer la ceinture trop haut sur la taille et comprimer l'abdomen ou les lombaires.",
        "Tirer avec les bras sur le support avant au lieu de freiner avec les quadriceps.",
        "Laisser le genou dévier en valgus dynamique en phase de décélération."
      ],
    },
  },
  {
    id: "KBOX_SPLIT_SQUAT",
    pole: "KBOX",
    name: "Squat Bulgare / Fente Unilatérale",
    short_desc: "Force unilatérale spécifique pédalage — stabilité bassin et freinage fessier/quadriceps.",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 3.0,
    cns_spinal_tax: 1.3,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_SPLIT_SQUAT.svg",
      tempo_badge: "Freinage unilatéral • 3.0s/rep",
      setup: "Pied avant centré à l'aplomb de la poulie kBox, pied arrière posé en appui léger sur banc ou bloc, ceinture ou harnais ajusté en position haute.",
      execution: [
        "Démarre par 2 répétitions progressives en répartissant 80 % de l'appui sur la jambe avant.",
        "Propulse verticalement via le talon et le médio-pied avant avec le bassin parfaitement horizontal.",
        "Contrôle la redescente verticale du genou arrière en freinant fortement l'amplitude basse."
      ],
      errors: [
        "Basculer le bassin latéralement (chute de hanche) par manque de gainage fessier.",
        "Laisser le genou avant s'effondrer vers l'intérieur sous la traction du volant.",
        "Pousser avec la pointe du pied arrière au lieu de charger la jambe avant."
      ],
    },
  },
  {
    id: "KBOX_RDL",
    pole: "KBOX",
    name: "Soulevé de Terre Roumain Barre",
    short_desc: "Ischio-jambiers & érecteurs du rachis — charnière de hanche sous forte tension excentrique.",
    pattern: "HIP_DOMINANT",
    allowed_loads: [0.050, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 4.0,
    cns_spinal_tax: 2.0,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_RDL.svg",
      tempo_badge: "Charnière excentrique • 4.0s/rep",
      setup: "Barre courte reliée à la poulie entre les pieds largeur de hanches, sangle réglée pour atteindre le point haut genoux quasi tendus (15° de flexion).",
      execution: [
        "Engage les dorsaux et initie la charnière en reculant les hanches avec les tibias verticaux.",
        "Étend les hanches avec force en contractant fessiers et ischios sans hyperextension lombaire en haut.",
        "Freine lentement l'allongement excentrique des ischio-jambiers jusqu'à mi-tibia en gardant le dos plat."
      ],
      errors: [
        "Délaisser la charnière de hanche pour fléchir le rachis lombaire L4-L5 sous forte inertie.",
        "Laisser la barre s'éloigner des cuisses, multipliant le bras de levier sur les lombaires.",
        "Verrouiller brutalement les genoux ou cambrer le bas du dos en fin d'extension."
      ],
    },
  },
  {
    id: "KBOX_HIP_THRUST",
    pole: "KBOX",
    name: "Hip Thrust / Pull-Through Ceinture",
    short_desc: "Extension de hanche grands fessiers — zéro cisaillement lombaire, transfert point mort haut.",
    pattern: "HIP_DOMINANT",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 2.5,
    cns_spinal_tax: 0.9,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_HIP_THRUST.svg",
      tempo_badge: "Poussée explosive • 2.5s/rep",
      setup: "Ceinture calée sur le pli des hanches (pull-through debout ou pont dorsal calé), poulie alignée dans l'axe du vecteur d'extension.",
      execution: [
        "Amorce par 2 extensions progressives en verrouillant les côtes basses et le gainage abdominal.",
        "Projette les hanches en extension complète par contraction maximale des grands fessiers.",
        "Freine le retour de flexion de hanche sans relâcher la sangle abdominale ni cambrer."
      ],
      errors: [
        "Compenser un manque d'extension de hanche par une hyperlordose lombaire L4-L5.",
        "Pousser dans les orteils et avancer les genoux au lieu de stabiliser par les talons.",
        "Relâcher brutalement la tension en fin de course excentrique."
      ],
    },
  },
  {
    id: "KBOX_CALF_ECC",
    pole: "KBOX",
    name: "Extension Mollets Excentrique (Raideur Achille)",
    short_desc: "Raideur tendineuse d'Achille & soléaire — transmission de puissance cheville/pédale.",
    pattern: "ANKLE_STIFFNESS",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 3.5,
    cns_spinal_tax: 0.5,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_CALF_ECC.svg",
      tempo_badge: "Excentrique tendineux • 3.5s/rep",
      setup: "Avant-pieds posés sur cale stable au-dessus de la poulie kBox, harnais ou ceinture ajusté en flexion plantaire maximale.",
      execution: [
        "Lance l'inertie par 2 flexions plantaires contrôlées en gardant les genoux quasi tendus.",
        "Pousse fort sur la tête du 1er et 2e métatarsien pour monter au maximum sur la pointe.",
        "Freine la descente des talons sur toute la dorsiflexion pour solliciter la raideur du tendon d'Achille."
      ],
      errors: [
        "Rebondir passivement au point bas de la cale au lieu de freiner musculairement.",
        "Basculer le poids sur le bord externe des pieds (supination de cheville).",
        "Fléchir excessivement les genoux pour contourner le travail du gastrocnémien."
      ],
    },
  },
  {
    id: "KBOX_HIGH_PULL",
    pole: "KBOX",
    name: "Tirage Haut / Rowing Poignées",
    short_desc: "Chaîne postérieure haute, trapèzes & fixateurs — maintien postural sur le cintre.",
    pattern: "UPPER_PULL",
    allowed_loads: [0.025, 0.050],
    parasitic_reps: 2,
    unit_tut_sec: 2.5,
    cns_spinal_tax: 1.1,
    is_timed: false,
    unit_label: "kg·m²",
    guide: {
      svg_path: "./assets/exos/KBOX_HIGH_PULL.svg",
      tempo_badge: "Tirage dynamique • 2.5s/rep",
      setup: "Pieds largeur d'épaules encadrant la poulie, buste incliné à 30-45° dos plat neutre, sangle en tension bras tendus.",
      execution: [
        "Initie le tirage par une dépression et rétraction des omoplates avant la flexion des coudes.",
        "Tire les poignées vers les côtes basses en expirant et en maintenant l'angle du buste fixe.",
        "Freine le retour des bras sur toute l'amplitude sans laisser les épaules s'enrouler vers l'avant."
      ],
      errors: [
        "Redresser le buste par à-coups lombaires pour compenser la vitesse du volant.",
        "Hausser les épaules vers les oreilles (sur-activation du trapèze supérieur).",
        "Arrondir la région dorsale et lombaire en bas de phase excentrique."
      ],
    },
  },

  // --- Pôle B : Haltères & Poids de corps chargé (DUMBBELL) ---
  {
    id: "DB_SL_RDL",
    pole: "DUMBBELL",
    name: "RDL Unilatéral Tempo 3-1-1",
    short_desc: "Équilibre proprioceptif & ischios en unilatéral — descente contrôlée 3s, pause 1s en bas.",
    pattern: "HIP_DOMINANT",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 5.0,
    beta_ecc: 1.4,
    cns_spinal_tax: 1.1,
    is_timed: false,
    unit_label: "kg",
    guide: {
      svg_path: "./assets/exos/DB_SL_RDL.svg",
      tempo_badge: "Tempo 3-1-1 • 5.0s/rep",
      setup: "Appui unipodal pied nu ou chaussure plate, genou porteur déverrouillé à 15°, haltère tenu en main controlatérale près de la cuisse.",
      execution: [
        "Bascule en bloc autour de la hanche en projetant le talon libre vers l'arrière sur 3 secondes.",
        "Marque 1 seconde d'arrêt isométrique en bas avec les deux crêtes iliaques parallèles au sol.",
        "Remonte en 1 seconde en poussant le pied d'appui dans le sol et en serrant le fessier porteur."
      ],
      errors: [
        "Ouvrir la hanche du côté libre (rotation pelvienne) en perdant l'alignement horizontal.",
        "Arrondir la zone lombaire L4-L5 pour tenter de descendre l'haltère plus bas.",
        "Laisser le genou d'appui rentrer vers l'intérieur sous le déséquilibre latéral."
      ],
    },
  },
  {
    id: "DB_STEP_DOWN",
    pole: "DUMBBELL",
    name: "Step-Down Excentrique Lent (Descente 4s)",
    short_desc: "Contrôle excentrique du genou dans l'axe (descente freinée 4s sans valgus).",
    pattern: "KNEE_DOMINANT",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 5.0,
    beta_ecc: 1.4,
    cns_spinal_tax: 1.0,
    is_timed: false,
    unit_label: "kg",
    guide: {
      svg_path: "./assets/exos/DB_STEP_DOWN.svg",
      tempo_badge: "Excentrique 4-0-1 • 5.0s/rep",
      setup: "Debout au bord d'une marche stable (15-20 cm), haltères le long du corps ou en gobelet, pied libre fléchi en dorsiflexion.",
      execution: [
        "Amorce la flexion sur la jambe d'appui en gardant le talon fermement ancré sur la marche.",
        "Freine la descente sur 4 secondes exactes jusqu'à effleurer le sol avec le talon libre sans y transférer le poids.",
        "Remonte en 1 seconde en poussant dans le médio-pied tout en maintenant le genou aligné."
      ],
      errors: [
        "Laisser le genou porteur plonger en valgus interne pendant la descente lente.",
        "Se laisser tomber sur les deux dernières secondes ou rebondir avec le pied au sol.",
        "Incliner excessivement le buste sur le côté par faiblesse du moyen fessier."
      ],
    },
  },
  {
    id: "DB_COPENHAGEN",
    pole: "DUMBBELL",
    name: "Adducteurs Copenhagen (Isométrique secondes)",
    short_desc: "Gainage isométrique des adducteurs & symphyse pubienne — alignement genou au pédalage.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [0, 4, 6],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 0.8,
    is_timed: true,
    unit_label: "kg",
    guide: {
      svg_path: "./assets/exos/DB_COPENHAGEN.svg",
      tempo_badge: "Isométrique • Maintien continu",
      setup: "En appui latéral sur l'avant-bras sous l'épaule, jambe supérieure posée sur un banc (du genou ou de la cheville selon niveau), haltère éventuel sur la hanche.",
      execution: [
        "Décolle le bassin du sol pour aligner parfaitement tête, rachis thoraco-lombaire et jambe d'appui.",
        "Maintiens une respiration nasale fluide et régulière tout en pressant le banc avec l'intérieur du membre supérieur.",
        "Garde la jambe inférieure libre décollée ou prête à assister sans jamais laisser la hanche s'affaisser."
      ],
      errors: [
        "Laisser le bassin chuter vers le sol ou partir en rotation antérieure/postérieure.",
        "Ressentir une surcharge douloureuse sur le compartiment interne du genou (raccourcir le levier au genou).",
        "Bloquer la respiration en apnée prolongée, créant une perte de stabilité du caisson abdominal."
      ],
    },
  },
  {
    id: "DB_RENEGADE_ROW",
    pole: "DUMBBELL",
    name: "Planche Dynamique + Tirage Unilatéral",
    short_desc: "Gainage anti-rotation sous tirage unilatéral — verrouillage lombo-pelvien.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [6, 8, 10],
    parasitic_reps: 0,
    unit_tut_sec: 4.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 1.0,
    is_timed: false,
    unit_label: "kg",
    guide: {
      svg_path: "./assets/exos/DB_RENEGADE_ROW.svg",
      tempo_badge: "Anti-rotation 2-1-1 • 4.0s/rep",
      setup: "Position de planche haute mains sur haltères hexagonaux sous les épaules, pieds écartés plus larges que le bassin pour élargir la base.",
      execution: [
        "Verrouille fessiers et sangle abdominale pour figer le bassin parallèle au sol avant de décoller une main.",
        "Tire l'haltère vers la hanche en 1 seconde sur une expiration contrôlée, coude proche du flanc.",
        "Redescends la charge en 2 secondes avec contrôle total sans impact bruyant ni bascule latérale."
      ],
      errors: [
        "Vriller les hanches ou ouvrir l'épaule vers le haut à chaque tirage.",
        "Creuser le bas du dos L4-L5 par relâchement des abdominaux et des fessiers.",
        "Tirer l'haltère vers le haut de la poitrine en haussant l'épaule."
      ],
    },
  },
  {
    id: "DB_FARMER_UNI",
    pole: "DUMBBELL",
    name: "Marche du Fermier / Valise Unilatérale (Carré des lombes)",
    short_desc: "Marche chargée d'une seule main — renforcement du carré des lombes en anti-flexion latérale.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [10],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    beta_ecc: 1.0,
    cns_spinal_tax: 0.9,
    is_timed: true,
    unit_label: "kg",
    guide: {
      svg_path: "./assets/exos/DB_FARMER_UNI.svg",
      tempo_badge: "Marche chargée • Tension continue",
      setup: "Un seul haltère saisi fermement à une main, bras légèrement écarté du flanc, épaule basse et ceinture scapulaire engagée.",
      execution: [
        "Grandis la colonne vertébrale en maintenant les épaules et les crêtes iliaques strictement horizontales.",
        "Marche à pas courts, réguliers et silencieux tout en gardant une respiration diaphragmatique sous gainage.",
        "Résiste activement à l'inclinaison latérale grâce au carré des lombes et aux obliques controlatéraux."
      ],
      errors: [
        "Se pencher du côté opposé à la charge ou laisser l'épaule chargée s'affaisser.",
        "Faire de trop grandes enjambées provoquant un déhanchement parasite.",
        "Coller l'haltère contre la cuisse pour alléger le travail stabilisateur du tronc."
      ],
    },
  },

  // --- Pôle C : Élastiques & Gainage neuromusculaire (BAND_CORE) ---
  {
    id: "BAND_MONSTER_WALK",
    pole: "BAND_CORE",
    name: "Marche Latérale / Monster Walk (Moyen Fessier)",
    short_desc: "Activation moyen fessier sous tension continue — stabilise le bassin et prévient le valgus.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [2, 3],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.4,
    is_timed: true,
    unit_label: "niv.",
    guide: {
      svg_path: "./assets/exos/BAND_MONSTER_WALK.svg",
      tempo_badge: "Tension continue • Pas contrôlés",
      setup: "Mini-bande élastique placée autour des chevilles (ou juste sous les genoux), posture en quart de squat pieds parallèles sous tension initiale.",
      execution: [
        "Engage le pas latéral en poussant par le talon et l'abduction de hanche sans incliner le buste.",
        "Maintiens une tension constante de l'élastique tout au long de la série sans jamais rapprocher totalement les pieds.",
        "Freine le retour de la jambe suiveuse avec contrôle pour éviter tout claquement vers l'intérieur."
      ],
      errors: [
        "Laisser les genoux s'effondrer en valgus interne sous la traction de la bande.",
        "Se balancer latéralement des épaules ou monter/descendre à chaque pas au lieu de garder le bassin horizontal.",
        "Tourner les pointes de pieds vers l'extérieur pour recruter les fléchisseurs au détriment du moyen fessier."
      ],
    },
  },
  {
    id: "BAND_PALLOF_PRESS",
    pole: "BAND_CORE",
    name: "Pallof Press Anti-Rotation Iso-Dynamique",
    short_desc: "Pressions anti-rotation élastique — rigidifie le tronc contre les oscillations parasites.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    guide: {
      svg_path: "./assets/exos/BAND_PALLOF_PRESS.svg",
      tempo_badge: "Iso-dynamique • Maintien 2s avant",
      setup: "Élastique ancré latéralement à hauteur du sternum, position athlétique genoux déverrouillés, mains jointes collées contre le plexus.",
      execution: [
        "Verrouille les côtes basses et le bassin de face avant de pousser les mains droit devant le sternum.",
        "Expire régulièrement en tendant les bras et maintiens 2 secondes en extension complète contre la traction latérale.",
        "Ramène lentement les mains vers le sternum en résistant à toute torsion de la colonne vertébrale."
      ],
      errors: [
        "Laisser l'élastique faire pivoter les épaules ou le nombril vers le point d'ancrage.",
        "Compenser la traction en haussant les épaules ou en cambrant les lombaires L4-L5.",
        "Décaler la trajectoire des mains hors de l'axe médian du sternum."
      ],
    },
  },
  {
    id: "BAND_PSOAS_MARCH",
    pole: "BAND_CORE",
    name: "Flexion de Hanche Résistée Psoas",
    short_desc: "Flexion de hanche résistée — renforce le psoas-iliaque et le retour de pédale.",
    pattern: "HIP_DOMINANT",
    allowed_loads: [2, 3],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    guide: {
      svg_path: "./assets/exos/BAND_PSOAS_MARCH.svg",
      tempo_badge: "Flexion active • Tempo contrôlé",
      setup: "Mini-bande passée autour des deux avant-pieds (ou ancrée au sol sous le pied d'appui), station droite contre un appui léger, cheville mobile en dorsiflexion.",
      execution: [
        "Stabilise fermement le bassin sur la jambe d'appui tendue (fessier porteur engagé) avant d'amorcer la montée.",
        "Monte le genou au-dessus de 90° de flexion de hanche en expirant, pied fléchi vers le tibia.",
        "Freine lentement le retour du pied vers le sol sans laisser le bassin basculer."
      ],
      errors: [
        "Arrondir le bas du dos (rétroversion pelvienne) pour monter le genou plus haut que 90°.",
        "Se pencher en arrière avec les épaules pour aider la flexion de hanche.",
        "Relâcher brusquement la tension de l'élastique lors de la phase excentrique."
      ],
    },
  },
  {
    id: "BAND_FACE_PULL",
    pole: "BAND_CORE",
    name: "Face Pull + Rotation Externe Scapulaire",
    short_desc: "Coiffe des rotateurs & fixateurs d'omoplates — ouvre la cage thoracique après le vélo.",
    pattern: "UPPER_PULL",
    allowed_loads: [1, 2],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.4,
    is_timed: true,
    unit_label: "niv.",
    guide: {
      svg_path: "./assets/exos/BAND_FACE_PULL.svg",
      tempo_badge: "Tirage + pause 1s • Tension continue",
      setup: "Élastique ancré face au visage à hauteur des yeux, prise en pronation pouces orientés vers soi, posture en fente stable côtes basses.",
      execution: [
        "Initie le tirage vers le front en écartant les mains et en gardant les coudes hauts à hauteur d'épaules.",
        "Termine par une rotation externe nette (pouces pointant vers l'arrière, position en W) avec pause de 1 seconde.",
        "Freine le retour des bras jusqu'à l'extension complète en contrôlant la protraction des omoplates."
      ],
      errors: [
        "Projeter les côtes en avant et cambrer la zone lombaire L4-L5 pour finir le tirage.",
        "Laisser les coudes tomber sous les poignets, annulant la rotation externe de l'épaule.",
        "Avancer le menton vers les mains au lieu de garder la nuque alignée."
      ],
    },
  },
  {
    id: "CORE_MCGILL_BIG3",
    pole: "BAND_CORE",
    name: "Trilogie de McGill (Curl-up, Side Bridge, Bird-Dog)",
    short_desc: "Endurance isométrique 360° du rachis (Curl-up, Side Bridge, Bird-Dog) sans flexion discale.",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [1],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    guide: {
      svg_path: "./assets/exos/CORE_MCGILL_BIG3.svg",
      tempo_badge: "Isométrique 360° • Séries 10s",
      setup: "Au sol sur tapis ferme : mains sous la courbure lombaire (Curl-up), avant-bras sous l'épaule (Side Bridge), quadrupédie neutre (Bird-Dog).",
      execution: [
        "Pré-active le caisson abdominal à 360° (bracing) tout en conservant la lordose lombaire naturelle intacte.",
        "Maintiens chaque posture par blocs isométriques de 10 secondes en respirant de façon fluide sans apnée.",
        "En Bird-Dog, glisse bras et jambe opposés à l'horizontale sans aucune rotation ni cambrure du bassin."
      ],
      errors: [
        "Écraser ou fléchir les disques lombaires L4-L5 au sol pendant le Curl-up.",
        "Lever la jambe ou le bras trop haut en Bird-Dog, déclenchant une hyperextension lombaire.",
        "Laisser la hanche s'affaisser ou vriller vers l'avant durant le Side Bridge."
      ],
    },
  },
];

/** Liste ordonnée et immuable des 17 exercices. */
export const CATALOG = deepFreeze(
  RAW_CATALOG.map((ex) => ({
    ...ex,
    category: ex.category ?? BASE_CATEGORY_BY_ID[ex.id] ?? "CORE_TRUNK",
  }))
);

/** Dictionnaire immuable indexé par ID d'exercice. */
export const CATALOG_BY_ID = deepFreeze(
  Object.fromEntries(CATALOG.map((ex) => [ex.id, ex]))
);

/** Liste immuable des identifiants valides du catalogue. */
export const EXERCISE_IDS = deepFreeze(CATALOG.map((ex) => ex.id));

/** Modèles génériques hors-catalogue pour le mode libre et l'import Markdown. */
export const CUSTOM_TEMPLATES = deepFreeze({
  CUSTOM_KBOX: {
    id: "CUSTOM_KBOX",
    pole: "KBOX",
    name: "Exercice kBox Libre",
    short_desc:
      "Exercice isoinertiel hors-catalogue (calcul exact sur inertie kBox).",
    pattern: "CUSTOM",
    allowed_loads: [0.025, 0.05, 0.075],
    parasitic_reps: 2,
    unit_tut_sec: 3.0,
    cns_spinal_tax: 1.3,
    is_timed: false,
    unit_label: "kg·m²",
    default_sets: 3,
    default_reps: 8,
    is_custom: true,
    guide: null,
  },
  CUSTOM_DUMBBELL: {
    id: "CUSTOM_DUMBBELL",
    pole: "DUMBBELL",
    name: "Exercice Haltères Libre",
    short_desc: "Exercice charge additionnelle hors-catalogue.",
    pattern: "CUSTOM",
    allowed_loads: [2, 4, 6, 8, 10, 12, 16, 20],
    parasitic_reps: 0,
    unit_tut_sec: 3.5,
    beta_ecc: 1.0,
    cns_spinal_tax: 1.0,
    is_timed: false,
    unit_label: "kg",
    default_sets: 3,
    default_reps: 10,
    is_custom: true,
    guide: null,
  },
  CUSTOM_BAND_CORE: {
    id: "CUSTOM_BAND_CORE",
    pole: "BAND_CORE",
    name: "Exercice Élastique / PDC Libre",
    short_desc:
      "Exercice poids de corps, gainage ou élastique hors-catalogue.",
    pattern: "CUSTOM",
    allowed_loads: [0, 1, 2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    default_sets: 3,
    default_reps: 45,
    is_custom: true,
    guide: null,
  },
});

/** Liste immuable des identifiants des modèles libres. */
export const CUSTOM_TEMPLATE_IDS = deepFreeze(Object.keys(CUSTOM_TEMPLATES));

/** Liste immuable de tous les identifiants valides (catalogue + modèles libres). */
export const ALL_EXERCISE_IDS = deepFreeze([
  ...EXERCISE_IDS,
  ...CUSTOM_TEMPLATE_IDS,
]);

/**
 * Exercices utilisateur intégrés nativement au catalogue officiel (v1.7.1)
 * avec schémas SVG différenciés sur disque et fiches biomécaniques dédiées.
 */
const RAW_INTEGRATED_USER_EXERCISES = [
  {
    id: "USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND",
    name: "Gainage Planche Ventrale (Gainage Profond)",
    pole: "BAND_CORE",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [0, 1, 2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    default_sets: 3,
    default_reps: 45,
    is_custom: false,
    is_user_catalog: true,
    is_integrated_user: true,
    short_desc:
      "Transverse & caisson abdominal profond — verrouillage lombo-pelvien isométrique sans cisaillement L4-L5.",
    guide: {
      svg_path: "./assets/exos/USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND.svg",
      tempo_badge: "Isométrique • Maintien strict 45s",
      setup:
        "En planche ventrale sur avant-bras et pointes de pieds sur tapis, coudes exactement à l'aplomb des épaules, regard au sol et rétroversion pelvienne neutre.",
      execution: [
        "Auto-grandis la colonne de la nuque jusqu'aux talons en repoussant activement le tapis avec les avant-bras.",
        "Engage le transverse (nombril rentré vers le rachis) tout en maintenant une respiration diaphragmatique fluide et régulière.",
        "Conserve une tension globale homogène des épaules aux talons via un serrage modéré des fessiers et quadriceps.",
      ],
      errors: [
        "Creuser les lombaires (hyperlordose L4-L5) par relâchement de la sangle abdominale profonde.",
        "Monter le bassin trop haut en V inversé pour décharger le caisson antérieur.",
        "Bloquer la respiration en apnée (manœuvre de Valsalva) au lieu de ventiler calmement.",
      ],
    },
  },
  {
    id: "USER_TIRAGE_HORIZONTAL_ELASTIQUE",
    name: "Tirage Horizontal Élastique",
    pole: "BAND_CORE",
    pattern: "UPPER_PULL",
    allowed_loads: [0, 1, 2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: false,
    unit_label: "niv.",
    default_sets: 3,
    default_reps: 12,
    is_custom: false,
    is_user_catalog: true,
    is_integrated_user: true,
    short_desc:
      "Rhomboïdes, trapèzes moyens & dorsaux — rééquilibrage postural contre l'enroulement thoracique du cycliste.",
    guide: {
      svg_path: "./assets/exos/USER_TIRAGE_HORIZONTAL_ELASTIQUE.svg",
      tempo_badge: "Tirage horizontal • Tempo 2-1-2",
      setup:
        "Posture en fente athlétique stable face au point d'ancrage réglé à hauteur du sternum / côtes basses, côtes abaissées et bras tendus sous pré-tension sans protraction excessive.",
      execution: [
        "Initie chaque répétition par le serrage et l'abaissement contrôlé des omoplates loin des oreilles.",
        "Tire les coudes bas le long des côtes vers les hanches jusqu'au contact des mains près du buste avec une pause isométrique d'1s.",
        "Freine le retour sur 2s en gardant le tronc verrouillé et la tension continue dans l'élastique.",
      ],
      errors: [
        "Hausser les épaules vers les oreilles en sur-recrutant les trapèzes supérieurs.",
        "Cambrer les lombaires ou balancer le buste vers l'arrière pour terminer le tirage.",
        "Relâcher brusquement l'élastique en phase excentrique en perdant le contrôle scapulaire.",
      ],
    },
  },
  {
    id: "USER_BIRD_DOG_ANTI_ROTATION_AU_SOL",
    name: "Bird-Dog Anti-Rotation au Sol",
    pole: "BAND_CORE",
    pattern: "LUMBO_PELVIC",
    allowed_loads: [0, 1, 2, 3, 4],
    parasitic_reps: 0,
    unit_tut_sec: 1.0,
    cns_spinal_tax: 0.5,
    is_timed: true,
    unit_label: "niv.",
    default_sets: 3,
    default_reps: 40,
    is_custom: false,
    is_user_catalog: true,
    is_integrated_user: true,
    short_desc:
      "Stabilité anti-rotation et anti-extension L4-L5 en quadrupédie — contrôle croisé hanche/épaule sans cisaillement lombaire.",
    guide: {
      svg_path: "./assets/exos/USER_BIRD_DOG_ANTI_ROTATION_AU_SOL.svg",
      tempo_badge: "Quadrupédie • Tempo lent 3-2-3",
      setup:
        "En quadrupédie sur tapis, mains exactement sous les épaules et genoux sous les hanches, nuque dans le prolongement du dos et caisson abdominal pré-engagé.",
      execution: [
        "Tends le bras et la jambe opposés dans l'axe horizontal, sans dépasser la ligne du bassin.",
        "Tiens 2 s avec le bassin parallèle au sol, sans vrille, en respirant calmement.",
        "Reviens lentement avec contrôle, puis alterne le côté.",
      ],
      errors: [
        "Creuser les lombaires (L4-L5) en levant trop la jambe.",
        "Vriller ou ouvrir la hanche du côté de la jambe tendue.",
        "Affaisser les omoplates ou relever la tête.",
      ],
    },
  },
];

/** Liste immuable des exercices utilisateur intégrés nativement au catalogue. */
export const INTEGRATED_USER_EXERCISES = deepFreeze(
  RAW_INTEGRATED_USER_EXERCISES.map((ex) => ({
    ...ex,
    category: ex.category ?? BASE_CATEGORY_BY_ID[ex.id] ?? "CORE_TRUNK",
  }))
);

/** Dictionnaire immuable indexé par ID des exercices utilisateur intégrés. */
export const INTEGRATED_USER_EXERCISES_BY_ID = deepFreeze(
  Object.fromEntries(INTEGRATED_USER_EXERCISES.map((ex) => [ex.id, ex]))
);

/** Ré-exports du catalogue étendu v1.9.0 (35 exercices, 5 catégories). */
export {
  EXTENDED_CATEGORIES,
  EXTENDED_CATALOG_EXERCISES,
  EXTENDED_CATALOG_BY_ID,
  EXTENDED_EXERCISE_IDS,
};

/** Liste combinée et immuable des 55 exercices officiels (17 base + 3 intégrés + 35 étendus). */
export const ALL_OFFICIAL_EXERCISES = deepFreeze([
  ...CATALOG,
  ...INTEGRATED_USER_EXERCISES,
  ...EXTENDED_CATALOG_EXERCISES,
]);

/** Catégories ordonnées exposées par l'annuaire d'exercices. */
export const DIRECTORY_CATEGORIES = deepFreeze([
  { id: "ALL", label: "Toutes" },
  { id: "UPPER_BODY", label: "Haut / Tractions" },
  { id: "CORE_TRUNK", label: "Tronc / Gainage" },
  { id: "POSTERIOR_HIP_ANKLE", label: "Postérieur / Hanche / Cheville" },
  { id: "VELOCITY", label: "Vitesse" },
  { id: "PLYOMETRICS", label: "Pliométrie" },
  { id: "PERSO", label: "Perso" },
]);

/** Équipements ordonnés exposés par l'annuaire d'exercices. */
export const DIRECTORY_EQUIPMENTS = deepFreeze([
  { id: "ALL", label: "Tous" },
  { id: "KBOX", label: "kBox" },
  { id: "BAND", label: "Élastiques" },
  { id: "DUMBBELL", label: "Haltères" },
  { id: "BARBELL", label: "Barre" },
  { id: "KETTLEBELL", label: "Kettlebell" },
  { id: "AB_WHEEL", label: "Roue abdo" },
  { id: "PDC", label: "PDC" },
]);

/** Clé de persistance localStorage pour les exercices promus dans le catalogue utilisateur. */
export const USER_EXERCISES_STORAGE_KEY = "WEBSTRENGTH_USER_EXERCISES_V1";

const VALID_POLES = new Set(["KBOX", "DUMBBELL", "BAND_CORE"]);

/** Repli mémoire pour l'environnement Node.js ou lorsque localStorage est indisponible. */
let memoryUserExercises = {};

/**
 * Vérifie si `globalThis.localStorage` est accessible sans lever d'exception.
 * @returns {Storage | null}
 */
function getSafeLocalStorage() {
  try {
    const ls = globalThis?.localStorage;
    if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") {
      return ls;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Valide et normalise une entrée d'exercice utilisateur.
 * Lève une `Error` si la structure ou les constantes biomécaniques sont invalides.
 * @param {any} exerciseObj
 * @returns {Readonly<Record<string, any>>}
 */
function normalizeAndValidateUserExercise(exerciseObj) {
  if (!exerciseObj || typeof exerciseObj !== "object") {
    throw new Error("Objet exercice utilisateur invalide.");
  }

  const id = typeof exerciseObj.id === "string" ? exerciseObj.id.trim() : "";
  if (!/^USER_[A-Z0-9_]+$/.test(id)) {
    throw new Error(`Identifiant d'exercice utilisateur invalide : "${id}".`);
  }

  const name = typeof exerciseObj.name === "string" ? exerciseObj.name.trim() : "";
  if (!name) {
    throw new Error("Le nom de l'exercice utilisateur est requis.");
  }

  const pole = typeof exerciseObj.pole === "string" ? exerciseObj.pole.trim().toUpperCase() : "";
  if (!VALID_POLES.has(pole)) {
    throw new Error(`Pôle matériel invalide : "${pole}".`);
  }

  if (
    !Array.isArray(exerciseObj.allowed_loads) ||
    exerciseObj.allowed_loads.length === 0 ||
    !exerciseObj.allowed_loads.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    throw new Error("allowed_loads doit être un tableau non vide de nombres finis.");
  }

  const parasiticReps = Number(exerciseObj.parasitic_reps);
  if (!Number.isFinite(parasiticReps) || parasiticReps < 0) {
    throw new Error("parasitic_reps doit être un nombre fini >= 0.");
  }

  const unitTutSec = Number(exerciseObj.unit_tut_sec);
  if (!Number.isFinite(unitTutSec) || unitTutSec <= 0) {
    throw new Error("unit_tut_sec doit être un nombre fini > 0.");
  }

  const cnsSpinalTax = Number(exerciseObj.cns_spinal_tax);
  if (!Number.isFinite(cnsSpinalTax) || cnsSpinalTax < 0) {
    throw new Error("cns_spinal_tax doit être un nombre fini >= 0.");
  }

  if (typeof exerciseObj.is_timed !== "boolean") {
    throw new Error("is_timed doit être un booléen.");
  }

  const unitLabel =
    typeof exerciseObj.unit_label === "string" ? exerciseObj.unit_label.trim() : "";
  if (!unitLabel) {
    throw new Error("unit_label doit être une chaîne non vide.");
  }

  const defaultSets = Number(exerciseObj.default_sets);
  const defaultReps = Number(exerciseObj.default_reps);
  if (!Number.isFinite(defaultSets) || defaultSets <= 0) {
    throw new Error("default_sets doit être un nombre fini > 0.");
  }
  if (!Number.isFinite(defaultReps) || defaultReps <= 0) {
    throw new Error("default_reps doit être un nombre fini > 0.");
  }

  let betaEcc;
  if (pole === "DUMBBELL") {
    betaEcc = Number(exerciseObj.beta_ecc);
    if (!Number.isFinite(betaEcc) || betaEcc <= 0) {
      throw new Error("beta_ecc doit être un nombre fini > 0 pour le pôle DUMBBELL.");
    }
  } else if (exerciseObj.beta_ecc !== undefined && exerciseObj.beta_ecc !== null) {
    const parsedBeta = Number(exerciseObj.beta_ecc);
    if (!Number.isFinite(parsedBeta) || parsedBeta <= 0) {
      throw new Error("beta_ecc doit être un nombre fini > 0.");
    }
    betaEcc = parsedBeta;
  }

  const shortDesc =
    typeof exerciseObj.short_desc === "string" ? exerciseObj.short_desc.trim() : "";
  if (!shortDesc) {
    throw new Error("short_desc est requis.");
  }

  const rawGuide = exerciseObj.guide;
  if (!rawGuide || typeof rawGuide !== "object") {
    throw new Error("guide est requis.");
  }

  const tempoBadge =
    typeof rawGuide.tempo_badge === "string" ? rawGuide.tempo_badge.trim() : "";
  const setup = typeof rawGuide.setup === "string" ? rawGuide.setup.trim() : "";
  if (!tempoBadge || !setup) {
    throw new Error("guide.tempo_badge et guide.setup sont requis.");
  }

  if (
    !Array.isArray(rawGuide.execution) ||
    rawGuide.execution.length !== 3 ||
    rawGuide.execution.some((s) => typeof s !== "string" || !s.trim())
  ) {
    throw new Error("guide.execution doit contenir exactement 3 chaînes non vides.");
  }

  if (
    !Array.isArray(rawGuide.errors) ||
    rawGuide.errors.length !== 3 ||
    rawGuide.errors.some((s) => typeof s !== "string" || !s.trim())
  ) {
    throw new Error("guide.errors doit contenir exactement 3 chaînes non vides.");
  }

  const sanitizedSvg = sanitizeSvgMarkup(
    exerciseObj.svg_inline ?? rawGuide.svg_inline
  );

  const pattern =
    typeof exerciseObj.pattern === "string" && exerciseObj.pattern.trim()
      ? exerciseObj.pattern.trim()
      : "CUSTOM";

  /** @type {Record<string, any>} */
  const normalized = {
    id,
    name,
    pole,
    pattern,
    allowed_loads: [...exerciseObj.allowed_loads],
    parasitic_reps: parasiticReps,
    unit_tut_sec: unitTutSec,
    cns_spinal_tax: cnsSpinalTax,
    is_timed: exerciseObj.is_timed,
    unit_label: unitLabel,
    default_sets: Math.round(defaultSets),
    default_reps: Math.round(defaultReps),
    short_desc: shortDesc,
    is_custom: false,
    is_user_catalog: true,
    svg_inline: sanitizedSvg,
    guide: {
      tempo_badge: tempoBadge,
      setup,
      execution: rawGuide.execution.map((s) => s.trim()),
      errors: rawGuide.errors.map((s) => s.trim()),
      svg_inline: sanitizedSvg,
    },
  };

  if (betaEcc !== undefined) {
    normalized.beta_ecc = betaEcc;
  }

  return deepFreeze(normalized);
}

/**
 * Persiste le dictionnaire brut des exercices utilisateur dans localStorage ou en mémoire.
 * @param {Record<string, any>} map
 */
function persistUserExercisesMap(map) {
  const ls = getSafeLocalStorage();
  if (ls) {
    try {
      ls.setItem(USER_EXERCISES_STORAGE_KEY, JSON.stringify(map));
      return;
    } catch {
      // Repli mémoire si le stockage navigateur échoue (quota, mode privé)
    }
  }
  memoryUserExercises = { ...map };
}

/**
 * Génère un identifiant déterministe `USER_<SLUG>` à partir d'un nom d'exercice.
 * Réutilise `USER_<SLUG>` s'il est absent ou déjà associé au même pôle dans `existingMap`.
 * En cas de collision sur un autre pôle, suffixe `_${pole}` puis `_2`, `_3`…
 * @param {string} name
 * @param {Record<string, any> | Map<string, any> | null} [existingMap=null]
 * @param {string | null} [pole=null]
 * @returns {string}
 */
export function generateUserExerciseId(name, existingMap = null, pole = null) {
  const rawSlug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");

  const slug = rawSlug || "EXERCICE";
  const baseId = `USER_${slug}`;
  const cleanPole =
    typeof pole === "string" && pole.trim()
      ? pole.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      : null;

  const mapRef = existingMap === null ? loadUserExercises() : existingMap;
  const getEntry = (candidateId) => {
    if (!mapRef) return undefined;
    if (mapRef instanceof Map) return mapRef.get(candidateId);
    return Object.hasOwn(mapRef, candidateId) ? mapRef[candidateId] : undefined;
  };

  const canUse = (candidateId) => {
    const existing = getEntry(candidateId);
    if (!existing) return true;
    if (cleanPole && String(existing.pole ?? "").toUpperCase() === cleanPole) {
      return true;
    }
    return false;
  };

  if (canUse(baseId)) {
    return baseId;
  }

  if (cleanPole) {
    const poleCandidate = `${baseId}_${cleanPole}`;
    if (canUse(poleCandidate)) {
      return poleCandidate;
    }
  }

  for (let idx = 2; ; idx++) {
    const numberedCandidate = `${baseId}_${idx}`;
    if (canUse(numberedCandidate)) {
      return numberedCandidate;
    }
  }
}

/**
 * Charge et valide les exercices utilisateur persistés sous `USER_EXERCISES_STORAGE_KEY`.
 * Retourne `{}` si aucune donnée valide n'est trouvée ou en cas de JSON corrompu.
 * @returns {Record<string, Readonly<Record<string, any>>>}
 */
export function loadUserExercises() {
  const ls = getSafeLocalStorage();
  let rawMap = null;

  if (ls) {
    try {
      const rawJson = ls.getItem(USER_EXERCISES_STORAGE_KEY);
      if (!rawJson) {
        return {};
      }
      rawMap = JSON.parse(rawJson);
    } catch {
      return {};
    }
  } else {
    rawMap = memoryUserExercises;
  }

  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  /** @type {Record<string, Readonly<Record<string, any>>>} */
  const validated = {};
  for (const [key, entry] of Object.entries(rawMap)) {
    try {
      const normalized = normalizeAndValidateUserExercise(entry);
      if (normalized.id === key) {
        validated[key] = normalized;
      }
    } catch {
      // Ignore silencieusement les entrées corrompues
    }
  }
  return validated;
}

/**
 * Valide, assainit le SVG, persiste et retourne un exercice utilisateur figé.
 * @param {Record<string, any>} exerciseObj
 * @returns {Readonly<Record<string, any>>}
 */
export function saveUserExercise(exerciseObj) {
  const normalized = normalizeAndValidateUserExercise(exerciseObj);
  const current = loadUserExercises();
  const next = {
    ...current,
    [normalized.id]: normalized,
  };
  persistUserExercisesMap(next);
  return normalized;
}

/**
 * Supprime un exercice utilisateur par identifiant.
 * @param {string} id
 * @returns {boolean}
 */
export function removeUserExercise(id) {
  if (typeof id !== "string" || !id) {
    return false;
  }
  const current = loadUserExercises();
  if (!Object.hasOwn(current, id)) {
    return false;
  }
  const next = { ...current };
  delete next[id];
  persistUserExercisesMap(next);
  return true;
}

/**
 * Vide intégralement le catalogue utilisateur persisté.
 */
export function clearUserExercises() {
  const ls = getSafeLocalStorage();
  if (ls) {
    try {
      ls.removeItem(USER_EXERCISES_STORAGE_KEY);
    } catch {
      // Ignore les erreurs d'accès localStorage
    }
  }
  memoryUserExercises = {};
}

/**
 * Retourne la liste des exercices utilisateur valides.
 * @returns {Array<Readonly<Record<string, any>>>}
 */
export function getUserExercisesList() {
  return Object.values(loadUserExercises());
}

/**
 * Retourne la liste combinée du catalogue officiel (17), des exercices utilisateur intégrés (3),
 * du catalogue étendu v1.9.0 (35) et des exercices utilisateur dynamiques sans doublon.
 * @returns {Array<Readonly<Record<string, any>>>}
 */
export function getAllCatalogExercises() {
  const dynamicOnly = getUserExercisesList().filter(
    (ex) =>
      !Object.hasOwn(CATALOG_BY_ID, ex.id) &&
      !Object.hasOwn(INTEGRATED_USER_EXERCISES_BY_ID, ex.id) &&
      !Object.hasOwn(EXTENDED_CATALOG_BY_ID, ex.id)
  );
  return [
    ...CATALOG,
    ...INTEGRATED_USER_EXERCISES,
    ...EXTENDED_CATALOG_EXERCISES,
    ...dynamicOnly,
  ];
}

const DIRECTORY_CATEGORY_LABEL_BY_ID = Object.fromEntries(
  DIRECTORY_CATEGORIES.map((entry) => [entry.id, entry.label])
);

const DIRECTORY_EQUIPMENT_LABEL_BY_ID = Object.fromEntries(
  DIRECTORY_EQUIPMENTS.map((entry) => [entry.id, entry.label])
);

const PDC_EXACT_IDS = new Set([
  "DB_COPENHAGEN",
  "CORE_MCGILL_BIG3",
  "USER_GAINAGE_PLANCHE_VENTRALE_GAINAGE_PROFOND",
  "USER_BIRD_DOG_ANTI_ROTATION_AU_SOL",
]);

/**
 * Normalise une chaîne en minuscules sans diacritiques (forme NFD).
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCatalogText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Détermine la liste non vide des codes d'équipement associés à un exercice.
 * @param {Record<string, any> | null | undefined} ex
 * @returns {string[]}
 */
export function getExerciseEquipments(ex) {
  if (!ex || typeof ex !== "object") {
    return ["BAND"];
  }
  const rawId = String(ex.id ?? "").trim();
  const upperId = rawId.toUpperCase();
  const pole = String(ex.pole ?? "").trim().toUpperCase();
  const normalizedText = normalizeCatalogText(
    [rawId, rawId.replaceAll("_", " "), ex.name, ex.short_desc]
      .filter(Boolean)
      .join(" ")
  );

  /** @type {string[]} */
  const equipments = [];

  if (pole === "KBOX" || upperId.startsWith("KBOX_")) {
    equipments.push("KBOX");
  }
  if (
    upperId.startsWith("AB_WHEEL_") ||
    normalizedText.includes("roue") ||
    normalizedText.includes("ab wheel")
  ) {
    equipments.push("AB_WHEEL");
  }
  if (
    upperId.startsWith("BARBELL_") ||
    normalizedText.includes("barre libre") ||
    normalizedText.includes("barbell")
  ) {
    equipments.push("BARBELL");
  }
  if (upperId.startsWith("KB_") || normalizedText.includes("kettlebell")) {
    equipments.push("KETTLEBELL");
  }
  if (
    upperId.startsWith("DB_") ||
    normalizedText.includes("haltere") ||
    normalizedText.includes("dumbbell")
  ) {
    equipments.push("DUMBBELL");
  }
  if (
    upperId.startsWith("BAND_") ||
    normalizedText.includes("elastique") ||
    normalizedText.includes("band") ||
    normalizedText.includes("mini-band")
  ) {
    equipments.push("BAND");
  }
  if (
    ex.is_bodyweight === true ||
    PDC_EXACT_IDS.has(upperId) ||
    upperId.startsWith("PULL_UP_") ||
    upperId.startsWith("PLYO_") ||
    normalizedText.includes("poids du corps") ||
    normalizedText.includes("pdc") ||
    normalizedText.includes("planche") ||
    normalizedText.includes("bird dog")
  ) {
    equipments.push("PDC");
  }

  if (equipments.length === 0) {
    if (pole === "KBOX") {
      return ["KBOX"];
    }
    if (pole === "DUMBBELL") {
      return ["DUMBBELL"];
    }
    return ["BAND"];
  }

  return equipments;
}

/**
 * Filtre un tableau d'exercices selon une requête textuelle, une catégorie et un équipement.
 * @param {Array<Record<string, any>>} exercises
 * @param {{ query?: string, category?: string, equipment?: string }} [filters]
 * @returns {Array<Record<string, any>>}
 */
export function filterCatalogExercises(
  exercises,
  { query = "", category = "ALL", equipment = "ALL" } = {}
) {
  if (!Array.isArray(exercises)) {
    return [];
  }
  const normalizedQuery = normalizeCatalogText(query);
  const activeCategory = category || "ALL";
  const activeEquipment = equipment || "ALL";

  return exercises.filter((ex) => {
    if (!ex || typeof ex !== "object") {
      return false;
    }
    const id = String(ex.id ?? "");
    const isPerso = Boolean(ex.is_user_catalog) || id.startsWith("USER_");

    if (activeCategory !== "ALL") {
      if (activeCategory === "PERSO") {
        if (!isPerso) {
          return false;
        }
      } else if (ex.category !== activeCategory) {
        return false;
      }
    }

    const equipments = getExerciseEquipments(ex);
    if (activeEquipment !== "ALL" && !equipments.includes(activeEquipment)) {
      return false;
    }

    if (normalizedQuery) {
      const categoryLabel = ex.category
        ? DIRECTORY_CATEGORY_LABEL_BY_ID[ex.category] ?? ""
        : "";
      const equipmentLabels = equipments.map(
        (code) => DIRECTORY_EQUIPMENT_LABEL_BY_ID[code] ?? code
      );
      const haystack = normalizeCatalogText(
        [
          id,
          id.replaceAll("_", " "),
          ex.name,
          ex.short_desc,
          categoryLabel,
          isPerso ? DIRECTORY_CATEGORY_LABEL_BY_ID.PERSO : "",
          ...equipmentLabels,
        ]
          .filter(Boolean)
          .join(" ")
      );
      if (!haystack.includes(normalizedQuery)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Exporte le catalogue utilisateur au format JSON prêt à être archivé ou partagé.
 * @returns {string}
 */
export function exportUserExercisesJson() {
  const items = getUserExercisesList().map((ex) => {
    /** @type {Record<string, any>} */
    const exported = {
      id: ex.id,
      name: ex.name,
      pole: ex.pole,
      pattern: ex.pattern,
      allowed_loads: [...ex.allowed_loads],
      parasitic_reps: ex.parasitic_reps,
      unit_tut_sec: ex.unit_tut_sec,
    };
    if (ex.beta_ecc !== undefined) {
      exported.beta_ecc = ex.beta_ecc;
    }
    exported.cns_spinal_tax = ex.cns_spinal_tax;
    exported.is_timed = ex.is_timed;
    exported.unit_label = ex.unit_label;
    exported.default_sets = ex.default_sets;
    exported.default_reps = ex.default_reps;
    exported.short_desc = ex.short_desc;
    exported.guide = {
      tempo_badge: ex.guide.tempo_badge,
      setup: ex.guide.setup,
      execution: [...ex.guide.execution],
      errors: [...ex.guide.errors],
    };
    exported.svg_inline = ex.svg_inline;
    return exported;
  });
  return JSON.stringify(items, null, 2);
}

/**
 * Récupère un exercice du catalogue (officiel, intégré, utilisateur dynamique ou modèle libre) par son identifiant.
 * Lève une erreur explicite si l'identifiant est inconnu.
 * @param {string} id
 * @returns {Readonly<Record<string, any>>}
 */
export function getCatalogExercise(id) {
  if (typeof id === "string") {
    if (Object.hasOwn(CATALOG_BY_ID, id)) {
      return CATALOG_BY_ID[id];
    }
    if (Object.hasOwn(INTEGRATED_USER_EXERCISES_BY_ID, id)) {
      return INTEGRATED_USER_EXERCISES_BY_ID[id];
    }
    if (Object.hasOwn(EXTENDED_CATALOG_BY_ID, id)) {
      return EXTENDED_CATALOG_BY_ID[id];
    }
    const userExercises = loadUserExercises();
    if (Object.hasOwn(userExercises, id)) {
      return userExercises[id];
    }
    if (Object.hasOwn(CUSTOM_TEMPLATES, id)) {
      return CUSTOM_TEMPLATES[id];
    }
  }
  throw new Error(
    `Exercice inconnu dans le catalogue WebStrength : "${String(id)}". IDs valides : ${EXERCISE_IDS.join(", ")}`
  );
}

/**
 * Détecte si une requête de recherche correspond à une URL HTTP(S).
 * @param {unknown} query
 * @returns {boolean}
 */
export function isUrlSearchQuery(query) {
  return /^https?:\/\//i.test(String(query ?? "").trim());
}
