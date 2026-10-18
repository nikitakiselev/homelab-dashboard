import { useId } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn, percent, speed, type Point } from "../lib";

export const HISTORY_PERIODS = [
  { days: 1, label: "Сутки" },
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number]["days"];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: HistoryPeriod;
  onChange: (value: HistoryPeriod) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Период истории"
      className="inline-flex flex-wrap rounded-lg bg-[#f2f3f5] p-[3px]"
    >
      {HISTORY_PERIODS.map(({ days, label }) => (
        <button
          key={days}
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-xs",
            value === days
              ? "bg-white font-medium shadow-xs"
              : "text-muted-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type Metric = "cpu" | "memory" | "gpu" | "rx" | "tx";
export function HistoryChart({
  records,
  period,
  end,
  series,
  loading,
  error,
  emptyText,
  height = 250,
}: {
  records: Point[];
  period: HistoryPeriod;
  end: number;
  series: { key: Metric; label: string; color: string }[];
  loading: boolean;
  error: string;
  emptyText?: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const network = series.some((s) => s.key === "rx" || s.key === "tx");
  const step = period === 1 ? 300 : 21600;
  const data = records.flatMap((point, index) => {
    const next = records[index + 1];
    return next && next.bucket - point.bucket > step * 1.5
      ? [
          point,
          {
            ...point,
            bucket: point.bucket + step,
            cpu: null,
            memory: null,
            gpu: null,
            rx: null,
            tx: null,
          },
        ]
      : [point];
  });
  const hasData = records.some((p) => series.some((s) => p[s.key] != null));
  const message = loading
    ? "Загружаем историю…"
    : error || (!hasData ? emptyText || "За выбранный период нет данных." : "");
  return (
    <div
      role="img"
      aria-label={`История: ${series.map((s) => s.label).join(", ")}`}
      className="min-w-0"
      style={{ height }}
    >
      {message ? (
        <div
          role="status"
          className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
        >
          {message}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 16, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`${id}-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
                </linearGradient>
              ))}
            </defs>
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
              domain={network ? [0, "auto"] : [0, 100]}
              axisLine={false}
              tickLine={false}
              width={network ? 84 : 42}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => (network ? speed(v) : `${v}%`)}
            />
            <Tooltip
              labelFormatter={(v) =>
                new Date(Number(v) * 1000).toLocaleString("ru-RU")
              }
              formatter={(v: number, name: string) => [
                network ? speed(v) : percent(v),
                series.find((s) => s.key === name)?.label || name,
              ]}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #eee",
                fontSize: 13,
              }}
            />
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type="linear"
                stroke={s.color}
                strokeWidth={1.8}
                fill={`url(#${id}-${s.key})`}
                connectNulls={false}
                dot={records.length === 1 ? { r: 3 } : false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
