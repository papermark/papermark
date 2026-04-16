/**
 * Minimal concurrency-limited map without an external dependency.
 *
 * Runs `mapper` over `items` with at most `concurrency` in-flight at a time.
 * Preserves input order in the output array.
 */
export async function pMap<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  { concurrency = 5 }: { concurrency?: number } = {},
): Promise<R[]> {
  if (concurrency < 1) throw new Error("concurrency must be >= 1");
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        results[i] = await mapper(items[i]!, i);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
