import { useState } from "react";
import { bytes, speed, type Host, type Point } from "../lib";
import { Card } from "./ui/card";
import {
  HistoryChart,
  PeriodSelector,
  type HistoryPeriod,
} from "./resource-history";

export function DiskActivity({
  host,
  records,
  period,
  onPeriodChange,
  end,
  loading,
  error,
}: {
  host: Host;
  records: Point[];
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  end: number;
  loading: boolean;
  error: string;
}) {
  const [selected, setSelected] = useState("");
  const disks = host.metrics?.disks || [];
  const names = disks.map((d) => d.name);
  const name = names.includes(selected) ? selected : names[0] || "";
  const current = host.online ? host.metrics?.disk_io?.[name] : undefined;
  const observed = records.flatMap((r) =>
    r.disk_io?.[name] ? [r.disk_io[name]] : [],
  );
  const hasData = observed.length > 0;
  const total = (
    key: "read_bytes" | "write_bytes" | "read_ops" | "write_ops",
  ) => observed.reduce((s, r) => s + r[key], 0);
  const points: Point[] = records.map((r) => {
    const io = r.disk_io?.[name];
    return {
      ...r,
      rx: io && io.seconds > 0 ? io.read_bytes / io.seconds : null,
      tx: io && io.seconds > 0 ? io.write_bytes / io.seconds : null,
    };
  });
  return (
    <section
      id="disk-activity"
      aria-labelledby="disk-activity-heading"
      className="space-y-4"
    >
      <Card className="min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="disk-activity-heading" className="text-sm font-semibold">
            Чтение и запись
          </h2>
          <PeriodSelector value={period} onChange={onPeriodChange} />
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="flex min-w-0 max-w-full items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">Диск</span>
            <select
              aria-label="Выбрать диск для графика"
              value={name}
              onChange={(event) => setSelected(event.target.value)}
              disabled={!disks.length}
              className="h-8 min-w-0 max-w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-foreground sm:max-w-80"
            >
              {!disks.length && <option value="">Нет накопителей</option>}
              {disks.map((device) => (
                <option key={device.name} value={device.name}>
                  /dev/{device.name} · {device.model || device.type} ·{" "}
                  {bytes(device.total)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Чтение сейчас{" "}
              <strong className="font-medium text-foreground">
                {current && current.seconds > 0
                  ? speed(current.read_bytes / current.seconds)
                  : "—"}
              </strong>
            </span>
            <span>
              Запись сейчас{" "}
              <strong className="font-medium text-foreground">
                {current && current.seconds > 0
                  ? speed(current.write_bytes / current.seconds)
                  : "—"}
              </strong>
            </span>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-zinc-50 p-3 xl:grid-cols-4">
          {[
            ["Прочитано за период", hasData ? bytes(total("read_bytes")) : "—"],
            ["Записано за период", hasData ? bytes(total("write_bytes")) : "—"],
            [
              "Операций чтения",
              hasData
                ? Math.round(total("read_ops")).toLocaleString("ru-RU")
                : "—",
            ],
            [
              "Операций записи",
              hasData
                ? Math.round(total("write_ops")).toLocaleString("ru-RU")
                : "—",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-semibold tracking-tight">
                {loading ? "…" : value}
              </p>
            </div>
          ))}
        </div>
        <HistoryChart
          records={points}
          period={period}
          end={end}
          loading={loading}
          error={error}
          series={[
            { key: "rx", label: "Скорость чтения", color: "#2563eb" },
            { key: "tx", label: "Скорость записи", color: "#059669" },
          ]}
          emptyText={
            name
              ? "За этот период нет измерений чтения и записи. Для расчёта нужны два последовательных замера агента."
              : "Агент пока не передал сведения о накопителях."
          }
        />
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-black/5 pt-3 text-xs text-muted-foreground">
          <div className="flex gap-4">
            <span className="text-blue-700">● Скорость чтения</span>
            <span className="text-emerald-700">● Скорость записи</span>
          </div>
          {hasData && (
            <span>
              Наблюдалось{" "}
              {Math.round(
                observed.reduce((s, r) => s + r.seconds, 0) / 60,
              ).toLocaleString("ru-RU")}{" "}
              мин. из {(period * 1440).toLocaleString("ru-RU")}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          График показывает скорость чтения и записи выбранного диска. Итоги
          учитывают только интервалы с измерениями.
        </p>
        {host.metrics?.diagnostics?.disk_io && (
          <p role="status" className="mt-3 text-sm text-orange-700">
            {host.metrics.diagnostics.disk_io}
          </p>
        )}
      </Card>
    </section>
  );
}
