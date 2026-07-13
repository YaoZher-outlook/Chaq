export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms）。`);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
  fetcher: typeof fetch = globalThis.fetch
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternalSignal();
  else externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });

  const timer = timeoutMs > 0
    ? globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : null;

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}
