import { readFile } from "node:fs/promises";
import { verifyJudgeReceipt } from "../dist/competition/judge-receipt.js";

const file = process.argv[2] || "deployments/live-openrouter-proof.json";
let artifact;
try { artifact = JSON.parse(await readFile(file, "utf8")); }
catch (error) {
  console.error(`Unable to read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const trace = artifact.trace;
if (!trace?.judgeReceipt || !Array.isArray(trace.attempts)) {
  console.error("Artifact does not contain a judge receipt and planning trace.");
  process.exit(1);
}
const result = verifyJudgeReceipt(trace.judgeReceipt, {
  traceId: trace.id,
  attempts: trace.attempts,
  attemptReceipts: trace.attempts.map(attempt => attempt.receipt),
  onchain: trace.onchain,
});
for (const check of result.checks) console.log(`${check.valid ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
console.log(`\nOPENROUTER PROOF VERIFICATION: ${result.valid ? "PASS" : "FAIL"}`);
process.exit(result.valid ? 0 : 1);
