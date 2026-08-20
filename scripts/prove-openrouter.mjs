const baseUrl = (process.env.CIRCUIT_BASE_URL || "http://127.0.0.1:4184").replace(/\/$/, "");
if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
  console.error("OPENROUTER_API_KEY and OPENROUTER_MODEL are required. No live proof was attempted.");
  process.exit(2);
}

const objective = process.env.CIRCUIT_PROOF_OBJECTIVE || "Deploy up to $4,500 of available cash into tokenized US equities. Favor TSLAx, then diversify across GOOGLx and MSTRx.";
const runToken = `openrouter-proof-${Date.now()}`;
let response;
try {
  response = await fetch(`${baseUrl}/api/circuit/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "live", objective, runToken }),
    signal: AbortSignal.timeout(240_000),
  });
} catch (error) {
  console.error(`Circuit server request failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Start the server at ${baseUrl} with npm run dev, then retry.`);
  process.exit(2);
}
const body = await response.json().catch(() => ({}));
const trace = body.trace;
if (!response.ok || !trace) {
  console.error(body.error || `Circuit returned HTTP ${response.status}.`);
  process.exit(1);
}

const failedChecks = trace.proofVerification?.checks?.filter(check => !check.valid) ?? [];
if (trace.status !== "AUTHORIZED" || !trace.committed || !trace.judgeReceipt || trace.proofVerification?.valid !== true) {
  console.error(`OpenRouter proof failed closed: status=${trace.status}, committed=${Boolean(trace.committed)}.`);
  if (trace.errorCode || trace.errorMessage) console.error(`${trace.errorCode || "ERROR"}: ${trace.errorMessage || ""}`);
  for (const check of failedChecks) console.error(`${check.id}: ${check.detail}`);
  process.exit(1);
}

console.log("OPENROUTER PROOF: PASS");
console.log(`Trace: ${trace.id}`);
for (const attempt of trace.attempts) {
  console.log(`Attempt ${attempt.attempt}: ${attempt.plan.provenance.generationId} | ${attempt.plan.model} | ${attempt.decision.verdict}`);
}
console.log(`Receipt: ${trace.judgeReceipt.receiptHash}`);
console.log(`Transactions: ${trace.onchain.trades.map(trade => trade.txHash).join(", ")}`);
console.log("Artifact: deployments/live-openrouter-proof.json");
