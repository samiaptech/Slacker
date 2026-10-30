import test from "node:test";
import assert from "node:assert/strict";
import { fetchSharedGet } from "../app/fetch-shared-get";

void test("keeps the response body readable after response headers arrive", async (context) => {
  let requestSignal: AbortSignal | undefined;
  context.mock.method(globalThis, "fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        let aborted = false;
        requestSignal?.addEventListener("abort", () => {
          aborted = true;
          controller.error(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        setTimeout(() => {
          if (aborted) return;
          controller.enqueue(new TextEncoder().encode('{"ready":true}'));
          controller.close();
        }, 10);
      }
    })));
  });

  const response = await fetchSharedGet("https://example.test/workspaces");
  assert.deepEqual(await response.json(), { ready: true });
  assert.equal(requestSignal?.aborted, false);
});

void test("aborts an in-flight request after its final subscriber cancels", async (context) => {
  let requestSignal: AbortSignal | undefined;
  context.mock.method(globalThis, "fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  });
  const subscriber = new AbortController();
  const request = fetchSharedGet("https://example.test/cancel", { signal: subscriber.signal });
  subscriber.abort();

  await assert.rejects(request, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestSignal?.aborted, true);
});
