/** Scope-local single-flight queries. Cancellation is per subscriber. Results are
 * never cached after settlement; refreshes always reach the authorized adapter.
 */
export function createQueryPool<T>(
  execute: (query: string, signal: AbortSignal) => Promise<T>,
  limit = 4,
) {
  if (!Number.isInteger(limit) || limit < 1)
    throw Error("Query concurrency must be positive.");
  type Job = {
    controller: AbortController;
    users: number;
    promise: Promise<T>;
    start: () => void;
  };
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let active = 0;
  const pump = () => {
    while (active < limit && queue.length) {
      const job = queue.shift()!;
      active++;
      job.start();
    }
  };
  return (query: string, signal: AbortSignal): Promise<T> => {
    if (signal.aborted)
      return Promise.reject(new DOMException("Cancelled", "AbortError"));
    let job = jobs.get(query);
    if (!job) {
      const controller = new AbortController();
      let resolve!: (value: T) => void, reject!: (error: unknown) => void;
      const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      job = {
        controller,
        users: 0,
        promise,
        start: () => {
          Promise.resolve()
            .then(() => {
              if (controller.signal.aborted)
                throw new DOMException("Cancelled", "AbortError");
              return execute(query, controller.signal);
            })
            .then(resolve, reject)
            .finally(() => {
              if (jobs.get(query) === job) jobs.delete(query);
              active--;
              pump();
            });
        },
      };
      jobs.set(query, job);
      queue.push(job);
      pump();
    }
    const shared = job;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (error: unknown, value?: T) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", abort);
        shared.users--;
        if (!shared.users) {
          if (jobs.get(query) === shared) jobs.delete(query);
          shared.controller.abort();
        }
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () => finish(new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
    });
  };
}
