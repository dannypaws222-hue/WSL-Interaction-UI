export interface PollSnapshot<T> {
  data: T | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  isStale: boolean;
}

export interface Observable<T> {
  getSnapshot(): PollSnapshot<T>;
  onUpdate(cb: (snapshot: PollSnapshot<T>) => void): () => void;
}

export interface PollerOptions {
  intervalMs: number;
  backoffMaxMs?: number;
}

export class Poller<T> implements Observable<T> {
  private snapshot: PollSnapshot<T> = { data: null, lastSuccessAt: null, lastError: null, isStale: true };
  private listeners = new Set<(snapshot: PollSnapshot<T>) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private running = false;
  private currentDelay: number;

  constructor(private fetcher: () => Promise<T>, private options: PollerOptions) {
    this.currentDelay = options.intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getSnapshot(): PollSnapshot<T> {
    return this.snapshot;
  }

  onUpdate(cb: (snapshot: PollSnapshot<T>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private scheduleNext(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      if (this.running) this.scheduleNext(this.options.intervalMs);
      return;
    }
    this.inFlight = true;
    try {
      const data = await this.fetcher();
      this.currentDelay = this.options.intervalMs;
      this.snapshot = { data, lastSuccessAt: Date.now(), lastError: null, isStale: false };
    } catch (err) {
      const backoffMax = this.options.backoffMaxMs ?? this.options.intervalMs * 8;
      this.snapshot = {
        ...this.snapshot,
        lastError: err instanceof Error ? err.message : String(err),
        isStale: true,
      };
      this.currentDelay = Math.min(this.currentDelay * 2, backoffMax);
    } finally {
      this.inFlight = false;
      for (const listener of this.listeners) {
        try {
          listener(this.snapshot);
        } catch {
          // A broken subscriber must not stop other subscribers or scheduling.
        }
      }
      if (this.running) this.scheduleNext(this.currentDelay);
    }
  }
}
