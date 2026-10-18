import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "./ui/card";
import { PeriodSelector, type HistoryPeriod } from "./resource-history";
import { networkHistoryRows, toggleNetworkHost } from "./network-history-data";
import { cn, speed, type Host, type Point } from "../lib";

const COLORS = [
  "#2563eb",
  "#059669",
  "#9333ea",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#4f46e5",
  "#64748b",
];
export function NetworkHistory({
  hosts,
  request,
  period,
  onPeriodChange,
  end,
}: {
  hosts: Host[];
  request: (path: string) => Promise<{ records: Point[] }>;
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  end: number;
}) {
  const [records, setRecords] = useState<Record<string, Point[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[] | null>(null);
  const hostKey = JSON.stringify(hosts.map((host) => host.id));
  useEffect(() => {
    let alive = true;
    let busy = false;
    const ids: string[] = JSON.parse(hostKey);
    setRecords({});
    setErrors({});
    setLoading(ids.length > 0);
    const load = async () => {
      if (busy) return;
      busy = true;
      const results = await Promise.allSettled(
        ids.map((id) =>
          request(`/history/${encodeURIComponent(id)}?days=${period}`),
        ),
      );
      if (alive) {
        const next: Record<string, Point[]> = {};
        const failures: Record<string, string> = {};
        results.forEach((result, index) => {
          if (result.status === "fulfilled")
            next[ids[index]] = result.value.records;
          else
            failures[ids[index]] =
              result.reason instanceof Error
                ? result.reason.message
                : "Не удалось получить историю";
        });
        setRecords(next);
        setErrors(failures);
        setLoading(false);
      }
      busy = false;
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hostKey, period, request]);
  const ids = hosts.map((host) => host.id);
  const remaining = selected?.filter((id) => ids.includes(id));
  const shown = remaining?.length ? remaining : ids;
  const data = useMemo(
    () =>
      networkHistoryRows(
        records,
        JSON.parse(hostKey),
        period === 1 ? 300 : 21600,
      ),
    [records, hostKey, period],
  );
  const hasData = hosts.some(
    (host, index) =>
      shown.includes(host.id) &&
      data.some(
        (row) => row[`rx${index}`] != null || row[`tx${index}`] != null,
      ),
  );
  const current = hosts.filter(
    (host) => shown.includes(host.id) && host.online && host.metrics,
  );
  const errorsToShow = hosts.filter(
    (host) => errors[host.id] || host.history_error,
  );
  return (
    <Card className="min-w-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Network size={16} className="text-muted-foreground" />
          Сетевая активность
        </h2>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span className="text-xs text-muted-foreground">
          {shown.length === ids.length
            ? "Все серверы"
            : `Выбрано: ${shown.length}`}
        </span>
        <span>
          ↓{" "}
          {current.length
            ? speed(
                current.reduce(
                  (sum, host) => sum + host.metrics!.network.rx,
                  0,
                ),
              )
            : "—"}
        </span>
        <span>
          ↑{" "}
          {current.length
            ? speed(
                current.reduce(
                  (sum, host) => sum + host.metrics!.network.tx,
                  0,
                ),
              )
            : "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          сейчас
          {current.length < shown.length
            ? ` · данные ${current.length} из ${shown.length}`
            : ""}
        </span>
      </div>
      <div
        className="h-[250px] min-w-0"
        role="img"
        aria-label="История приёма и передачи по серверам"
      >
        {loading || !hasData ? (
          <div
            role="status"
            className="flex h-full items-center justify-center text-sm text-muted-foreground"
          >
            {loading
              ? "Загружаем историю…"
              : hosts.length
                ? "За выбранный период нет данных."
                : "Добавьте сервер для просмотра трафика."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#eceef1"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="bucket"
                type="number"
                scale="time"
                domain={[end - period * 86400, end]}
                allowDataOverflow
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                tick={{ fontSize: 11 }}
                tickFormatter={(value) =>
                  period === 1
                    ? new Date(value * 1000).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : new Date(value * 1000).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })
                }
              />
              <YAxis
                domain={[0, "auto"]}
                width={84}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => speed(value)}
              />
              <Tooltip
                labelFormatter={(value) =>
                  new Date(Number(value) * 1000).toLocaleString("ru-RU")
                }
                formatter={(value: number, name: string) => [
                  speed(value),
                  name,
                ]}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e4e4e7",
                  fontSize: 12,
                }}
              />
              {hosts.flatMap((host, index) =>
                shown.includes(host.id)
                  ? (["rx", "tx"] as const).map((direction) => (
                      <Line
                        key={`${host.id}-${direction}`}
                        dataKey={`${direction}${index}`}
                        name={`${host.name} · ${direction === "rx" ? "Приём" : "Передача"}`}
                        stroke={COLORS[index % COLORS.length]}
                        strokeDasharray={direction === "tx" ? "5 3" : undefined}
                        strokeWidth={1.8}
                        connectNulls={false}
                        dot={
                          records[host.id]?.filter(
                            (point) => point[direction] != null,
                          ).length === 1
                            ? { r: 3 }
                            : false
                        }
                        activeDot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    ))
                  : [],
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-3 border-t border-zinc-100 pt-3">
        <div
          role="group"
          aria-label="Серверы на графике"
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          {hosts.map((host, index) => (
            <button
              key={host.id}
              type="button"
              aria-pressed={shown.includes(host.id)}
              title="Нажмите, чтобы показать только этот сервер. Повторно — все. Ctrl/⌘ или Shift — выбрать несколько."
              onClick={(event) =>
                setSelected(
                  toggleNetworkHost(
                    ids,
                    selected,
                    host.id,
                    event.ctrlKey || event.metaKey || event.shiftKey,
                  ),
                )
              }
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-1.5 rounded text-xs",
                shown.includes(host.id)
                  ? "text-foreground"
                  : "text-muted-foreground line-through",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: COLORS[index % COLORS.length],
                  opacity: shown.includes(host.id) ? 1 : 0.3,
                }}
              />
              {host.name}
              {errors[host.id] ? " · ошибка" : ""}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Сплошная — приём · Пунктир — передача</span>
          <span>Нажмите на сервер, чтобы выделить его</span>
        </div>
      </div>
      {errorsToShow.map((host) => (
        <p
          key={host.id}
          role="status"
          className="mt-2 break-words text-xs text-orange-700"
        >
          {host.name}: {errors[host.id] || host.history_error}
        </p>
      ))}
    </Card>
  );
}
