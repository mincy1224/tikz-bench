/** One running request and one latest pending patch; all callers still settle. */
export class CoalescingSaveQueue<P extends object, R> {
  private running = false;
  private pending: { patch: P; callers: { resolve: (value: R) => void; reject: (error: unknown) => void }[] } | null = null;
  constructor(private readonly save: (patch: P) => Promise<R>) {}
  get busy(): boolean { return this.running || this.pending !== null; }
  enqueue(patch: P): Promise<R> {
    return new Promise((resolve, reject) => {
      if (this.pending) { this.pending.patch = { ...this.pending.patch, ...patch }; this.pending.callers.push({ resolve, reject }); }
      else this.pending = { patch, callers: [{ resolve, reject }] };
      void this.drain();
    });
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const request = this.pending; this.pending = null;
        try { const saved = await this.save(request.patch); request.callers.forEach((caller) => { caller.resolve(saved); }); }
        catch (error) {
          request.callers.forEach((caller) => { caller.reject(error); });
          const pending = this.pending as typeof request | null;
          this.pending = null;
          pending?.callers.forEach((caller) => { caller.reject(error); });
          break;
        }
      }
    } finally { this.running = false; }
  }
}
