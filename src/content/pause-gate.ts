// Lets a long-running scan be paused and resumed from outside.

export class PauseGate {
  private waiters: (() => void)[] = [];
  private isPaused = false;

  get paused(): boolean {
    return this.isPaused;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    for (const wake of this.waiters.splice(0)) wake();
  }

  /** Resolves once the gate is open. Rejects with the abort reason if `signal` fires first. */
  wait(signal?: AbortSignal): Promise<void> {
    if (!this.isPaused) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal?.reason as Error);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }
}
