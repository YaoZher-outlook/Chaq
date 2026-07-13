function assertDemoSeedAllowed(env = process.env) {
  const mode = String(env.NODE_ENV || "").trim().toLowerCase();
  if (mode === "production") {
    throw new Error("Refusing to seed demo data while NODE_ENV=production. Run migrations only in production.");
  }
  if (String(env.CHAQ_ALLOW_DEMO_SEED || "").trim() !== "1") {
    throw new Error("Demo seed is disabled by default. Set CHAQ_ALLOW_DEMO_SEED=1 explicitly for local development only.");
  }
}

module.exports = { assertDemoSeedAllowed };
