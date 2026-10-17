import { useState } from "react";
import { HardDrive } from "lucide-react";
import { bytes, speed, type Host, type Point } from "../lib";
import { Card } from "./ui/card";
import { HistoryChart, type HistoryPeriod } from "./resource-history";

export function DiskActivity({
  host,
  records,
  period,
  end,
  loading,
  error,
}: {
  host: Host;
  records: Point[];
  period: HistoryPeriod;
  end: number;
  loading: boolean;
  error: string;
}) {
  const [selected, setSelected] = useState("");
  const names = Array.from(
    new Set([
      ...(host.metrics?.disks.map((d) => d.name) || []),
      ...Object.keys(host.metrics?.disk_io || {}),
      ...records.flatMap((r) => Object.keys(r.disk_io || {})),
    ]),
  );
  const name = names.includes(selected) ? selected : names[0] || "";
  const disk = host.metrics?.disks.find((d) => d.name === name);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="disk-activity-heading"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <HardDrive size={19} /> Дисковая активность
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            За выбранный выше период · Счётчики Linux, без тестов диска
          </p>
        </div>
        {names.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Диск
            <select
              aria-label="Диск для истории ввода-вывода"
              value={name}
              onChange={(e) => setSelected(e.target.value)}
              className="max-w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-foreground"
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  /dev/{n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Card className="min-w-0 p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {disk?.model || (name ? `/dev/${name}` : "Ввод-вывод диска")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {name ? `/dev/${name}` : "Нет данных об устройствах"}
              {disk ? ` · ${disk.type}` : ""}
            </p>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Сейчас: </span>
            <span className="text-blue-700">
              чтение{" "}
              {current && current.seconds > 0
                ? speed(current.read_bytes / current.seconds)
                : "—"}
            </span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-emerald-700">
              запись{" "}
              {current && current.seconds > 0
                ? speed(current.write_bytes / current.seconds)
                : "—"}
            </span>
          </div>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-zinc-50 p-4 xl:grid-cols-4">
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
              <p className="mt-2 text-xl font-semibold tracking-tight">
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
            { key: "rx", label: "Чтение", color: "#2563eb" },
            { key: "tx", label: "Запись", color: "#059669" },
          ]}
          emptyText="Нет истории ввода-вывода за этот период. Требуется Linux-агент с поддержкой /proc/diskstats и два последовательных замера."
        />
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-black/5 pt-3 text-xs text-muted-foreground">
          <div className="flex gap-4">
            <span className="text-blue-700">● Чтение</span>
            <span className="text-emerald-700">● Запись</span>
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
          Итоги учитывают только собранные интервалы. История до обновления
          агента отсутствует. Диски и логические устройства показаны отдельно;
          их значения могут пересекаться.
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
