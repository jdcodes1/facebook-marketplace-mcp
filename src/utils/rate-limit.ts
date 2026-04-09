export class RateLimiter {
  private maxPerMinute: number;
  private timestamps: number[] = [];

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than 1 minute
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const waitMs = 60_000 - (now - oldest);
      if (waitMs > 0) {
        // Add random jitter (1-3s)
        const jitter = 1000 + Math.random() * 2000;
        await sleep(waitMs + jitter);
      }
    } else {
      // Add small jitter between requests (500ms - 2s)
      const jitter = 500 + Math.random() * 1500;
      if (this.timestamps.length > 0) {
        await sleep(jitter);
      }
    }

    this.timestamps.push(Date.now());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
