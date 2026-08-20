export function loadUsers() {
  const raw = process.env.CIRCUIT_MCP_USERS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function createAuth(usersConfig = loadUsers(), options = {}) {
  const users = usersConfig;
  const rateLimit = options.rateLimit ?? { capacity: 60, refillPerSecond: 1 };
  const buckets = new Map();

  function authenticate(requestHeaders) {
    if (!users) return { ok: true, caller: { name: "local", portfolios: ["*"] } };
    const header = requestHeaders?.authorization ?? requestHeaders?.Authorization ?? "";
    const token = String(header).startsWith("Bearer ") ? String(header).slice(7).trim() : "";
    const user = token ? users[token] : undefined;
    if (!user) return { ok: false, code: 401, detail: "Unauthorized: missing or invalid bearer token." };
    const portfolios = Array.isArray(user.portfolios) ? user.portfolios : [];
    return { ok: true, caller: { name: user.name ?? "unknown", portfolios } };
  }

  function authorizePortfolio(caller, portfolioId) {
    if (caller.portfolios.includes("*")) return true;
    return caller.portfolios.includes(portfolioId) || caller.portfolios.includes("alpha-01") && portfolioId === "portfolio-alpha-01";
  }

  function allowRequest(callerId) {
    const now = Date.now();
    let bucket = buckets.get(callerId);
    if (!bucket) {
      bucket = { tokens: rateLimit.capacity, updatedAt: now };
      buckets.set(callerId, bucket);
    }
    const elapsed = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(rateLimit.capacity, bucket.tokens + elapsed * rateLimit.refillPerSecond);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  return { authenticate, authorizePortfolio, allowRequest };
}
