/**
 * Cancellation helpers for My board runs (the user pressing Stop).
 * Some data-provider calls can't be cancelled at the bridge, so `raceAbort` stops
 * waiting and drops the late result instead.
 */

/** Error thrown when a run is stopped on purpose; never shown as a failure. */
export function abortError(): Error {
  return Object.assign(new Error("Stopped."), {
    name: "AbortError",
    code: "ABORTED",
  });
}

/** True for user-initiated stops (ours or a `fetch` aborted by its signal). */
export function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: unknown; code?: unknown };
  return err.name === "AbortError" || err.code === "ABORTED";
}

/** Throw `abortError()` when the signal has already fired. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Settle with `promise`, or reject with `abortError()` as soon as `signal`
 * fires. The underlying work keeps running; its result is ignored.
 */
export function raceAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
