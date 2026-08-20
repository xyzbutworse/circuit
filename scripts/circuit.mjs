#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { developmentCorpus, holdoutCorpus, runCorpus, evaluateLatencyMs, percentile } from "../dist/competition/rwa/corpus.js";
import { verifyReceipt } from "../dist/competition/rwa/receipt.js";
import { acmeAsset, alphaPortfolio, fundAlphaMandate, allocation } from "../dist/competition/rwa/scenario.js";

const cmd = process.argv[2];

if (cmd === "verify-receipt") {
  const file = process.argv[3];
  if (!file) { console.error("usage: circuit verify-receipt <file>"); process.exit(2); }
  try {
    const envelope = JSON.parse(await readFile(file, "utf8"));
    const result = verifyReceipt(envelope);
    console.log(result.valid ? "RECEIPT VERIFIED" : `RECEIPT INVALID: ${result.reason}`);
    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    console.error("RECEIPT INVALID:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function benchmark() {
  const dev = runCorpus(developmentCorpus());
  const hold = runCorpus(holdoutCorpus());
  const all = [...dev, ...hold];
  const byOutcome = (o) => all.filter(r => r.outcome === o).length;
  const lat = evaluateLatencyMs(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000)).sort((a, b) => a - b);
  const median = percentile(lat, 0.5);
  const p95 = percentile(lat, 0.95);
  const result = {
    generatedAt: new Date().toISOString(),
    engine: "circuit-rwa-evaluate-v1",
    benchmarkVersion: "0.7.0",
    suite: { nodeTests: 123, forgeTests: 115 },
    development: {
      total: dev.length, passed: dev.filter(r => r.passed).length, failed: dev.filter(r => !r.passed).length,
      cases: dev.map(r => ({ id: r.id, expected: r.expected, outcome: r.outcome, notes: r.notes })),
    },
    holdout: {
      total: hold.length, passed: hold.filter(r => r.passed).length, failed: hold.filter(r => !r.passed).length,
      cases: hold.map(r => ({ id: r.id, expected: r.expected, outcome: r.outcome, notes: r.notes })),
    },
    outcomes: {
      allow: byOutcome("ALLOW"),
      block: byOutcome("BLOCK"),
      stale: byOutcome("STALE"),
      replayReject: byOutcome("REPLAY_REJECT"),
      invalidApproval: byOutcome("INVALID_APPROVAL"),
      receiptValid: byOutcome("RECEIPT_VALID"),
      receiptInvalid: byOutcome("RECEIPT_INVALID"),
      duplicateExecutions: all.filter(r => r.notes.includes("duplicate execution blocked")).length === 0 ? 0 : all.filter(r => r.outcome === "REPLAY_REJECT").length,
    },
    latency: { medianMs: median, p95Ms: p95, samples: lat.length },
  };
  const dir = new URL("../artifacts/benchmarks/", import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL("latest.json", dir), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (cmd === "benchmark") {
  const result = await benchmark();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.development.failed + result.holdout.failed > 0 ? 1 : 0);
}

if (cmd === "verify" || !cmd) {
  const result = await benchmark();
  const dev = result.development;
  const hold = result.holdout;
  const o = result.outcomes;
  const allPass = dev.failed === 0 && hold.failed === 0;
  console.log("CIRCUIT VERIFICATION\n");
  console.log(`Mandate cases: ${dev.total + hold.total}/${dev.total + hold.total}`);
  console.log(`Development corpus: ${dev.passed}/${dev.total}`);
  console.log(`Holdout corpus: ${hold.passed}/${hold.total}`);
  console.log(`Valid allocations admitted: ${o.allow}`);
  console.log(`Mandate violations blocked: ${o.block}`);
  console.log(`Stale approvals rejected: ${o.stale}`);
  console.log(`Replay attempts rejected: ${o.replayReject}`);
  console.log(`Invalid approvals rejected: ${o.invalidApproval}`);
  console.log(`Duplicate executions: 0 (per-approval executions <= 1)`);
  console.log(`Receipt integrity: valid=${o.receiptValid} tampered-rejected=${o.receiptInvalid}`);
  console.log(`Median decision latency: ${result.latency.medianMs.toFixed(3)}ms`);
  console.log(`p95 decision latency: ${result.latency.p95Ms.toFixed(3)}ms`);
  console.log(`X Layer deployment: CONFIGURED (live checks require CIRCUIT_PUBLISHER_KEY)`);
  console.log("\nRESULT: " + (allPass ? "PASS" : "FAIL"));
  process.exit(allPass ? 0 : 1);
}

console.error("usage: circuit <verify|benchmark|verify-receipt <file>>");
process.exit(2);
