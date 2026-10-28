import { useEffect, useState } from "react";
import { Thermometer } from "lucide-react";
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
import { cn, type Host } from "../lib";
import {
  temperatureRows,
  toggleTemperature,
  type TemperatureHistoryData,
} from "../temperatures";

const colors = [
  "#2563eb",
  "#7c3aed",
  "#0d9488",
  "#d97706",
  "#db2777",
  "#64748b",
];

export function TemperatureHistory({
  host,
  period,
  onPeriodChange,
  end,
  request,
}: {
  host: Host;
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  end: number;
  request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const [data, setData] = useState<TemperatureHistoryData>({
    series: [],
    records: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    setData({ series: [], records: [] });
    setHidden([]);
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const result = await request(
          `/temperatures/${encodeURIComponent(host.id)}?days=${period}`,
        );
        if (alive) {
          setData(result);
          setError("");
        }
      } catch (cause) {
        if (alive) setError((cause as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [host.id, period, request]);
  const ids = data.series.map((s) => s.id);
  const rows = temperatureRows(data.records, ids, period);
  const message = loading
    ? "Загружаем историю температур…"
    : error ||
      (!rows.length ? "За выбранный период замеров температуры пока нет." : "");
  return (
    <Card className="min-w-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Thermometer size={15} className="text-orange-600" /> Температуры
        </h2>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        CPU, все GPU и накопители · °C ·{" "}
        {period === 1 ? "Интервалы по 5 минут" : "Средние за 6 часов"}
      </p>
      <div
        role="img"
        aria-label="История температур устройств, °C"
        className="mt-2 h-64 min-w-0"
      >
        {message ? (
          <div
            role="status"
            className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
          >
            {message}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 4"
                vertical={false}
                stroke="#eceef1"
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
                tickFormatter={(v) =>
                  period === 1
                    ? new Date(v * 1000).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : new Date(v * 1000).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })
                }
              />
              <YAxis
                domain={["auto", "auto"]}
                width={54}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v} °C`}
              />
              <Tooltip
                labelFormatter={(v) =>
                  new Date(Number(v) * 1000).toLocaleString("ru-RU")
                }
                formatter={(v: number, name: string) => [
                  `${Math.round(v * 10) / 10} °C`,
                  data.series.find((s) => s.id === name)?.label || name,
                ]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #eee",
                  fontSize: 12,
                }}
              />
              {data.series.map((sensor, index) => (
                <Line
                  key={sensor.id}
                  dataKey={sensor.id}
                  hide={hidden.includes(sensor.id)}
                  type="linear"
                  stroke={colors[index % colors.length]}
                  strokeWidth={1.8}
                  dot={{ r: 2, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div
        role="group"
        aria-label="Устройства на графике температуры"
        className="mt-2 flex flex-wrap gap-2"
      >
        {data.series.map((sensor, index) => (
          <button
            key={sensor.id}
            aria-pressed={!hidden.includes(sensor.id)}
            onClick={() => setHidden(toggleTemperature(hidden, sensor.id, ids))}
            className={cn(
              "inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-100 px-2 py-1 text-left text-xs",
              hidden.includes(sensor.id) && "opacity-40",
            )}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            <span className="break-all">{sensor.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] leading-5 text-muted-foreground">
        История накапливается дашбордом с момента обновления. Пропуски —
        разрывы; редкие замеры — отдельные точки. Для дисков используется время
        исходного SMART-замера, а не получения кэша. Дополнительного опроса
        дисков нет.
      </p>
    </Card>
  );
}
