/**
 * Lightweight in-memory rate limiter for API routes.
 *
 * Uses a sliding-window counter per (key) to limit requests.
 * Not suitable for multi-process deployments (use Redis-backed limiter there),
 * but provides meaningful protection in single-process environments.
 */

interface BucketEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Message returned when the limit is exceeded. */
  message?: string;
}

export function createRateLimiter(opts: RateLimitOptions) {
  const { max, windowMs, message = "Too many requests, please try again later." } = opts;
  const buckets = new Map<string, BucketEntry>();

  // Prune stale entries every windowMs to prevent unbounded memory growth
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt < now) buckets.delete(key);
    }
  }, windowMs);
  pruneInterval.unref(); // Don't keep the process alive for this alone

  return function rateLimitMiddleware(
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
      req.socket.remoteAddress ??
      "unknown";

    const now = Date.now();
    let entry = buckets.get(ip);

    if (!entry || entry.resetAt < now) {
      entry = { count: 1, resetAt: now + windowMs };
      buckets.set(ip, entry);
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}
