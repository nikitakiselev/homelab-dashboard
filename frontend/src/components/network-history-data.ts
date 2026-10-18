import type { Point } from "../lib";

export function networkHistoryRows(
  records: Record<string, Point[]>,
  ids: string[],
  step: number,
) {
  const buckets = new Set<number>();
  const samples = ids.map((id) => {
    const points = [...(records[id] || [])].sort((a, b) => a.bucket - b.bucket);
    points.forEach((point, index) => {
      buckets.add(point.bucket);
      const next = points[index + 1];
      if (next && next.bucket - point.bucket > step * 1.5) {
        buckets.add(point.bucket + step);
      }
    });
    return new Map(points.map((point) => [point.bucket, point]));
  });
  return [...buckets]
    .sort((a, b) => a - b)
    .map((bucket) => {
      const row: Record<string, number | null> = { bucket };
      samples.forEach((points, index) => {
        const point = points.get(bucket);
        row[`rx${index}`] = point?.rx ?? null;
        row[`tx${index}`] = point?.tx ?? null;
      });
      return row;
    });
}

export function toggleNetworkHost(
  ids: string[],
  selected: string[] | null,
  id: string,
  multiple: boolean,
): string[] | null {
  const remaining = selected?.filter((value) => ids.includes(value));
  const visible = remaining?.length ? remaining : ids;
  if (!multiple) return visible.length === 1 && visible[0] === id ? null : [id];
  const next = visible.includes(id)
    ? visible.filter((value) => value !== id)
    : [...visible, id];
  return next.length === 0 || next.length === ids.length ? null : next;
}
