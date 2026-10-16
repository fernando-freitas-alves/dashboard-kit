/** Explicit domain order wins; unlisted categories retain the reference volume ranking. */
export function orderedSeries(
  totals: Map<string, number>,
  order?: string[],
): string[] {
  const rank = new Map((order || []).map((key, index) => [key, index]));
  return [...totals.keys()].sort((a, b) => {
    const left = rank.get(a),
      right = rank.get(b);
    if (left !== undefined || right !== undefined)
      return (left ?? Infinity) - (right ?? Infinity);
    return (totals.get(b) || 0) - (totals.get(a) || 0);
  });
}
