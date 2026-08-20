import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../web/js/proof.js", import.meta.url), "utf8");

test("critical proof claims depend on verifier checks rather than receipt existence", () => {
  assert.match(source, /OPENROUTER_GENERATIONS/);
  assert.match(source, /AI_EVIDENCE_LINKS/);
  assert.match(source, /EVALUATION_CHAIN/);
  assert.match(source, /ONCHAIN_TRANSACTIONS/);
  assert.match(source, /ONCHAIN_READBACK/);
  assert.doesNotMatch(source, /\["Agent cannot bypass the vault",true\]/);
  assert.doesNotMatch(source, /Boolean\(\(receipts\.judgeReceipts/);
});
