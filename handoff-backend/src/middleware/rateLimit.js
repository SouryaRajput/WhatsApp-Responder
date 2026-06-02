const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = "global" } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    const bucket = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (bucket.length >= max) {
      return res.status(429).json({ error: "Too many requests" });
    }
    bucket.push(now);
    buckets.set(key, bucket);
    next();
  };
}

module.exports = { rateLimit };
