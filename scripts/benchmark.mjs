import { createQueryPool } from "../frontend/src/queryPool.ts";
async function run(shared) {
  let requests = 0,
    active = 0,
    peak = 0;
  const provider = async () => {
    requests++;
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return [{ value: 42 }];
  };
  const execute = shared ? createQueryPool(provider) : provider;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 20 }, () =>
      execute("same-query", new AbortController().signal),
    ),
  );
  return {
    requests,
    peak,
    elapsed_ms: Math.round((performance.now() - start) * 10) / 10,
  };
}
console.log(
  JSON.stringify(
    {
      fixture: "20 simultaneous identical queries, simulated 20 ms provider",
      before: await run(false),
      sharedPool: await run(true),
    },
    null,
    2,
  ),
);
