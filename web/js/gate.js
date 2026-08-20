import { mountNav } from "./shared.js";

mountNav();

const chip = document.getElementById("gate-status-chip");
const esc = (s) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const row = (label, value, cls = "") => `<div class="row"><span>${esc(label)}</span><b class="${cls}">${esc(value)}</b><span class="muted"></span></div>`;

async function run() {
  chip.textContent = "EVALUATING…";
  try {
    const res = await fetch("/api/rwa/demo", { method: "POST" });
    if (!res.ok) throw new Error(`demo failed: ${res.status}`);
    const d = await res.json();
    chip.textContent = "GATE ACTIVE";

    document.getElementById("g-asset-id").textContent = d.asset.assetId;
    document.getElementById("g-debtor").textContent = d.asset.debtor;
    document.getElementById("g-passport").textContent = "PASS-8842";
    document.getElementById("g-yield").textContent = `${d.asset.yieldPct}%`;
    document.getElementById("g-maturity").textContent = `${d.asset.maturityDays} days`;
    document.getElementById("g-collateral").textContent = "1.30x";
    document.getElementById("g-evidence").textContent = d.asset.evidence;
    document.getElementById("g-verified").innerHTML = `<b>${d.asset.status}</b>`;

    document.getElementById("g-blocked").innerHTML = [
      row("DECISION", "BLOCKED", "bad"),
      row("RULE", d.blocked.reasonCodes[0]),
      row("EXPOSURE TODAY", `${d.blocked.observed.currentDebtorExposurePct}% of NAV`),
      row("POST-TRADE EXPOSURE", `${d.blocked.projected.postTradeDebtorExposurePct}% of NAV`, "bad"),
      row("MANDATE MAXIMUM", `${d.blocked.observed.mandateMaxPct}% of NAV`),
      row("CAPITAL MOVED", `$${d.blocked.capitalMovedUsd.toLocaleString()}`),
      row("RECEIPT", d.blocked.receiptHash.slice(0, 20) + "…"),
    ].join("");

    const exec = d.allowed.execution;
    const execLabel = exec.status === "EXECUTED" ? exec.status : `${exec.status}${exec.detail ? `: ${exec.detail}` : ""}`;
    document.getElementById("g-allowed-state").textContent = exec.status === "EXECUTED" ? "EVALUATED + EXECUTED" : `EVALUATED + EXECUTION ${exec.status}`;
    document.getElementById("g-allowed").innerHTML = [
      row("DECISION", "ALLOWED"),
      row("RULE", "ALL RULES SATISFIED"),
      row("POST-TRADE EXPOSURE", `${d.allowed.projected.postTradeDebtorExposurePct}% of NAV`),
      row("APPROVAL", d.allowed.approvalHash.slice(0, 20) + "…"),
      row("APPROVAL EXPIRY", d.allowed.expiry),
      row("CAPITAL MOVED", d.allowed.execution.status === "EXECUTED" ? "$35,000" : "$0", d.allowed.execution.status === "EXECUTED" ? "" : "bad"),
      row("X LAYER EXECUTION", execLabel),
      row("RECEIPT", d.allowed.receiptHash.slice(0, 20) + "…"),
    ].join("");

    const verify = async (hash) => {
      try {
        const r = await fetch(`/api/rwa/receipts/${encodeURIComponent(hash)}`);
        if (!r.ok) return "NOT FOUND";
        const j = await r.json();
        return j.verification.valid ? "VERIFIED" : "TAMPERED";
      } catch { return "UNREACHABLE"; }
    };
    const bv = await verify(d.blocked.receiptHash);
    const av = await verify(d.allowed.receiptHash);
    document.getElementById("g-receipts").innerHTML = [
      row("BLOCK RECEIPT", d.blocked.receiptHash.slice(0, 20) + "…"),
      row("  VERIFICATION", bv, bv === "VERIFIED" ? "" : "bad"),
      row("ALLOW RECEIPT", d.allowed.receiptHash.slice(0, 20) + "…"),
      row("  VERIFICATION", av, av === "VERIFIED" ? "" : "bad"),
      row("BINDING", "STATE + MANDATE HASHES INSIDE RECEIPT"),
    ].join("");
  } catch (e) {
    chip.textContent = "GATE ERROR";
    document.getElementById("g-blocked").innerHTML = row("ERROR", e.message, "bad");
  }
}
run();
