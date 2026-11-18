const API_KEY = process.env.INTERVALS_API_KEY;
const ATHLETE_ID = process.env.INTERVALS_ATHLETE_ID || "0";

if (!API_KEY) {
  console.error("ERREUR: Variable INTERVALS_API_KEY absente.");
  process.exit(1);
}

const authHeader = "Basic " + Buffer.from(`API_KEY:${API_KEY}`).toString("base64");
const endpoint = `https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/custom-item`;

const fieldsToCreate = [
  {
    type: "ACTIVITY_FIELD",
    code: "Eccentric_Strain_Index",
    name: "Eccentric Strain Index",
    units: "AU",
    content: { type: "NUMBER" }
  },
  {
    type: "ACTIVITY_FIELD",
    code: "PPG_Effective_TUT",
    name: "PPG Effective TUT",
    units: "s",
    content: { type: "NUMBER" }
  },
  {
    type: "ACTIVITY_FIELD",
    code: "Strength_Compliance_Pct",
    name: "Strength Compliance Pct",
    units: "%",
    content: { type: "NUMBER" }
  }
];

async function provision() {
  const listRes = await fetch(endpoint, {
    headers: { "Authorization": authHeader }
  });
  if (!listRes.ok) {
    throw new Error(`Erreur GET custom-item (${listRes.status}): ${await listRes.text()}`);
  }
  const existing = await listRes.json();
  const existingCodes = new Set(existing.map((item) => item.code || item.name));

  for (const field of fieldsToCreate) {
    if (existingCodes.has(field.code) || existingCodes.has(field.name)) {
      console.log(`[SKIP] Champ '${field.code}' déjà présent.`);
      continue;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(field)
    });
    const bodyText = await res.text();
    if (res.ok) {
      console.log(`[OK] Champ '${field.code}' créé : ${bodyText}`);
    } else {
      console.error(`[ERR] Champ '${field.code}' -> HTTP ${res.status}: ${bodyText}`);
    }
  }
}

provision().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
