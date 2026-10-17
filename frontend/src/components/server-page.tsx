import { DiskActivity } from "./disk-activity";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Cpu,
  MemoryStick,
  Monitor,
  Network,
  Server,
  Trash2,
} from "lucide-react";
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
  children,
}: {
  host: Host;
  period: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  records: Point[];
  loading: boolean;
  error: string;
  end: number;
  onDelete: () => void;
  children: ReactNode;
}) {
  const m = host.metrics;
  const cards = [
    {
      title: "Процессор",
      icon: Cpu,
      value: percent(host.online ? m?.cpu.usage : null),
      detail: m ? `${m.cpu.model} · ${m.cpu.cores} потоков` : "Нет данных",
      key: "cpu" as const,
      color: "#2563eb",
    },
    {
      title: "Память",
      icon: MemoryStick,
      value: percent(host.online ? m?.memory.percent : null),
      detail: m
        ? `${bytes(m.memory.used)} из ${bytes(m.memory.total)}`
        : "Нет данных",
      key: "memory" as const,
      color: "#7c3aed",
    },
    {
      title: "Видеокарта",
      icon: Monitor,
      value: percent(host.online ? m?.gpus[0]?.usage : null),
      detail: m?.gpus[0]?.name || "GPU не обнаружен или данные недоступны",
      key: "gpu" as const,
      color: "#d97706",
    },
    {
      title: "Сеть",
      icon: Network,
      value: host.online && m ? `↓ ${speed(m.network.rx)}` : "—",
      detail: host.online && m ? `↑ ${speed(m.network.tx)}` : "Нет связи",
      key: "rx" as const,
      color: "#0891b2",
    },
  ];
  return (
    <div className="space-y-7">
      <Link
        to="/servers"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-blue-700"
      >
        <ArrowLeft size={15} /> Все серверы
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="hidden rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-700 sm:block">
            <Server size={28} strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h1 className="break-words text-3xl font-semibold tracking-tight">
                {host.name}
              </h1>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs",
                  host.online
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-orange-50 text-orange-700",
                )}
              >
                {host.online ? "В сети" : "Недоступен"}
              </span>
              {host.demo && <span className="text-xs text-blue-700">Демо</span>}
            </div>
            <p className="text-sm text-muted-foreground">
              {host.local ? "Центральный сервер" : `${host.ip}:${host.port}`} ·{" "}
              {m?.os || "ОС неизвестна"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {m
                ? `Последние метрики: ${new Date(m.timestamp * 1000).toLocaleString("ru-RU")}`
                : "Ожидание метрик агента"}
            </p>
          </div>
        </div>
        {!host.demo && !host.local && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-700"
            onClick={onDelete}
          >
            <Trash2 size={14} /> Удалить сервер
          </Button>
        )}
      </div>
      {!host.online && (
        <p
          role="status"
          className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800"
        >
          Сервер недоступен. История сохранена; текущие показатели появятся
          после восстановления связи. {host.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, icon: Icon, value, detail, color }) => (
          <Card key={title} className="p-5">
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Icon size={16} style={{ color }} />
              {title}
              <span className="ml-auto text-xs">Сейчас</span>
            </div>
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          </Card>
        ))}
      </div>
      <section aria-labelledby="resource-history-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="resource-history-heading" className="text-lg font-semibold">
              История ресурсов
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {period === 1
                ? "Интервалы по 5 минут"
                : "Средние значения за 6 часов"}{" "}
              · Пропуски в наблюдениях показаны разрывами
            </p>
          </div>
          <PeriodSelector value={period} onChange={onPeriodChange} />
        </div>
        {host.history_error && (
          <p role="status" className="text-sm text-orange-700">
            {host.history_error}
          </p>
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {cards.map(({ title, icon: Icon, key, color }) => (
            <Card key={key} className="min-w-0 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Icon size={16} style={{ color }} />
                {title}
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {key === "rx" ? "Байт/с" : "Загрузка, %"}
                </span>
              </h3>
              <HistoryChart
                records={records}
                period={period}
                end={end}
                loading={loading}
                error={error}
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
              <div className="mt-3 border-t border-black/5 pt-3 text-xs text-muted-foreground">
                {key === "rx" ? (
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>Приём · Передача</span>
                    <span>
                      За период: ↓{" "}
                      {bytes(records.reduce((s, p) => s + p.rx_bytes, 0))} · ↑{" "}
                      {bytes(records.reduce((s, p) => s + p.tx_bytes, 0))}
                    </span>
                  </div>
                ) : key === "gpu" ? (
                  "История первой видеокарты сервера"
                ) : key === "memory" ? (
                  "Доля занятой оперативной памяти"
                ) : (
                  "Общая загрузка процессора"
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>
      <DiskActivity
        host={host}
        records={records}
        period={period}
        end={end}
        loading={loading}
        error={error}
      />
      <Card className="p-5 sm:p-6">
        <h2 className="mb-5 text-lg font-semibold">О сервере</h2>
        {children}
      </Card>
    </div>
  );
}
