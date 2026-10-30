type SharedGet = {
  controller: AbortController;
  subscribers: number;
  abortTimer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  promise: Promise<Response>;
};

const pendingGets = new Map<string, SharedGet>();

const requestKey = (input: string | URL, init: RequestInit): string => {
  const headers = Array.from(new Headers(init.headers).entries()).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    String(input), init.credentials ?? "same-origin", init.cache ?? "default", init.mode ?? "cors",
    init.redirect ?? "follow", init.referrerPolicy ?? "", headers
  ]);
};

/** Shares an in-flight idempotent GET across Strict Mode effect replays. */
export const fetchSharedGet = (input: string | URL, init: RequestInit = {}): Promise<Response> => {
  const key = requestKey(input, init);
  let shared = pendingGets.get(key);
  if (!shared) {
    const controller = new AbortController();
    const promise = fetch(input, { ...init, method: "GET", signal: controller.signal });
    const request: SharedGet = { controller, promise, subscribers: 0, abortTimer: null, settled: false };
    shared = request;
    pendingGets.set(key, request);
    void promise.finally(() => {
      request.settled = true;
      if (pendingGets.get(key) === request) pendingGets.delete(key);
    }).catch(() => undefined);
  }
  if (shared.abortTimer) clearTimeout(shared.abortTimer);
  shared.abortTimer = null;
  shared.subscribers += 1;

  return new Promise<Response>((resolve, reject) => {
    let active = true;
    const release = (): void => {
      if (!active || !shared) return;
      active = false;
      init.signal?.removeEventListener("abort", onAbort);
      shared.subscribers -= 1;
      if (shared.subscribers === 0 && !shared.settled && !shared.controller.signal.aborted) {
        shared.abortTimer = setTimeout(() => {
          if (shared?.subscribers === 0 && !shared.settled) shared.controller.abort();
        }, 0);
      }
    };
    const onAbort = (): void => {
      release();
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    if (init.signal?.aborted) {
      onAbort();
      return;
    }
    init.signal?.addEventListener("abort", onAbort, { once: true });
    shared?.promise.then((response) => {
      if (!active) return;
      release();
      resolve(response.clone());
    }, (error: unknown) => {
      if (!active) return;
      release();
      reject(error);
    });
  });
};
