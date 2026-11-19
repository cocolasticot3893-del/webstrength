/**
 * Utilitaires d'assainissement SVG (fail-closed) et de génération paramétrique hors-ligne.
 * Compatible Navigateur (DOMParser / XMLSerializer) et Node.js (mode sans DOM).
 * Zéro dépendance externe.
 */

const FORBIDDEN_SVG_TAGS = [
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "textarea",
  "button",
  "handler",
  "listener",
  "set",
];

const FORBIDDEN_SVG_TAG_SET = new Set(FORBIDDEN_SVG_TAGS);
const GRAPHIC_PRIMITIVE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

const URL_BEARING_ATTRS = new Set([
  "href",
  "xlink:href",
  "src",
  "action",
  "formaction",
]);

/**
 * Échappe les caractères spéciaux XML pour insertion sûre dans du texte ou des attributs SVG.
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Extrait un bloc `<svg ...>...</svg>` unique depuis une chaîne brute ou un bloc Markdown.
 * Lève une `Error` si absent, vide ou ambigu.
 * @param {unknown} rawSvg
 * @returns {string}
 */
function extractSvgBlock(rawSvg) {
  if (typeof rawSvg !== "string" || !rawSvg.trim()) {
    throw new Error("Contenu SVG vide ou invalide.");
  }

  // Retire d'éventuelles balises de bloc code Markdown (```svg ... ```)
  const unfenced = rawSvg
    .trim()
    .replace(/^```(?:svg|xml|html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const startIdx = unfenced.search(/<svg\b/i);
  if (startIdx === -1) {
    throw new Error("Balise racine <svg> introuvable.");
  }

  const endMatch = /<\/svg\s*>/gi;
  let lastEndIdx = -1;
  let match;
  while ((match = endMatch.exec(unfenced)) !== null) {
    lastEndIdx = match.index + match[0].length;
  }

  if (lastEndIdx === -1 || lastEndIdx <= startIdx) {
    throw new Error("Balise fermante </svg> introuvable.");
  }

  const extracted = unfenced.slice(startIdx, lastEndIdx).trim();
  const openMatches = extracted.match(/<svg\b/gi) ?? [];
  const closeMatches = extracted.match(/<\/svg\s*>/gi) ?? [];
  if (openMatches.length !== 1 || closeMatches.length !== 1) {
    throw new Error("Le SVG doit contenir exactement un élément racine <svg>.");
  }

  return extracted;
}

/**
 * Normalise une valeur d'attribut URL pour détecter les vecteurs obfusqués.
 * @param {string} value
 * @returns {string}
 */
function normalizeUrlAttrValue(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\u0000-\u001F\u007F]+/g, "");
}

/**
 * Indique si une valeur d'attribut URL doit être supprimée.
 * Seules les ancres internes `#...` sont tolérées.
 * @param {string} value
 * @returns {boolean}
 */
function isUnsafeUrlValue(value) {
  const normalized = normalizeUrlAttrValue(value);
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("javascript:") ||
    normalized.includes("vbscript:") ||
    normalized.includes("data:text/html") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("//")
  ) {
    return true;
  }
  return !normalized.startsWith("#");
}

/**
 * Assainit le contenu CSS d'une balise `<style>` SVG.
 * @param {string} cssText
 * @returns {string}
 */
function sanitizeStyleText(cssText) {
  return String(cssText ?? "")
    .replace(/@import\b[^;]*(?:;|$)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/vbscript\s*:/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/behavior\s*:[^;]*(?:;|$)/gi, "")
    .replace(/url\(\s*['"]?\s*(?:https?:|\/\/|data:)[^)]*\)/gi, "none");
}

/**
 * Applique l'assainissement DOM complet sur une racine `<svg>` parsée via `DOMParser`.
 * @param {Document} doc
 * @returns {SVGElement}
 */
function sanitizeParsedSvgDocument(doc) {
  const parserErrors = doc.getElementsByTagName("parsererror");
  if (parserErrors && parserErrors.length > 0) {
    throw new Error("Erreur de parsing XML du SVG.");
  }

  const root = doc.documentElement;
  if (!root || (root.localName ?? root.tagName ?? "").toLowerCase() !== "svg") {
    throw new Error("L'élément racine du document n'est pas <svg>.");
  }

  // Suppression de tous les descendants appartenant à une balise interdite
  const allDescendants = Array.from(root.getElementsByTagName("*"));
  for (const el of allDescendants) {
    const tag = (el.localName ?? el.tagName ?? "").toLowerCase();
    if (FORBIDDEN_SVG_TAG_SET.has(tag)) {
      el.remove();
    }
  }

  // Inspection des attributs et des blocs <style> sur la racine et tous les descendants restants
  const remainingElements = [root, ...Array.from(root.getElementsByTagName("*"))];
  let hasGraphicPrimitive = false;

  for (const el of remainingElements) {
    const tag = (el.localName ?? el.tagName ?? "").toLowerCase();
    if (GRAPHIC_PRIMITIVE_TAGS.has(tag)) {
      hasGraphicPrimitive = true;
    }

    if (tag === "style") {
      el.textContent = sanitizeStyleText(el.textContent ?? "");
    }

    for (const attr of Array.from(el.attributes)) {
      const attrNameLower = (attr.name ?? "").toLowerCase();
      const attrLocalLower = (attr.localName ?? attr.name ?? "").toLowerCase();

      if (/^on/i.test(attrNameLower) || attrLocalLower === "srcdoc") {
        el.removeAttribute(attr.name);
        continue;
      }

      if (URL_BEARING_ATTRS.has(attrNameLower) || attrLocalLower === "href") {
        if (isUnsafeUrlValue(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  if (!hasGraphicPrimitive) {
    throw new Error("Le SVG ne contient aucune primitive graphique valide.");
  }

  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!root.getAttribute("viewBox")) {
    root.setAttribute("viewBox", "0 0 240 220");
  }

  return /** @type {SVGElement} */ (/** @type {unknown} */ (root));
}

/**
 * Assainit un balisage SVG en environnement Node.js (sans DOMParser) en mode fail-closed.
 * @param {string} cleaned
 * @returns {string}
 */
function sanitizeSvgNodeFallback(cleaned) {
  const singleSvgRegex = /^<svg\b[^>]*>[\s\S]*<\/svg\s*>$/i;
  if (!singleSvgRegex.test(cleaned)) {
    throw new Error("Structure <svg>...</svg> invalide.");
  }

  const forbiddenGroup = FORBIDDEN_SVG_TAGS.join("|");
  const pairedForbiddenRegex = new RegExp(
    `<(${forbiddenGroup})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi"
  );
  const selfOrOpenForbiddenRegex = new RegExp(
    `<\\/?(?:${forbiddenGroup})\\b[^>]*\\/?>`,
    "gi"
  );

  // Boucle jusqu'à point fixe pour neutraliser les balises imbriquées reconstruites
  let current = cleaned;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current
      .replace(pairedForbiddenRegex, "")
      .replace(selfOrOpenForbiddenRegex, "");
  }

  // Suppression des attributs événementiels et srcdoc
  current = current
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Filtrage des attributs porteurs d'URL (href, xlink:href, src, action, formaction)
  current = current.replace(
    /\s+((?:xlink:)?href|src|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (fullMatch, _attrName, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? "";
      return isUnsafeUrlValue(val) ? "" : fullMatch;
    }
  );

  // Assainissement des blocs <style>...</style>
  current = current.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_m, openTag, cssBody, closeTag) =>
      `${openTag}${sanitizeStyleText(cssBody)}${closeTag}`
  );

  // Vérification de la présence d'au moins une primitive graphique SVG
  if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon)\b/i.test(current)) {
    throw new Error("Le SVG ne contient aucune primitive graphique valide.");
  }

  // Contrôle final fail-closed
  if (
    /<script\b/i.test(current) ||
    /javascript\s*:/i.test(current) ||
    /\bon[a-z0-9_-]+\s*=/i.test(current)
  ) {
    throw new Error("Balisage SVG rejeté par le contrôle de sécurité final.");
  }

  // Garantie de présence des attributs xmlns et viewBox sur la balise <svg ...>
  current = current.replace(/^<svg\b([^>]*)>/i, (_m, attrs) => {
    let nextAttrs = attrs ?? "";
    if (!/\bxmlns\s*=/i.test(nextAttrs)) {
      nextAttrs += ' xmlns="http://www.w3.org/2000/svg"';
    }
    if (!/\bviewBox\s*=/i.test(nextAttrs)) {
      nextAttrs += ' viewBox="0 0 240 220"';
    }
    return `<svg${nextAttrs}>`;
  });

  return current;
}

/**
 * Extrait et assainit une chaîne SVG (navigateur via DOMParser ou Node.js fail-closed).
 * Lève une `Error` si le SVG est vide, malformé, dangereux ou dépourvu de primitives graphiques.
 * @param {string} rawSvg
 * @returns {string}
 */
export function sanitizeSvgMarkup(rawSvg) {
  const cleaned = extractSvgBlock(rawSvg);

  if (typeof globalThis.DOMParser === "function") {
    const parser = new globalThis.DOMParser();
    const doc = parser.parseFromString(cleaned, "image/svg+xml");
    const root = sanitizeParsedSvgDocument(doc);
    if (typeof globalThis.XMLSerializer === "function") {
      return new globalThis.XMLSerializer().serializeToString(root);
    }
    return root.outerHTML;
  }

  return sanitizeSvgNodeFallback(cleaned);
}

/**
 * Parse, assainit et importe directement un nœud `<svg>` dans le document courant
 * sans jamais repasser par `innerHTML`.
 * @param {string} svgText
 * @returns {SVGElement}
 */
export function sanitizeAndImportSvg(svgText) {
  if (
    typeof globalThis.DOMParser !== "function" ||
    typeof globalThis.document === "undefined"
  ) {
    throw new Error(
      "sanitizeAndImportSvg nécessite un environnement navigateur avec DOMParser et document."
    );
  }

  const cleaned = extractSvgBlock(svgText);
  const parser = new globalThis.DOMParser();
  const doc = parser.parseFromString(cleaned, "image/svg+xml");
  const root = sanitizeParsedSvgDocument(doc);
  return /** @type {SVGElement} */ (globalThis.document.importNode(root, true));
}

/**
 * Nettoie un identifiant d'exercice pour scoper les noms de `@keyframes` CSS.
 * @param {unknown} exerciseId
 * @returns {string}
 */
function scopeKeyframeId(exerciseId) {
  const cleaned = String(exerciseId ?? "USER_EXO")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "USER_EXO";
}

/**
 * Normalise un libellé en supprimant les diacritiques pour la détection de motifs.
 * @param {unknown} text
 * @returns {string}
 */
function stripDiacritics(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Détecte le sous-mode biomécanique pour le pôle `BAND_CORE`.
 * @param {unknown} displayName
 * @returns {"FLOOR_CORE" | "HORIZONTAL_ROW" | "GENERIC"}
 */
function detectBandCoreSubmode(displayName) {
  const normalized = stripDiacritics(displayName);
  const isFloorCore =
    /\b(planche|plank|gainage|hollow|deadbug|abdo|core|bird.?dog|quadrupedie|anti.?rotation)\b/i.test(normalized) &&
    !/\b(elastique|tirage|row|band|pallof)\b/i.test(normalized);
  if (isFloorCore) {
    return "FLOOR_CORE";
  }
  if (/\b(tirage|row|traction|pull)\b/i.test(normalized)) {
    return "HORIZONTAL_ROW";
  }
  return "GENERIC";
}

/**
 * Génère un SVG biomécanique animé paramétrique de repli selon le pôle matériel.
 * Respecte strictement la charte WebStrength (`viewBox="0 0 240 220"`, fond `#0d1117`,
 * gainage `#10b981` et variables CSS `--base-dur`, `--anim-speed`, `--anim-state`).
 * @param {"KBOX" | "DUMBBELL" | "BAND_CORE" | string} pole
 * @param {string} displayName
 * @param {string} [exerciseId="USER_EXO"]
 * @returns {string}
 */
export function buildFallbackParametricSvg(
  pole,
  displayName,
  exerciseId = "USER_EXO"
) {
  const scope = scopeKeyframeId(exerciseId);
  const safeLabel = escapeXml(
    String(displayName ?? "Exercice").trim().slice(0, 34)
  );
  const normalizedPole = String(pole ?? "DUMBBELL").toUpperCase();

  if (normalizedPole === "KBOX") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" role="img" aria-label="${safeLabel} sur kBox">
  <style>
    .${scope}_fly {
      --base-dur: 1.6s;
      transform-origin: 120px 179px;
      animation: ${scope}_rot calc(var(--base-dur, 3s) / var(--anim-speed, 1)) linear infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_body {
      --base-dur: 3.4s;
      transform-origin: 120px 158px;
      animation: ${scope}_squat calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_strap {
      --base-dur: 3.4s;
      transform-origin: 120px 172px;
      animation: ${scope}_strap calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_ecc {
      --base-dur: 3.4s;
      animation: ${scope}_pulse calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    @keyframes ${scope}_rot {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes ${scope}_squat {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(22px); }
    }
    @keyframes ${scope}_strap {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(0.68); }
    }
    @keyframes ${scope}_pulse {
      0%, 25%, 75%, 100% { opacity: 0.2; }
      45%, 60% { opacity: 0.95; }
    }
  </style>
  <rect width="240" height="220" rx="14" fill="#0d1117"/>
  <line x1="20" y1="190" x2="220" y2="190" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <text x="120" y="22" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="9.5" font-weight="600">${safeLabel}</text>
  <rect x="64" y="172" width="112" height="16" rx="4" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
  <circle cx="120" cy="179" r="9" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
  <g class="${scope}_fly">
    <line x1="120" y1="171" x2="120" y2="187" stroke="#22d3ee" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="112" y1="179" x2="128" y2="179" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <g class="${scope}_ecc">
    <rect x="76" y="128" width="88" height="30" rx="6" fill="#ef4444" fill-opacity="0.16" stroke="#ef4444" stroke-width="1" stroke-dasharray="4 3"/>
    <path d="M48 124 L48 152 M43 146 L48 153 L53 146" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <path d="M192 144 L192 94 M187 101 L192 93 L197 101" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <line class="${scope}_strap" x1="120" y1="172" x2="120" y2="104" stroke="#38bdf8" stroke-width="2.8" stroke-dasharray="5 3" stroke-linecap="round"/>
  <g class="${scope}_body">
    <line x1="106" y1="170" x2="112" y2="128" stroke="#94a3b8" stroke-width="5.5" stroke-linecap="round"/>
    <line x1="134" y1="170" x2="128" y2="128" stroke="#94a3b8" stroke-width="5.5" stroke-linecap="round"/>
    <line x1="112" y1="128" x2="128" y2="128" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/>
    <line x1="120" y1="128" x2="120" y2="74" stroke="#10b981" stroke-width="6" stroke-linecap="round"/>
    <circle cx="120" cy="56" r="10" fill="#cbd5e1"/>
    <circle cx="120" cy="128" r="3.5" fill="#22d3ee"/>
    <circle cx="120" cy="78" r="3.2" fill="#22d3ee"/>
  </g>
  <text x="120" y="208" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="8.5" font-weight="600">kBox Isoinertiel • Freinage excentrique</text>
</svg>`;
  }

  if (normalizedPole === "BAND_CORE") {
    const submode = detectBandCoreSubmode(displayName);

    if (submode === "FLOOR_CORE") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" role="img" aria-label="${safeLabel} gainage au sol">
  <style>
    .${scope}_plank {
      --base-dur: 3.6s;
      animation: ${scope}_brace calc(var(--base-dur, 3.6s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_spine {
      --base-dur: 3.6s;
      animation: ${scope}_lumbar calc(var(--base-dur, 3.6s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_sag {
      --base-dur: 3.6s;
      animation: ${scope}_lift calc(var(--base-dur, 3.6s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    @keyframes ${scope}_brace {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-1.5px); }
    }
    @keyframes ${scope}_lumbar {
      0%, 100% { opacity: 0.72; }
      50% { opacity: 1; }
    }
    @keyframes ${scope}_lift {
      0%, 100% { transform: translateY(2px); opacity: 0.45; }
      50% { transform: translateY(-2px); opacity: 1; }
    }
  </style>
  <rect width="240" height="220" rx="14" fill="#0d1117"/>
  <line x1="20" y1="170" x2="220" y2="170" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <rect x="28" y="162" width="184" height="6" rx="3" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <text x="120" y="22" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="9.5" font-weight="600">${safeLabel}</text>
  <g class="${scope}_sag" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M122 157 L122 146 M119 150 L122 145 L125 150"/>
    <path d="M138 157 L138 146 M135 150 L138 145 L141 150"/>
  </g>
  <path d="M46 160 L68 160 L68 128" fill="none" stroke="#94a3b8" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M193 144 L193 160 L201 160" fill="none" stroke="#cbd5e1" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <g class="${scope}_plank">
    <line x1="133" y1="136" x2="193" y2="144" stroke="#cbd5e1" stroke-width="5.5" stroke-linecap="round"/>
    <line class="${scope}_spine" x1="68" y1="128" x2="133" y2="136" stroke="#10b981" stroke-width="5.5" stroke-linecap="round"/>
    <circle cx="46" cy="123" r="9.5" fill="#cbd5e1"/>
    <circle cx="68" cy="128" r="3.5" fill="#22d3ee"/>
    <circle cx="133" cy="136" r="3.5" fill="#22d3ee"/>
  </g>
  <text x="120" y="208" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="8.5" font-weight="600">Transverse engagé • Bassin neutre</text>
</svg>`;
    }

    if (submode === "HORIZONTAL_ROW") {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" role="img" aria-label="${safeLabel} tirage horizontal à l'élastique">
  <style>
    .${scope}_band {
      --base-dur: 3.2s;
      transform-origin: 24px 104px;
      animation: ${scope}_stretch calc(var(--base-dur, 3.2s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_upper {
      --base-dur: 3.2s;
      transform-origin: 152px 74px;
      animation: ${scope}_pull calc(var(--base-dur, 3.2s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_forearm {
      --base-dur: 3.2s;
      transform-origin: 120px 92px;
      animation: ${scope}_elbow calc(var(--base-dur, 3.2s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_scap {
      --base-dur: 3.2s;
      animation: ${scope}_retract calc(var(--base-dur, 3.2s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    @keyframes ${scope}_stretch {
      0%, 100% { transform: rotate(0deg) scaleX(1); }
      21%, 79% { transform: rotate(8.3deg) scaleX(1.39); }
      42%, 58% { transform: rotate(-0.5deg) scaleX(1.83); }
    }
    @keyframes ${scope}_pull {
      0%, 100% { transform: rotate(0deg); }
      42%, 58% { transform: rotate(-103.5deg); }
    }
    @keyframes ${scope}_elbow {
      0%, 100% { transform: rotate(0deg); }
      42%, 58% { transform: rotate(121.7deg); }
    }
    @keyframes ${scope}_retract {
      0%, 20%, 80%, 100% { opacity: 0.25; }
      42%, 58% { opacity: 1; }
    }
  </style>
  <rect width="240" height="220" rx="14" fill="#0d1117"/>
  <line x1="16" y1="192" x2="224" y2="192" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <rect x="16" y="42" width="8" height="150" rx="3" fill="#1e293b" stroke="#475569" stroke-width="1.5"/>
  <circle cx="24" cy="104" r="4" fill="#f59e0b"/>
  <text x="120" y="22" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="9.5" font-weight="600">${safeLabel}</text>
  <line class="${scope}_band" x1="24" y1="104" x2="90" y2="104" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  <line x1="148" y1="122" x2="132" y2="190" stroke="#94a3b8" stroke-width="5" stroke-linecap="round"/>
  <line x1="158" y1="122" x2="174" y2="190" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>
  <line x1="154" y1="122" x2="154" y2="70" stroke="#10b981" stroke-width="5.5" stroke-linecap="round"/>
  <circle cx="152" cy="48" r="10" fill="#cbd5e1"/>
  <g class="${scope}_upper">
    <line x1="152" y1="74" x2="120" y2="92" stroke="#cbd5e1" stroke-width="4.8" stroke-linecap="round"/>
    <g class="${scope}_forearm">
      <line x1="120" y1="92" x2="90" y2="104" stroke="#e2e8f0" stroke-width="4.2" stroke-linecap="round"/>
      <circle cx="90" cy="104" r="3.5" fill="#22d3ee"/>
    </g>
    <circle cx="120" cy="92" r="3.5" fill="#22d3ee"/>
  </g>
  <circle cx="152" cy="74" r="3.8" fill="#22d3ee"/>
  <path class="${scope}_scap" d="M174 74 L194 74 M188 69 L195 74 L188 79" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="120" y="208" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="8.5" font-weight="600">Omoplates serrées • Coudes bas</text>
</svg>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" role="img" aria-label="${safeLabel} gainage et élastique">
  <style>
    .${scope}_band {
      --base-dur: 3.2s;
      transform-origin: 36px 118px;
      animation: ${scope}_tens calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_spine {
      --base-dur: 3.2s;
      animation: ${scope}_lumbar calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    @keyframes ${scope}_tens {
      0%, 100% { transform: scaleX(0.95); opacity: 0.75; }
      50% { transform: scaleX(1.06); opacity: 1; }
    }
    @keyframes ${scope}_lumbar {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
  </style>
  <rect width="240" height="220" rx="14" fill="#0d1117"/>
  <line x1="20" y1="186" x2="220" y2="186" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <rect x="44" y="178" width="160" height="6" rx="3" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <rect x="28" y="76" width="8" height="106" rx="3" fill="#1e293b" stroke="#475569" stroke-width="1.5"/>
  <circle cx="36" cy="118" r="4" fill="#f59e0b"/>
  <text x="120" y="22" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="9.5" font-weight="600">${safeLabel}</text>
  <line class="${scope}_band" x1="36" y1="118" x2="112" y2="118" stroke="#f59e0b" stroke-width="3.2" stroke-dasharray="5 3" stroke-linecap="round"/>
  <line x1="88" y1="176" x2="88" y2="122" stroke="#cbd5e1" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="88" y1="122" x2="178" y2="146" stroke="#94a3b8" stroke-width="5.5" stroke-linecap="round"/>
  <line class="${scope}_spine" x1="90" y1="120" x2="142" y2="134" stroke="#10b981" stroke-width="5.5" stroke-linecap="round"/>
  <circle cx="72" cy="112" r="9.5" fill="#cbd5e1"/>
  <circle cx="88" cy="122" r="3.5" fill="#22d3ee"/>
  <circle cx="142" cy="134" r="3.5" fill="#22d3ee"/>
  <text x="120" y="208" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="8.5" font-weight="600">Rachis neutre • Tension continue</text>
</svg>`;
  }

  // Pôle DUMBBELL (par défaut)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 220" role="img" aria-label="${safeLabel} aux haltères">
  <style>
    .${scope}_arm {
      --base-dur: 3.6s;
      transform-origin: 120px 84px;
      animation: ${scope}_lift calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    .${scope}_tempo {
      --base-dur: 3.6s;
      animation: ${scope}_tempo_fade calc(var(--base-dur, 3s) / var(--anim-speed, 1)) ease-in-out infinite;
      animation-play-state: var(--anim-state, running);
    }
    @keyframes ${scope}_lift {
      0%, 100% { transform: translateY(0px); }
      45%, 55% { transform: translateY(-20px); }
    }
    @keyframes ${scope}_tempo_fade {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }
  </style>
  <rect width="240" height="220" rx="14" fill="#0d1117"/>
  <line x1="20" y1="186" x2="220" y2="186" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>
  <text x="120" y="22" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="9.5" font-weight="600">${safeLabel}</text>
  <line x1="106" y1="184" x2="112" y2="132" stroke="#94a3b8" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="134" y1="184" x2="128" y2="132" stroke="#94a3b8" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="120" y1="132" x2="120" y2="78" stroke="#10b981" stroke-width="6" stroke-linecap="round"/>
  <circle cx="120" cy="58" r="10" fill="#cbd5e1"/>
  <g class="${scope}_arm">
    <line x1="102" y1="84" x2="94" y2="126" stroke="#e2e8f0" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="138" y1="84" x2="146" y2="126" stroke="#e2e8f0" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="84" y="124" width="20" height="7" rx="2" fill="#64748b" stroke="#e2e8f0" stroke-width="1.2"/>
    <rect x="136" y="124" width="20" height="7" rx="2" fill="#64748b" stroke="#e2e8f0" stroke-width="1.2"/>
  </g>
  <path class="${scope}_tempo" d="M186 146 L186 94 M181 101 L186 93 L191 101" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="120" cy="132" r="3.5" fill="#22d3ee"/>
  <circle cx="120" cy="82" r="3.5" fill="#22d3ee"/>
  <text x="120" y="208" text-anchor="middle" fill="#10b981" font-family="system-ui,sans-serif" font-size="8.5" font-weight="600">Contrôle excentrique lent • Posture neutre</text>
</svg>`;
}

/**
 * Construit un guide pédagogique et un SVG paramétrique de repli hors-ligne pour un exercice.
 * @param {object} params
 * @param {string} params.name
 * @param {"KBOX" | "DUMBBELL" | "BAND_CORE" | string} params.pole
 * @param {boolean} [params.isTimed=false]
 * @param {string} [params.exerciseId="USER_EXO"]
 * @returns {{ short_desc: string, guide: { tempo_badge: string, setup: string, execution: [string, string, string], errors: [string, string, string], svg_inline: string }, svg_inline: string }}
 */
export function buildFallbackExerciseGuide({
  name,
  pole,
  isTimed = false,
  exerciseId = "USER_EXO",
}) {
  const cleanName = String(name ?? "Exercice personnalisé").trim() || "Exercice personnalisé";
  const normalizedPole = String(pole ?? "DUMBBELL").toUpperCase();
  const svgInline = buildFallbackParametricSvg(
    normalizedPole,
    cleanName,
    exerciseId
  );

  if (normalizedPole === "KBOX") {
    const tempoBadge = isTimed
      ? "Isoinertiel maintenu • Contrôle continu"
      : "Isoinertiel kBox • Freinage 3.0s/rep";
    return {
      short_desc: `${cleanName} — surcharge excentrique contrôlée sur volant d'inertie kBox.`,
      guide: {
        tempo_badge: tempoBadge,
        setup:
          "Ancre les pieds au centre du plateau kBox, règle la sangle sans jeu excessif en position haute et verrouille le gainage abdominal.",
        execution: [
          "Amorce par 2 répétitions progressives afin de lancer le volant d'inertie dans l'axe.",
          "Accélère de façon fluide sur la phase concentrique tout en gardant le rachis lombaire neutre.",
          "Freine activement le retour excentrique sur le dernier tiers d'amplitude sans rebond articulaire.",
        ],
        errors: [
          "Laisser le bas du dos s'arrondir sous la traction de la sangle kBox.",
          "Couper la phase de freinage excentrique ou relâcher la tension en bas du mouvement.",
          "Décoller les talons ou perdre l'alignement genou-cheville pendant la répétition.",
        ],
        svg_inline: svgInline,
      },
      svg_inline: svgInline,
    };
  }

  if (normalizedPole === "BAND_CORE") {
    const submode = detectBandCoreSubmode(cleanName);

    if (submode === "FLOOR_CORE") {
      const tempoBadge = isTimed
        ? "Tapis / PDC • Maintien strict"
        : "Gainage dynamique • Contrôle lent";
      return {
        short_desc: `${cleanName} — gainage profond au sol, stabilité lombo-pelvienne et contrôle du transverse.`,
        guide: {
          tempo_badge: tempoBadge,
          setup:
            "Installe les appuis au sol dans l'alignement des épaules, aspire le nombril pour engager le transverse et place le bassin en rétroversion neutre.",
          execution: [
            isTimed
              ? "Maintiens l'alignement oreille-épaule-hanche-cheville tout en conservant une respiration diaphragmatique régulière."
              : "Exécute chaque répétition avec lenteur et contrôle en maintenant les côtes abaissées vers le bassin.",
            "Repousse activement le sol avec les avant-bras ou les appuis pour stabiliser la ceinture scapulaire.",
            "Conserve la tension abdominale profonde sans relâcher la sangle lombaire jusqu'à la fin de la série.",
          ],
          errors: [
            "Laisser le bassin s'affaisser vers le tapis et cambrer les lombaires (hyperlordose L4-L5).",
            "Monter les fesses trop haut en toit ou laisser les omoplates se pincer entre les épaules.",
            "Bloquer la respiration en apnée prolongée au lieu de gainer sur une expiration contrôlée.",
          ],
          svg_inline: svgInline,
        },
        svg_inline: svgInline,
      };
    }

    if (submode === "HORIZONTAL_ROW") {
      const tempoBadge = isTimed
        ? "Élastique • Maintien rétraction"
        : "Élastique • Tempo 2-1-2";
      return {
        short_desc: `${cleanName} — tirage horizontal à l'élastique axé sur la rétraction scapulaire et le verrouillage du buste.`,
        guide: {
          tempo_badge: tempoBadge,
          setup:
            "Ancre l'élastique à hauteur du sternum ou des côtes basses, place-toi en fente athlétique stable face au point d'attache et abaisse les épaules.",
          execution: [
            "Amorce le tirage en resserrant d'abord les omoplates vers la colonne vertébrale avant de fléchir les coudes.",
            "Tire les coudes bas le long des côtes en gardant le buste strictement verrouillé sans balancement.",
            "Marque une pause d'1 seconde en rétraction scapulaire maximale puis freine lentement le retour.",
          ],
          errors: [
            "Hausser les épaules vers les oreilles et surcharger les trapèzes supérieurs.",
            "Écarter les coudes à l'horizontale au lieu de les garder bas près du buste.",
            "Donner un à-coup lombaire vers l'arrière en fin de tirage ou relâcher brusquement l'élastique.",
          ],
          svg_inline: svgInline,
        },
        svg_inline: svgInline,
      };
    }

    const tempoBadge = isTimed
      ? "Gainage / Élastique • Maintien strict"
      : "Élastique / PDC • Tempo 2-1-2";
    return {
      short_desc: `${cleanName} — stabilité lombo-pelvienne et contrôle sous tension élastique.`,
      guide: {
        tempo_badge: tempoBadge,
        setup:
          "Place l'élastique ou les appuis dans l'axe cible, engage le transverse et stabilise le bassin en position neutre.",
        execution: [
          isTimed
            ? "Maintiens une respiration diaphragmatique régulière sans bloquer la glotte."
            : "Exécute la phase active avec fluidité sans élan ni compensation du tronc.",
          "Conserve les côtes abaissées et la ceinture pelvienne parfaitement verrouillée.",
          "Relâche lentement en gardant la tension jusqu'au retour complet à la position initiale.",
        ],
        errors: [
          "Cambrer excessivement les lombaires (hyperlordose L4-L5) sous la fatigue.",
          "Laisser les épaules monter vers les oreilles ou vriller le buste.",
          "Accélérer le retour en laissant l'élastique tirer brusquement l'articulation.",
        ],
        svg_inline: svgInline,
      },
      svg_inline: svgInline,
    };
  }

  // Pôle DUMBBELL par défaut
  const tempoBadge = isTimed
    ? "Haltères / Isométrie • Posture neutre"
    : "Haltères • Tempo 3-1-1";
  return {
    short_desc: `${cleanName} — contrôle mécanique aux haltères avec freinage excentrique strict.`,
    guide: {
      tempo_badge: tempoBadge,
      setup:
        "Saisis les haltères en prise ferme, stabilise les omoplates vers le bas et aligne la colonne vertébrale avant de démarrer.",
      execution: [
        isTimed
          ? "Stabilise la charge dans l'axe défini pendant toute la durée cible sans balancement."
          : "Développe ou tire la charge de manière explosive et contrôlée sans à-coup lombaire.",
        "Marque un temps d'arrêt net de 1 seconde en fin de course pour supprimer l'élan.",
        "Freine la phase excentrique sur 3 secondes complètes jusqu'à la position de départ.",
      ],
      errors: [
        "Compenser la charge par un balancement du tronc ou une extension lombaire.",
        "Relâcher la phase négative trop rapidement sans contrôle excentrique.",
        "Perdre l'alignement articulaire des poignets, coudes ou genoux sous tension.",
      ],
      svg_inline: svgInline,
    },
    svg_inline: svgInline,
  };
}
