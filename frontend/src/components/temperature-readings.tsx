import { Thermometer } from "lucide-react";
import { type Host } from "../lib";
import { currentTemperatures } from "../temperatures";

export function TemperatureReadings({ host }: { host: Host }) {
  const readings = currentTemperatures(host);
  return (
    <div
      aria-label={host.online ? "Температуры" : "Сохранённые температуры"}
      className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
    >
      <Thermometer size={12} aria-hidden="true" className="shrink-0" />
      {!readings.length ? (
        <span>Температуры: нет данных</span>
      ) : (
        readings.map((reading) => {
          const measured =
            reading.measured != null && Number.isFinite(reading.measured)
              ? new Date(reading.measured * 1000).toLocaleString("ru-RU")
              : "Время замера неизвестно";
          const description = `${reading.name} · ${reading.saved ? "Сохранённый замер · " : "Замер · "}${measured}`;
          return (
            <span
              key={reading.id}
              title={description}
              aria-label={`${reading.label}: ${reading.value} °C · ${description}`}
              className="max-w-full rounded bg-zinc-50 px-1.5 py-0.5"
            >
              <span className="break-all">{reading.label}</span>{" "}
              <span className="whitespace-nowrap font-medium tabular-nums text-zinc-700">
                {Math.round(reading.value!)} °C{reading.saved ? " *" : ""}
              </span>
            </span>
          );
        })
      )}
      {readings.some((r) => r.saved) && (
        <span title="Время исходного измерения указано в подсказке каждого устройства">
          * сохранено
        </span>
      )}
    </div>
  );
}
