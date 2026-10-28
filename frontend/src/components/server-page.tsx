import { type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import {
  ArrowLeft,
  Cpu,
  MemoryStick,
  Monitor,
  Network,
  Trash2,
} from "lucide-react";
import { DiskActivity } from "./disk-activity";
import { TemperatureHistory } from "./temperature-history";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import {
  HistoryChart,
  PeriodSelector,
  type HistoryPeriod,
} from "./resource-history";
import { bytes, cn, percent, speed, type Host, type Point } from "../lib";

export function ServerPage({
  host,
  period,
  onPeriodChange,
  records,
  loading,
  error,
  end,
  onDelete,
  system,
  disks,
  request,
}: {
  host: Host;
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  records: Point[];
  loading: boolean;
  error: string;
  end: number;
  onDelete: () => void;
  system: ReactNode;
  disks: ReactNode;
  request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const m = host.metrics;
  const { hash } = useLocation();
  const section =
    hash === "#disk-activity"
      ? "disks"
      : hash === "#system"
        ? "system"
        : "overview";
  const cards = [
    {
      title: "Процессор",
      icon: Cpu,
      value: percent(host.online ? m?.cpu.usage : null),
      detail: m ? `${m.cpu.cores} потоков · ${m.cpu.model}` : "Нет данных",
      key: "cpu" as const,
      color: "#2563eb",
    },
    {
      title: "Память",
      icon: MemoryStick,
      value: percent(host.online ? m?.memory.percent : null),
      detail: m
        ? `${bytes(m.memory.used)} / ${bytes(m.memory.total)}`
        : "Нет данных",
      key: "memory" as const,
      color: "#7c3aed",
    },
    {
      title: "Видеокарта",
      icon: Monitor,
      value: percent(host.online ? m?.gpus[0]?.usage : null),
      detail: m?.gpus[0]?.name || "Данные GPU недоступны",
      key: "gpu" as const,
      color: "#d97706",
    },
    {
      title: "Сеть",
      icon: Network,
      value: host.online && m ? `↓ ${speed(m.network.rx)}` : "—",
      detail: host.online && m ? `↑ ${speed(m.network.tx)}` : "Нет данных",
      key: "rx" as const,
      color: "#0891b2",
    },
  ];
  return (
    <div className="space-y-5">
      <Link
        to="/servers"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-blue-700"
      >
        <ArrowLeft size={14} /> Все серверы
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
              {host.name}
            </h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                host.online
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-orange-50 text-orange-700",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  host.online ? "bg-emerald-500" : "bg-orange-500",
                )}
              />
              {host.online ? "В сети" : "Недоступен"}
            </span>
            {host.demo && (
              <span className="text-xs text-muted-foreground">Демо</span>
            )}
          </div>
          <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">
            {host.ip}
            {host.port != null ? `:${host.port}` : ""} ·{" "}
            {m?.os || "ОС неизвестна"} · Агент{" "}
            {m?.agent_version || "неизвестен"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m
              ? `Последние метрики: ${new Date(m.timestamp * 1000).toLocaleString("ru-RU")}`
              : "Ожидание метрик агента"}
          </p>
        </div>
        {!host.demo && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-red-700"
            onClick={onDelete}
          >
            <Trash2 size={14} /> Удалить
          </Button>
        )}
      </div>
      {!host.online && (
        <p
          role="status"
          className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs leading-5 text-orange-800"
        >
          Сервер недоступен. Показаны сохранённые сведения и история.{" "}
          {host.error}
        </p>
      )}
      {!!m?.diagnostics &&
        Object.entries(m.diagnostics).map(([key, value]) => (
          <p
            key={key}
            role="status"
            className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700"
          >
            {key}: {value}
          </p>
        ))}
      <nav
        aria-label="Разделы сервера"
        className="flex gap-5 border-b border-zinc-200"
      >
        {(
          [
            ["overview", "#overview", "Обзор"],
            ["disks", "#disk-activity", "Накопители"],
            ["system", "#system", "Система"],
          ] as const
        ).map(([id, href, label]) => (
          <Link
            key={id}
            to={href}
            aria-current={section === id ? "location" : undefined}
            className={cn(
              "border-b-2 px-0.5 pb-2.5 text-sm transition-colors",
              section === id
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {id === "disks" && m && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {m.disks.length}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {section === "overview" && (
        <section
          id="overview"
          aria-label="Обзор ресурсов"
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {period === 1
                ? "Интервалы по 5 минут"
                : "Средние значения за 6 часов"}{" "}
              · Пропуски показаны разрывами
            </p>
            <PeriodSelector value={period} onChange={onPeriodChange} />
          </div>
          {host.history_error && (
            <p role="status" className="text-xs text-orange-700">
              {host.history_error}
            </p>
          )}
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {cards.map(({ title, icon: Icon, value, detail, key, color }) => (
              <Card key={key} className="min-w-0 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Icon size={14} style={{ color }} />
                    {title}
                  </h2>
                  <span className="text-base font-semibold tracking-tight">
                    {value}
                  </span>
                </div>
                <p
                  title={detail}
                  className="mt-1 mb-2 truncate text-xs text-muted-foreground"
                >
                  {detail}
                </p>
                <HistoryChart
                  records={records}
                  period={period}
                  end={end}
                  loading={loading}
                  error={error}
                  height={180}
                  series={
                    key === "rx"
                      ? [
                          { key: "rx", label: "Приём", color },
                          { key: "tx", label: "Передача", color: "#059669" },
                        ]
                      : [{ key, label: title, color }]
                  }
                  emptyText={
                    key === "gpu"
                      ? "Нет данных о загрузке GPU за выбранный период."
                      : undefined
                  }
                />
                <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-zinc-100 pt-2 text-[11px] text-muted-foreground">
                  <span>
                    {key === "rx"
                      ? "Приём · Передача"
                      : key === "gpu"
                        ? "Первая видеокарта · загрузка, %"
                        : "Загрузка, %"}
                  </span>
                  {key === "rx" && (
                    <span>
                      За период: ↓{" "}
                      {records.some((p) => p.rx != null)
                        ? bytes(records.reduce((sum, p) => sum + p.rx_bytes, 0))
                        : "—"}{" "}
                      · ↑{" "}
                      {records.some((p) => p.tx != null)
                        ? bytes(records.reduce((sum, p) => sum + p.tx_bytes, 0))
                        : "—"}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <TemperatureHistory
            host={host}
            period={period}
            onPeriodChange={onPeriodChange}
            end={end}
            request={request}
          />
        </section>
      )}
      {section === "disks" && (
        <div className="space-y-4">
          <Card className="px-4">{disks}</Card>
          {host.history_error && (
            <p role="status" className="text-xs text-orange-700">
              {host.history_error}
            </p>
          )}
          <DiskActivity
            onPeriodChange={onPeriodChange}
            host={host}
            records={records}
            period={period}
            end={end}
            loading={loading}
            error={error}
          />
        </div>
      )}
      {section === "system" && (
        <Card id="system" className="p-4">
          {system}
        </Card>
      )}
    </div>
  );
}
