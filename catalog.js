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
export const CATALOG = deepFreeze(RAW_CATALOG);

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
 * Récupère un exercice du catalogue (ou un modèle libre) par son identifiant.
 * Lève une erreur explicite si l'identifiant est inconnu.
 * @param {string} id
 * @returns {Readonly<typeof RAW_CATALOG[number] | typeof CUSTOM_TEMPLATES[keyof typeof CUSTOM_TEMPLATES]>}
 */
export function getCatalogExercise(id) {
  if (typeof id === "string") {
    if (Object.hasOwn(CATALOG_BY_ID, id)) {
      return CATALOG_BY_ID[id];
    }
    if (Object.hasOwn(CUSTOM_TEMPLATES, id)) {
      return CUSTOM_TEMPLATES[id];
    }
  }
  throw new Error(
    `Exercice inconnu dans le catalogue WebStrength : "${String(id)}". IDs valides : ${EXERCISE_IDS.join(", ")}`
  );
}
