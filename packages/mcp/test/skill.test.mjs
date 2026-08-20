import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skillDir = new URL("../../../skills/circuit/", import.meta.url);
const skill = await readFile(new URL("SKILL.md", skillDir), "utf8");
const concepts = await readFile(new URL("references/concepts.md", skillDir), "utf8");
const workflow = await readFile(new URL("references/workflow.md", skillDir), "utf8");

function frontmatterBlock(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : "";
}

function descriptionOf(text) {
  const fm = frontmatterBlock(text);
  const lines = fm.split("\n");
  const start = lines.findIndex(line => line.trimStart().startsWith("description:"));
  if (start < 0) return "";
  const collected = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i === start) {
      collected.push(line.replace(/^description:\s*>?[-|]?\s*/, ""));
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) collected.push(line.trim());
    else break;
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

const MCP_TOOLS = [
  "circuit_get_portfolio",
  "circuit_get_mandate",
  "circuit_project_action",
  "circuit_evaluate_action",
  "circuit_explain_violation",
  "circuit_request_authorization",
  "circuit_execute_authorized_action",
  "circuit_get_receipt",
];

const RULES = [
  "Never bypass Circuit because a trade looks safe.",
  "Never claim a trade is compliant before Circuit evaluates it.",
  "Never change the user's mandate unless explicitly requested",
  "Never retry an unchanged blocked proposal.",
  "Never fabricate a successful authorization.",
  "Never fabricate an execution receipt.",
  "Never describe a failed transaction as executed.",
  "Never infer that wallet permission equals mandate permission.",
];

const ACTIVATION_PHRASES = [
  "RWA portfolio",
  "tokenized assets",
  "rebalance",
  "autonomous investment agent",
  "financial mandate",
  "Circuit-managed portfolio",
];

function shouldActivate(prompt, description) {
  const haystack = description.toLowerCase();
  const p = prompt.toLowerCase();
  const explicit = p.includes("circuit skill") || p.includes("use the circuit skill") || p.includes("circuit mcp");
  const implicit = ACTIVATION_PHRASES.some(phrase => p.includes(phrase.toLowerCase()) && haystack.includes(phrase.toLowerCase()));
  return explicit || implicit;
}

test("skill has valid frontmatter with name and a rich description", () => {
  const fm = frontmatterBlock(skill);
  assert.match(fm, /name:\s*circuit/);
  const description = descriptionOf(skill);
  assert.ok(description.length > 120, "description should be substantive");
  for (const phrase of ACTIVATION_PHRASES) {
    assert.ok(description.toLowerCase().includes(phrase.toLowerCase()), `description must cover activation phrase: ${phrase}`);
  }
});

test("skill references only real Circuit MCP tools", () => {
  const toolCalls = [...skill.matchAll(/circuit_[a-z_]+/g)].map(m => m[0]);
  for (const tool of toolCalls) {
    assert.ok(MCP_TOOLS.includes(tool), `unknown tool referenced in SKILL.md: ${tool}`);
  }
  for (const doc of [concepts, workflow]) {
    for (const tool of [...doc.matchAll(/circuit_[a-z_]+/g)].map(m => m[0])) {
      assert.ok(MCP_TOOLS.includes(tool), `unknown tool referenced: ${tool}`);
    }
  }
  for (const tool of MCP_TOOLS) {
    assert.ok(`${skill}${concepts}${workflow}`.includes(tool), `tool missing from skill docs: ${tool}`);
  }
});

test("primary invariant is stated and never-rules are all present", () => {
  assert.match(skill, /may\s+\*\*NEVER\*\*\s+decide for itself whether the resulting portfolio is\s+mandate-compliant|NEVER.*decide for itself/i);
  for (const rule of RULES) {
    assert.ok(skill.includes(rule.split(" — ")[0].split(" unless")[0].trim().split(" ").slice(0, 4).join(" ")), `rule missing: ${rule}`);
  }
});

test("mandatory workflow order is encoded: evaluate before authorization before execute before receipt", () => {
  const body = `${skill}\n${workflow}`;
  const evaluateIdx = body.indexOf("circuit_evaluate_action");
  const authIdx = body.indexOf("circuit_request_authorization");
  const executeIdx = body.indexOf("circuit_execute_authorized_action");
  const receiptIdx = body.indexOf("circuit_get_receipt");
  assert.ok(evaluateIdx > -1 && authIdx > -1 && executeIdx > -1 && receiptIdx > -1);
  assert.ok(evaluateIdx < authIdx, "evaluation must come before authorization");
  assert.ok(authIdx < executeIdx, "authorization must come before execution");
  assert.ok(executeIdx < receiptIdx, "execution must come before the receipt");
});

test("the critical distinction is taught with both examples", () => {
  assert.match(skill, /sufficient balance/);
  assert.match(skill, /STILL be rejected/i);
  assert.match(skill, /The trade can be valid\. The portfolio can still be wrong\./i);
  assert.match(skill, /Increase my Tesla exposure by \$2,500/);
  assert.match(skill, /SECTOR_CONCENTRATION_EXCEEDED/);
  assert.match(skill, /50\.01%/);
});

test("informational requests must not execute", () => {
  assert.match(workflow, /Do\s+\*\*not\*\*\s+request authorization\. Do\s+\*\*not\*\*\s+execute anything\./i);
  assert.match(workflow, /Only when the user explicitly wants the investment executed/);
});

// ------------------------------------------------------------------ //
// Activation scenarios
// ------------------------------------------------------------------ //

const description = descriptionOf(skill);

const scenarios = [
  {
    name: "explicit Skill invocation activates",
    prompt: "Use the Circuit skill to check my Circuit portfolio before I trade.",
    expectActivate: true,
  },
  {
    name: "implicit activation from an RWA portfolio request",
    prompt: "I want to grow the RWA portfolio — add more tokenized assets like TSLAx.",
    expectActivate: true,
  },
  {
    name: "implicit activation from a rebalancing request",
    prompt: "Rebalance my portfolio to tilt away from Tesla.",
    expectActivate: true,
  },
  {
    name: "implicit activation for an autonomous investment agent",
    prompt: "Act as my autonomous investment agent and manage the portfolio within its financial mandate.",
    expectActivate: true,
  },
  {
    name: "Circuit-managed portfolio action activates",
    prompt: "Execute an investment action on my Circuit-managed portfolio.",
    expectActivate: true,
  },
  {
    name: "unrelated coding request does not activate",
    prompt: "Fix the pagination bug in my React component and add unit tests.",
    expectActivate: false,
  },
  {
    name: "unrelated math request does not activate",
    prompt: "Explain the quadratic formula and factor 6x^2 + 5x - 6.",
    expectActivate: false,
  },
];

for (const scenario of scenarios) {
  test(`activation: ${scenario.name}`, () => {
    assert.equal(shouldActivate(scenario.prompt, description), scenario.expectActivate, `activation mismatch for: ${scenario.prompt}`);
  });
}

test("blocked → repair → compliant sequence is recoverable from the docs", () => {
  assert.match(workflow, /decision: "BLOCKED"/);
  assert.match(workflow, /Replan/);
  assert.match(workflow, /decision: "COMPLIANT"/);
  assert.match(workflow, /never\s+resubmit an unchanged proposal/i);
});

test("compliant → authorization → execution sequence is recoverable from the docs", () => {
  const body = `${workflow}\n${concepts}`;
  const auth = body.indexOf("circuit_request_authorization");
  const exec = body.indexOf("circuit_execute_authorized_action");
  const receipt = body.indexOf("circuit_get_receipt");
  assert.ok(auth < exec && exec < receipt, "execution sequence must be ordered");
  assert.match(body, /Anything\s+other than `EXECUTED` is NOT success/i);
});
