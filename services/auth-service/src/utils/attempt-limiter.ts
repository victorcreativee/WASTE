/**
 * Fixed-window attempt counter for brute-force protection on public endpoints.
 * In-memory: limits apply per service instance, which matches the current single-instance deployment.
 */
export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50000,
    private readonly now: () => number = Date.now
  ) {}

  /** Records an attempt. Returns the seconds to wait when the key is over its limit, otherwise 0. */
  hit(key: string): number {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    entry.count++;
    return entry.count > this.maxAttempts ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
  }

  reset(key: string) {
    this.entries.delete(key);
  }

  private prune(now: number) {
    if (this.entries.size < this.maxKeys) return;
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
    // Still full of live keys (flood): drop the oldest to bound memory.
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
