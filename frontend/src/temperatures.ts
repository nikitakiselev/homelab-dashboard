import { type Host } from "./lib";
import { type HistoryPeriod } from "./components/resource-history";

export type TemperatureHistoryData = {
  series: { id: string; label: string; kind: "gpu" | "disk" }[];
  records: { bucket: number; values: Record<string, number | null> }[];
};

export function currentTemperatures(host: Host) {
  const m = host.metrics;
  if (!m) return [];
  return [
    ...m.gpus.map((gpu, index) => ({
      id: `gpu-${index}`,
      label: `GPU ${index + 1}`,
      name: gpu.name,
      value: gpu.temperature,
      measured: m.timestamp,
      saved: !host.online,
    })),
    ...m.disks.map((disk, index) => ({
      id: `disk-${index}`,
      label: disk.name,
      name: disk.model,
      value: disk.temperature,
      measured: disk.smart_updated_at,
      saved: true,
    })),
  ].filter(
    (reading) => reading.value != null && Number.isFinite(reading.value),
  );
}

export function temperatureRows(
  records: TemperatureHistoryData["records"],
  ids: string[],
  period: HistoryPeriod,
) {
  const step = period === 1 ? 300 : 21600;
  const empty = Object.fromEntries(ids.map((id) => [id, null]));
  return records.flatMap((record, index) => {
    const row = {
      bucket: record.bucket,
      ...Object.fromEntries(
        ids.map((id) => [
          id,
          record.values[id] != null && Number.isFinite(record.values[id])
            ? record.values[id]
            : null,
        ]),
      ),
    };
    return records[index + 1]?.bucket - record.bucket > step * 1.5
      ? [row, { bucket: record.bucket + step, ...empty }]
      : [row];
  });
}

export function toggleTemperature(hidden: string[], id: string, ids: string[]) {
  if (hidden.includes(id)) return hidden.filter((key) => key !== id);
  return ids.filter((key) => !hidden.includes(key)).length > 1
    ? [...hidden, id]
    : hidden;
}
