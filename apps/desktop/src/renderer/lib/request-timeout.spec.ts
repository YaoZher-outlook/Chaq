import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout, RequestTimeoutError } from "./request-timeout";

test("fetchWithTimeout forwards a live signal and returns the response", async () => {
  let forwardedSignal: AbortSignal | null = null;
  const expected = new Response("ok");
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    forwardedSignal = init?.signal ?? null;
    return expected;
  }) as typeof fetch;
  const response = await fetchWithTimeout("https://example.test", {}, 1_000, fetcher);
  assert.equal(response, expected);
  assert.equal((forwardedSignal as AbortSignal | null)?.aborted, false);
});

test("fetchWithTimeout rejects with RequestTimeoutError when its deadline aborts", async () => {
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  await assert.rejects(fetchWithTimeout("https://example.test", {}, 5, fetcher), (error) => {
    assert.equal(error instanceof RequestTimeoutError, true);
    return true;
  });
});

test("fetchWithTimeout preserves caller cancellation instead of reporting a timeout", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by caller");
  controller.abort(reason);
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    throw init?.signal?.reason;
  }) as typeof fetch;
  await assert.rejects(fetchWithTimeout("https://example.test", { signal: controller.signal }, 1_000, fetcher), reason);
});
