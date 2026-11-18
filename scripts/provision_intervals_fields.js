import fetch from "node-fetch";

const API_KEY = process.env.INTERVALS_API_KEY;
const ATHLETE_ID = process.env.INTERVALS_ATHLETE_ID || "i1";

if (!API_KEY) {
  console.error("ERREUR: Variable INTERVALS_API_KEY absente.");
  process.exit(1);
}

const fieldsToCreate = [
  { code: "Eccentric_Strain_Index", name: "Eccentric Strain Index", type: "Number", units: "AU" },
  { code: "PPG_Effective_TUT", name: "PPG Effective TUT", type: "Number", units: "s" },
  { code: "Strength_Compliance_Pct", name: "Strength Compliance Pct", type: "Number", units: "%" }
];

const authHeader = "Basic " + Buffer.from("API_KEY:" + API_KEY).toString("base64");

async function provision() {
  console.log("Provisioning des Custom Activity Fields sur Intervals.icu...");
  for (const f of fieldsToCreate) {
    const url = `https://intervals.icu/api/v1/athlete/${ATHLETE_ID}/custom-item`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(f)
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`[OK] Champ '${f.code}' créé ou mis à jour.`);
    } else {
      console.log(`[INFO/ERR] Champ '${f.code}' -> Status ${res.status}: ${text}`);
    }
  }
}

provision();
