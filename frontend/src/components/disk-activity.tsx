import { useState } from "react";
import { HardDrive, Check } from "lucide-react";
import { bytes, cn, speed, type Host, type Point } from "../lib";
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
  const disks = host.metrics?.disks || [];
  const names = disks.map((d) => d.name);
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
      </div>
      {names.length > 0 && (
        <div
          role="group"
          aria-label="Выбор накопителя"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {names.map((n) => {
            const device = disks.find((d) => d.name === n);
            const active = n === name;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(n)}
                className={cn(
                  "flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  active
                    ? "border-blue-400 bg-blue-50/60"
                    : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
                )}
              >
                <span
                  className={cn(
                    "rounded-lg p-2",
                    active
                      ? "bg-blue-100 text-blue-700"
                      : "bg-zinc-100 text-muted-foreground",
                  )}
                >
                  <HardDrive size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">
                    {device?.model || `/dev/${n}`}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {device
                      ? `${device.type} · ${bytes(device.total)}`
                      : "Сведения о модели недоступны"}
                  </span>
                  <span className="mt-2 block font-mono text-xs text-muted-foreground">
                    /dev/{n}
                  </span>
                </span>
                {active && (
                  <Check size={16} className="shrink-0 text-blue-700" />
                )}
              </button>
            );
          })}
        </div>
      )}
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
          emptyText={
            name
              ? "Нет истории ввода-вывода за этот период. Требуется Linux-агент с поддержкой /proc/diskstats и два последовательных замера."
              : "Агент пока не передал сведения о накопителях."
          }
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
          агента отсутствует.
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
