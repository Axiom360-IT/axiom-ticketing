/**
 * Run `fn` over `items` with at most `limit` in flight, keeping result order.
 *
 * Used for provider sends: Resend and Twilio rate-limit requests per second, and
 * a staff alert reaches ~7 people at once. Firing every send simultaneously
 * invites a rate-limit rejection; a small pool keeps well under it while still
 * finishing in a fraction of a second.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}
