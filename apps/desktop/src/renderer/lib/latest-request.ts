export type LatestRequestToken = Readonly<{
  generation: number;
  resourceId: string;
  signal: AbortSignal;
}>;

export class SupersededRequestError extends Error {
  constructor() {
    super("The request was superseded by a newer resource request.");
    this.name = "AbortError";
  }
}

export class LatestRequestGate {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): number;
  begin(resourceId: string): LatestRequestToken;
  begin(resourceId?: string): number | LatestRequestToken {
    this.controller?.abort(new SupersededRequestError());
    this.controller = new AbortController();
    this.generation += 1;
    if (resourceId === undefined) return this.generation;
    return {
      generation: this.generation,
      resourceId,
      signal: this.controller.signal
    };
  }

  snapshot(): number {
    return this.generation;
  }

  isCurrent(request: number): boolean;
  isCurrent(request: LatestRequestToken, resourceId?: string): boolean;
  isCurrent(request: number | LatestRequestToken, resourceId?: string): boolean {
    if (typeof request === "number") return request === this.generation;
    return request.generation === this.generation
      && !request.signal.aborted
      && (resourceId === undefined || request.resourceId === resourceId);
  }

  cancel(): void {
    this.controller?.abort(new SupersededRequestError());
    this.controller = null;
    this.generation += 1;
  }

  guard<T>(request: LatestRequestToken, operation: Promise<T>): Promise<T> {
    if (!this.isCurrent(request)) return Promise.reject(abortReason(request.signal));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortReason(request.signal));
      request.signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => {
          request.signal.removeEventListener("abort", onAbort);
          if (this.isCurrent(request)) resolve(value);
          else reject(abortReason(request.signal));
        },
        (error) => {
          request.signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }
}

export function isSupersededRequest(error: unknown): boolean {
  return error instanceof SupersededRequestError
    || (error instanceof Error && error.name === "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new SupersededRequestError();
}
