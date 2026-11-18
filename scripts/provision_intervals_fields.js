import { ensureCustomActivityFields } from "../intervalsClient.js";

const apiKey = process.env.INTERVALS_API_KEY;
const athleteId = process.env.INTERVALS_ATHLETE_ID || "0";
const dryRun = process.argv.includes("--dry-run");

const summary = await ensureCustomActivityFields({ athleteId, apiKey, dryRun });
console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) {
  process.exit(1);
}
