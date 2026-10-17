import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  LayoutGrid,
  Server,
  HardDrive,
  Network,
  Plus,
  Search,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Cpu,
  MemoryStick,
  ChevronRight,
  ChevronDown,
  Check,
  CircleHelp,
  Monitor,
  X,
  RefreshCw,
  Copy,
  CheckCheck,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Terminal,
  Command,
  Activity,
  LogOut,
  Download,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  cn,
  bytes,
  speed,
  percent,
  type Host,
  type Disk,
  type Point,
} from "./lib";
import "./index.css";

type View = "overview" | "servers" | "storage" | "network";
const labels: Record<View, string> = {
  overview: "Обзор",
  servers: "Серверы",
  storage: "Накопители",
  network: "Сеть",
};
function App() {
  const [hosts, setHosts] = useState<Host[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [token, setToken] = useState(sessionStorage.getItem("homelab-token") || "");
  const [authDraft, setAuthDraft] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null),
    [deleteTarget, setDeleteTarget] = useState<string | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false);
  const [view, setView] = useState<View>("overview"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [add, setAdd] = useState(false),
    [help, setHelp] = useState(false),
    [period, setPeriod] = useState<1 | 90>(1),
    [history, setHistory] = useState<Point[]>([]),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [updated, setUpdated] = useState<number | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [showDemo, setShowDemo] = useState(true);
  const request = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const r = await fetch("/api" + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...options.headers,
        },
      });
      if (r.status === 401) {
        setAuth(true);
        throw new Error("Требуется токен доступа");
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Ошибка запроса");
      return data;
    },
    [token],
  );
  const load = useCallback(async () => {
    try {
      const d = await request("/hosts");
      setHosts(d.hosts);
      setUpdated(d.timestamp);
      setError("");
      setAuth(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [request]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  const eligible = hosts.filter((h) => showDemo || !h.demo);
  const visible = eligible.filter(
    (h) =>
      !["overview", "servers"].includes(view) ||
      !search ||
      [h.name, h.ip, h.metrics?.os].some((v) =>
        v?.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const active = eligible.find((h) => h.id === selected) || eligible[0];
  const detail = hosts.find((h) => h.id === detailId);
  const downloadAgent = async () => {
    const response = await fetch("/api/agent/bundle", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    if (!response.ok) throw new Error("Не удалось скачать агент");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "homelab-agent.tar.gz";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  useEffect(() => {
    let alive = true;
    if (!active) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    setHistory([]);
    setHistoryError("");
    const get = () =>
      request(`/history/${active.id}?days=${period}`)
        .then((d) => {
          if (alive) {
            setHistory(d.records);
            setHistoryError("");
          }
        })
        .catch((e) => {
          if (alive) setHistoryError((e as Error).message);
        })
        .finally(() => {
          if (alive) setHistoryLoading(false);
        });
    get();
    const t = setInterval(get, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active?.id, period, request]);
  const online = eligible.filter((h) => h.online && h.metrics),
    metrics = online.map((h) => h.metrics!),
    allDisks = metrics.flatMap((m) => m.disks);
  const cpu =
    metrics
      .filter((m) => m.cpu.usage != null)
      .reduce((s, m) => s + (m.cpu.usage || 0) * m.cpu.cores, 0) /
    Math.max(
      1,
      metrics
        .filter((m) => m.cpu.usage != null)
        .reduce((s, m) => s + m.cpu.cores, 0),
    );
  const totalMemory = metrics.reduce((s, m) => s + m.memory.total, 0),
    usedMemory = metrics.reduce((s, m) => s + m.memory.used, 0),
    totalDisk = allDisks.reduce((s, d) => s + d.total, 0),
    usedDisk = allDisks.reduce((s, d) => s + d.used, 0);
  const chartPoints = history.flatMap((point, index) => {
    const next = history[index + 1],
      step = period === 1 ? 300 : 21600;
    return next && next.bucket - point.bucket > step * 1.5
      ? [point, { ...point, bucket: point.bucket + step, rx: null, tx: null }]
      : [point];
  });
  const rx = metrics.reduce((s, m) => s + m.network.rx, 0),
    tx = metrics.reduce((s, m) => s + m.network.tx, 0),
    warnings = allDisks.filter((d) => ["warning", "failed"].includes(d.health));
  return (
    <div className="min-h-screen lg:flex">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[218px] flex-col border-r border-black/[0.055] bg-[#eeeef1]/90 px-4 py-7 lg:flex">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
          className="mb-10 flex items-center gap-2.5 px-3 no-underline text-inherit"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#27292e] text-white shadow-sm">
            <Command size={18} />
          </div>
          <span className="text-[19px] font-semibold tracking-[-.7px]">
            homelab<span className="text-blue-500">.</span>
          </span>
        </a>
        <div className="eyebrow mb-3 px-3">Навигация</div>
        <nav className="space-y-1">
          {(
            [
              ["overview", LayoutGrid],
              ["servers", Server],
              ["storage", HardDrive],
              ["network", Network],
            ] as const
          ).map(([id, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors cursor-pointer",
                view === id
                  ? "bg-white font-medium text-[#25272c] shadow-[0_1px_5px_#00000007]"
                  : "text-[#777981] hover:bg-black/3",
              )}
            >
              <Icon
                size={17}
                strokeWidth={1.7}
                className={view === id ? "text-blue-500" : ""}
              />
              {labels[id]}
              {id === "servers" && (
                <span className="ml-auto rounded bg-black/4 px-1.5 text-[10px] text-zinc-400">
                  {visible.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-5 rounded-xl border border-white/80 bg-white/45 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  error ? "bg-orange-400" : "bg-emerald-500",
                )}
              />
              {error ? "Нет связи с сервисом" : "Центральный сервис"}
            </div>
            <p className="mt-1.5 mb-0 pl-3.5 text-[10px] text-zinc-400">
              Сбор метрик активен
            </p>
          </div>
          <button
            onClick={() => setHelp(true)}
            className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer"
          >
            <CircleHelp size={16} />
            Как это работает
            <ArrowUpRight size={12} />
          </button>
          <div className="mt-4 flex items-center gap-2.5 border-t border-black/5 px-2 pt-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dce4ec] text-[10px] font-semibold text-[#66788c]">
              HL
            </div>
            <div>
              <div className="text-xs font-medium">Homelab</div>
              <div className="mt-0.5 text-[10px] text-zinc-400">
                Локальный мониторинг
              </div>
            </div>
            {token && (
              <button
                aria-label="Выйти"
                onClick={() => {
                  sessionStorage.removeItem("homelab-token");
                  setToken("");
                  setAuth(true);
                }}
                className="ml-auto text-zinc-400"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 lg:ml-[218px]">
        <header className="flex h-[70px] items-center justify-between gap-4 border-b border-black/[0.05] bg-white/60 px-5 lg:px-9">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Homelab</span>
            <ChevronRight size={12} className="text-zinc-300" />
            <span>{labels[view]}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 text-[11px] text-zinc-400 sm:flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  error ? "bg-orange-400" : "bg-emerald-500",
                )}
              />
              {updated ? "Обновление каждые 10 секунд" : "Подключение…"}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Обновить метрики"
              onClick={() => {
                setRefreshing(true);
                load();
              }}
            >
              <RefreshCw
                size={15}
                className={cn("text-zinc-400", refreshing && "spinner")}
              />
            </Button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-black/5 bg-white/50 px-4 py-2 lg:hidden">
          {(Object.keys(labels) as View[]).map((v) => (
            <Button
              key={v}
              variant={v === view ? "default" : "ghost"}
              size="sm"
              onClick={() => setView(v)}
            >
              {labels[v]}
            </Button>
          ))}
        </nav>
        <div className="mx-auto max-w-[1510px] px-5 py-8 lg:px-9 lg:py-9">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="h-px w-5 bg-zinc-300" />
                ИНФРАСТРУКТУРА
              </div>
              <h1 className="m-0 text-[30px] leading-tight font-semibold tracking-[-1.1px]">
                {view === "overview" ? "Обзор" : labels[view]}
              </h1>
              <p className="mt-2 mb-0 text-[13px] text-[#92949c]">
                {view === "overview"
                  ? "Состояние серверов и использование ресурсов."
                  : view === "storage"
                    ? "Ёмкость, файловые системы и SMART."
                    : view === "network"
                      ? "Текущая скорость и история трафика ваших серверов."
                      : "Подключённые хосты и их ресурсы."}
              </p>
            </div>
            <Button
              onClick={() => setAdd(true)}
              className="rounded-[9px] px-4 text-xs"
            >
              <Plus size={16} />
              Добавить сервер
            </Button>
          </div>
          {hosts.some((h) => h.demo) && showDemo && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-blue-600">
              <span className="flex items-center gap-2">
                <Monitor size={14} />
                <span>
                  <strong className="font-medium">Демонстрация.</strong>{" "}
                  Синтетические метрики демосерверов.
                </span>
              </span>
              <button
                aria-label="Скрыть демосерверы"
                onClick={() => setShowDemo(false)}
                className="rounded p-1 hover:bg-blue-100 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {error && !auth && (
            <div
              role="alert"
              className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-600"
            >
              {error}
              <button onClick={load} className="ml-3 underline cursor-pointer">
                Повторить
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-3 text-sm text-zinc-400">
              <Loader2 className="spinner" size={18} />
              Загрузка метрик…
            </div>
          ) : (
            <>
              {(view === "overview" || view === "network") && (
                <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
                  <Summary
                    icon={Server}
                    title="Серверы"
                    value={String(online.length)}
                    unit={`/ ${visible.length}`}
                    detail="в сети"
                    color="blue"
                    footer={
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {visible.length - online.length
                          ? `${visible.length - online.length} недоступно`
                          : "Серверы доступны"}
                      </>
                    }
                  />
                  <Summary
                    icon={Cpu}
                    title="Процессор"
                    value={online.length ? String(Math.round(cpu)) : "—"}
                    unit="%"
                    detail="средняя загрузка"
                    color="purple"
                    footer={
                      <>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full bg-[#a7a0ed]"
                            style={{ width: Math.min(cpu, 100) + "%" }}
                          />
                        </div>
                        <span className="whitespace-nowrap">
                          {metrics.reduce((s, m) => s + m.cpu.cores, 0)} потоков
                        </span>
                      </>
                    }
                  />
                  <Summary
                    icon={MemoryStick}
                    title="Память"
                    value={bytes(usedMemory, 0)}
                    detail={`из ${bytes(totalMemory, 0)}`}
                    color="orange"
                    footer={
                      <>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full bg-[#e7b47c]"
                            style={{
                              width:
                                (totalMemory
                                  ? (usedMemory / totalMemory) * 100
                                  : 0) + "%",
                            }}
                          />
                        </div>
                        <span>
                          {totalMemory
                            ? Math.round((usedMemory / totalMemory) * 100)
                            : 0}
                          %
                        </span>
                      </>
                    }
                  />
                  <Summary
                    icon={HardDrive}
                    title="Хранилище"
                    value={bytes(usedDisk)}
                    detail={`занято в смонтированных томах · ${bytes(totalDisk)} дисков`}
                    color="green"
                    footer={
                      <>
                        <div
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            warnings.length
                              ? "bg-orange-400"
                              : "bg-emerald-500",
                          )}
                        />
                        {warnings.length
                          ? `${warnings.length} диск требует внимания`
                          : `${allDisks.length} накопителей подключено`}
                      </>
                    }
                  />
                </div>
              )}
              {(view === "overview" || view === "servers") && (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 text-[16px] font-semibold tracking-[-.3px]">
                        Серверы
                      </h2>
                      <span className="rounded-md border border-black/5 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {visible.length}
                      </span>
                    </div>
                    <label className="flex h-8 items-center gap-2 rounded-lg border border-black/[.06] bg-white px-2.5 text-zinc-400">
                      <Search size={13} />
                      <input
                        aria-label="Найти сервер"
                        placeholder="Найти сервер…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-32 bg-transparent text-[11px] text-zinc-700 outline-none focus:shadow-none sm:w-40"
                      />
                    </label>
                  </div>
                  <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {visible.map((h) => (
                      <ServerCard
                        key={h.id}
                        host={h}
                        selected={active?.id === h.id}
                        onClick={() => {
                          setSelected(h.id);
                          setDetailId(h.id);
                        }}
                      />
                    ))}
                    {!visible.length && (
                      <Card className="col-span-full flex flex-col items-center py-14 text-center">
                        <div className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-500">
                          <Server size={28} strokeWidth={1.4} />
                        </div>
                        <h3 className="text-lg font-medium">
                          {search
                            ? "Серверы не найдены"
                            : "Нет подключённых серверов"}
                        </h3>
                        <p className="mb-5 max-w-sm text-sm text-zinc-400">
                          {search
                            ? "Попробуйте другое имя или IP-адрес."
                            : "Установите агент на Linux-сервер и добавьте его по IP-адресу."}
                        </p>
                        <Button
                          onClick={() =>
                            search ? setSearch("") : setAdd(true)
                          }
                        >
                          {search ? "Сбросить поиск" : "Добавить сервер"}
                        </Button>
                      </Card>
                    )}
                  </div>
                </>
              )}
              {view === "storage" && (
                <div className="space-y-6">
                  {visible.map((h) => (
                    <Card key={h.id} className="p-5">
                      <div className="mb-5 flex items-center gap-3">
                        <div className="rounded-xl bg-blue-50 p-2.5 text-blue-500">
                          <Server size={19} />
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold">{h.name}</h2>
                          <p className="text-[11px] text-zinc-400">
                            {h.ip} · {h.online ? "В сети" : "Недоступен"}
                            {h.demo ? " · Демо" : ""}
                          </p>
                        </div>
                        <span className="ml-auto text-xs text-zinc-400">
                          {h.metrics?.disks.length || 0} накопителей
                        </span>
                      </div>
                      {!h.online && (
                        <p className="mb-3 text-xs text-orange-500">
                          Последние доступные данные. Сервер не в сети.
                        </p>
                      )}
                      <DiskList disks={h.metrics?.disks || []} />
                    </Card>
                  ))}
                  {!visible.length && (
                    <Empty text="Добавьте сервер, чтобы увидеть его накопители." />
                  )}
                </div>
              )}
              {(view === "overview" || view === "network") && (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
                  <Card className="min-w-0 p-5">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
                          <Network size={16} className="text-zinc-400" />
                          Сетевая активность
                        </h2>
                        <label className="mt-2 block">
                          <span className="sr-only">Сервер для графика</span>
                          <select
                            aria-label="Сервер для графика"
                            value={active?.id || ""}
                            onChange={(e) => setSelected(e.target.value)}
                            className="max-w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600"
                          >
                            {eligible.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                                {h.demo ? " · демо" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="inline-flex rounded-lg bg-[#f2f3f5] p-[3px]">
                        {([1, 90] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setPeriod(d)}
                            className={cn(
                              "rounded-md px-3 py-1 text-[10px] cursor-pointer",
                              period === d
                                ? "bg-white font-medium shadow-xs"
                                : "text-zinc-400",
                            )}
                          >
                            {d === 1 ? "24 часа" : "90 дней"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-2 flex items-center gap-7">
                      <div>
                        <span className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <ArrowDown size={11} className="text-blue-500" />
                          Приём сейчас
                        </span>
                        <span className="text-xl font-medium tracking-[-.6px]">
                          {active?.online
                            ? speed(active.metrics?.network.rx || 0)
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="mb-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <ArrowUp size={11} className="text-emerald-500" />
                          Передача сейчас
                        </span>
                        <span className="text-xl font-medium tracking-[-.6px]">
                          {active?.online
                            ? speed(active.metrics?.network.tx || 0)
                            : "—"}
                        </span>
                      </div>
                      <div className="ml-auto hidden text-right text-[10px] leading-5 text-zinc-400 sm:block">
                        <div>По всем серверам</div>
                        <div>
                          ↓ {speed(rx)} &nbsp; ↑ {speed(tx)}
                        </div>
                      </div>
                    </div>
                    <div className="h-[194px] pt-4">
                      {historyLoading ? (
                        <Empty text="Загружаем историю…" />
                      ) : historyError ? (
                        <Empty text={historyError} />
                      ) : history.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={chartPoints}
                            margin={{ top: 8, right: 3, left: -17, bottom: 0 }}
                          >
                            <defs>
                              <linearGradient
                                id="rx"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#007aff"
                                  stopOpacity={0.13}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#007aff"
                                  stopOpacity={0.005}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 4"
                              vertical={false}
                              stroke="#eceef1"
                            />
                            <XAxis
                              dataKey="bucket"
                              axisLine={false}
                              tickLine={false}
                              minTickGap={45}
                              tickFormatter={(v) =>
                                new Date(v * 1000)
                                  .toLocaleDateString(
                                    "ru-RU",
                                    period === 1
                                      ? {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          day: undefined,
                                          month: undefined,
                                        }
                                      : { day: "numeric", month: "short" },
                                  )
                                  .replace(/^.*?, /, "")
                              }
                              tick={{ fontSize: 9 }}
                            />
                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => bytes(v, 0)}
                              width={63}
                              tick={{ fontSize: 9 }}
                            />
                            <Tooltip
                              labelFormatter={(v) =>
                                new Date(Number(v) * 1000).toLocaleString(
                                  "ru-RU",
                                )
                              }
                              formatter={(v: number, n: string) => [
                                speed(v),
                                n === "rx" ? "Приём" : "Передача",
                              ]}
                              contentStyle={{
                                borderRadius: 12,
                                border: "1px solid #eee",
                                fontSize: 11,
                                boxShadow: "0 4px 20px #00000008",
                              }}
                            />
                            <Area
                              dot={history.length === 1 ? { r: 3 } : false}
                              connectNulls={false}
                              type="monotone"
                              dataKey="rx"
                              stroke="#2389fb"
                              strokeWidth={1.8}
                              fill="url(#rx)"
                              isAnimationActive={false}
                            />
                            <Area
                              dot={history.length === 1 ? { r: 3 } : false}
                              connectNulls={false}
                              type="monotone"
                              dataKey="tx"
                              stroke="#5cc5a7"
                              strokeWidth={1.5}
                              fill="transparent"
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <Empty text="Агент начнёт накапливать историю после установки." />
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 text-[10px] text-zinc-400">
                      <div className="flex gap-4">
                        <span className="flex items-center gap-1.5">
                          <i className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          Приём
                        </span>
                        <span className="flex items-center gap-1.5">
                          <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Передача
                        </span>
                      </div>
                      <span>
                        За период: ↓{" "}
                        {bytes(history.reduce((s, p) => s + p.rx_bytes, 0))} · ↑{" "}
                        {bytes(history.reduce((s, p) => s + p.tx_bytes, 0))}
                      </span>
                    </div>
                    {active?.history_error && (
                      <p className="mt-2 text-[10px] text-orange-500">
                        {active.history_error}
                      </p>
                    )}
                  </Card>
                  <Card className="p-5">
                    <div className="mb-5 flex items-center justify-between">
                      <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheck size={16} className="text-zinc-400" />
                        Состояние накопителей
                      </h2>
                      <button
                        onClick={() => setView("storage")}
                        aria-label="Все накопители"
                        className="text-zinc-400 hover:text-blue-500 cursor-pointer"
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    {allDisks.length ? (
                      <>
                        <div className="mb-5 flex items-center gap-3 rounded-xl bg-[#f7f8fa] px-3 py-3">
                          <div
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                              warnings.length
                                ? "bg-orange-100/60 text-orange-500"
                                : "bg-emerald-100/60 text-emerald-500",
                            )}
                          >
                            {warnings.length ? (
                              <AlertTriangle size={18} />
                            ) : (
                              <Check size={18} />
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-medium">
                              {warnings.length
                                ? "Предупреждения SMART"
                                : allDisks.some((d) => d.health === "unknown")
                                  ? "SMART: неполные данные"
                                  : "SMART: ошибок не обнаружено"}
                            </div>
                            <div className="mt-1 text-[10px] text-zinc-400">
                              {warnings.length
                                ? `${warnings.length} из ${allDisks.length} требуют проверки`
                                : allDisks.some((d) => d.health === "unknown")
                                  ? "Для части дисков SMART недоступен"
                                  : "Предупреждений SMART нет"}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-4">
                          {online.slice(0, 4).map((h) => (
                            <button
                              key={h.id}
                              onClick={() => {
                                setSelected(h.id);
                                setView("storage");
                              }}
                              className="flex w-full items-center gap-2 text-left cursor-pointer"
                            >
                              <Server size={14} className="text-zinc-400" />
                              <span className="min-w-0 flex-1 truncate text-[11px]">
                                {h.name}
                              </span>
                              <div className="flex gap-1">
                                {h.metrics?.disks.map((d) => (
                                  <span
                                    key={d.name}
                                    title={`${d.name}: ${healthText(d.health)}`}
                                    className={cn(
                                      "h-1.5 w-4 rounded-full",
                                      d.health === "healthy"
                                        ? "bg-emerald-400/75"
                                        : d.health === "unknown"
                                          ? "bg-zinc-300"
                                          : "bg-orange-400",
                                    )}
                                  />
                                ))}
                              </div>
                              <span className="w-14 text-right text-[10px] text-zinc-400">
                                {h.metrics?.disks.length} диска
                              </span>
                              <ChevronRight
                                size={11}
                                className="text-zinc-300"
                              />
                            </button>
                          ))}
                        </div>
                        <div className="mt-5 border-t border-black/5 pt-3 text-[10px] leading-relaxed text-zinc-400">
                          SMART проверяется каждую минуту.
                          <br />
                          Подробности доступны в разделе накопителей.
                        </div>
                      </>
                    ) : (
                      <Empty text="Состояние появится после подключения агента." />
                    )}
                  </Card>
                </div>
              )}
            </>
          )}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#b0b2b9]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={12} />
              Локальный мониторинг
            </span>
            <span>
              {updated
                ? `Последнее обновление ${new Date(updated * 1000).toLocaleTimeString("ru-RU")}`
                : "Ожидание данных"}
              <span className="mx-2">·</span>Homelab v0.1
            </span>
          </footer>
        </div>
      </main>
      <AddServer
        onDownload={downloadAgent}
        open={add}
        onOpenChange={setAdd}
        request={request}
        onAdded={() => {
          setShowDemo(false);
          load();
        }}
      />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Сбор и хранение метрик
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-zinc-500">
            Агент на каждом Linux-сервере собирает метрики и хранит историю 90
            дней. Центральный сервис опрашивает его каждые 10 секунд и догружает
            историю после отключений.
          </DialogDescription>
          <div className="mt-6 space-y-4 text-sm text-zinc-600">
            <p>
              <strong className="text-zinc-800">1. Установите агент</strong>
              <br />
              Инструкция и systemd-сервисы находятся в README проекта.
            </p>
            <p>
              <strong className="text-zinc-800">2. Подключите сервер</strong>
              <br />
              Введите IP, порт 9108 и уникальный токен агента.
            </p>
            <p>
              <strong className="text-zinc-800">3. Наблюдайте</strong>
              <br />
              CPU, память, GPU при поддержке драйвера, диски и сетевой трафик.
              SMART требует smartmontools и прав на чтение дисков.
            </p>
            <p className="rounded-xl bg-zinc-50 p-3 text-xs leading-5">
              Графики усредняются по 5 минутам, за 90 дней — по 6 часам.
              Скорость указана в байтах в секунду. На сетевых мостах счётчики
              могут дублироваться: задайте интерфейсы через HOMELAB_INTERFACES.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={auth} onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">
            Доступ к дашборду
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-zinc-500">
            Введите HOMELAB_DASHBOARD_TOKEN центрального сервиса.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem("homelab-token", authDraft);
              setToken(authDraft);
            }}
            className="mt-5 space-y-4"
          >
            <input
              aria-label="Токен дашборда"
              type="password"
              value={authDraft}
              onChange={(e) => setAuthDraft(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm"
              autoComplete="current-password"
            />
            {error && (
              <p role="alert" className="text-xs text-red-500">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full">
              Войти
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          {detail && (
            <>
              <DialogTitle className="text-xl font-semibold">
                {detail.name}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs text-zinc-500">
                {detail.ip}:{detail.port} ·{" "}
                {detail.metrics?.os || "ОС неизвестна"}
                {detail.demo ? " · Демонстрационные данные" : ""}
              </DialogDescription>
              <HostDetails host={detail} />
              <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-zinc-100 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelected(detail.id);
                    setDetailId(null);
                    setView("network");
                  }}
                >
                  <Network size={13} />
                  История сети
                </Button>
                {!detail.demo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500"
                    onClick={() => {
                      setDeleteTarget(detail.id);
                      setDetailId(null);
                    }}
                  >
                    <Trash2 size={13} />
                    Удалить сервер
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">
            Удалить сервер из дашборда?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm text-zinc-500">
            {hosts.find((h) => h.id === deleteTarget)?.name}: локальная копия
            истории будет удалена. Агент и его собственная история останутся на
            сервере.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDeleteTarget(null)}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={async () => {
                setDeleteBusy(true);
                try {
                  await request("/hosts/" + deleteTarget, { method: "DELETE" });
                  setDeleteTarget(null);
                  setSelected(null);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "Удаление…" : "Удалить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Summary({
  icon: Icon,
  title,
  value,
  unit,
  detail,
  color,
  footer,
}: {
  icon: typeof Server;
  title: string;
  value: string;
  unit?: string;
  detail: string;
  color: string;
  footer: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-500",
    purple: "bg-violet-50 text-violet-400",
    orange: "bg-orange-50 text-orange-400",
    green: "bg-emerald-50 text-emerald-500",
  };
  return (
    <Card className="p-4 xl:p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">{title}</span>
        <div className={cn("rounded-lg p-1.5", colors[color])}>
          <Icon size={15} strokeWidth={1.7} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[27px] leading-none font-semibold tracking-[-1px]">
          {value}
        </span>
        <span className="text-base font-normal text-zinc-300">{unit}</span>
      </div>
      <div className="mt-2 min-h-4 text-[10px] text-zinc-400">{detail}</div>
      <div className="mt-4 flex h-3 items-center gap-2 text-[9px] text-zinc-400">
        {footer}
      </div>
    </Card>
  );
}
function ServerCard({
  host: h,
  selected,
  onClick,
}: {
  host: Host;
  selected: boolean;
  onClick: () => void;
}) {
  const m = h.metrics,
    warn = m?.disks.some((d) => ["warning", "failed"].includes(d.health));
  return (
    <button
      onClick={onClick}
      className={cn(
        "group appearance-none rounded-2xl border bg-white p-5 text-left shadow-[0_2px_8px_#00000003] transition-all hover:shadow-md cursor-pointer",
        selected
          ? "border-[#007aff55] ring-1 ring-[#007aff08]"
          : "border-black/[.065]",
      )}
    >
      <div className="mb-5 flex items-center gap-3">
        <div
          className={cn(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            m?.platform === "Proxmox"
              ? "bg-[#fff4e9] text-[#df9b56]"
              : "bg-[#eef2fb] text-[#8e9dc9]",
          )}
        >
          <Server size={23} strokeWidth={1.3} />
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
              h.online ? "bg-emerald-400" : "bg-zinc-300",
            )}
          />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold tracking-[-.2px]">
            {h.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
            <span>{h.ip}</span>
            <span className="rounded border border-zinc-100 bg-zinc-50 px-1.5 py-px text-[8px]">
              {m?.platform === "Proxmox"
                ? "Proxmox"
                : m?.os.startsWith("Ubuntu")
                  ? "Ubuntu"
                  : "Linux"}
            </span>
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px]",
              h.online
                ? "bg-emerald-50 text-emerald-600"
                : "bg-zinc-100 text-zinc-400",
            )}
          >
            {h.online ? "В сети" : "Недоступен"}
          </span>
          {h.demo && <span className="text-[8px] text-zinc-300">ДЕМО</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Meter
          label="CPU"
          value={h.online ? m?.cpu.usage : null}
          detail={m ? `${m.cpu.cores} потоков` : undefined}
        />
        <Meter
          label="Память"
          value={h.online ? m?.memory.percent : null}
          detail={
            m
              ? `${bytes(m.memory.used, 0)} / ${bytes(m.memory.total, 0)}`
              : undefined
          }
        />
        {!!m?.gpus.length && (
          <Meter
            label="GPU"
            value={h.online ? m.gpus[0].usage : null}
            detail={m.gpus[0].name}
          />
        )}
        <div className={m?.gpus.length ? "" : "col-span-2"}>
          <div className="mb-2 flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">
              Накопители{" "}
              <span className="ml-1 text-zinc-300">{m?.disks.length || 0}</span>
            </span>
            <span
              className={cn(
                "flex items-center gap-1",
                warn ? "text-orange-500" : "text-zinc-400",
              )}
            >
              {warn && <AlertTriangle size={10} />}{" "}
              {m ? bytes(m.disks.reduce((s, d) => s + d.used, 0)) : "—"}{" "}
              <span className="text-zinc-300">
                / {m ? bytes(m.disks.reduce((s, d) => s + d.total, 0)) : "—"}
              </span>
            </span>
          </div>
          <div className="flex gap-1">
            {m?.disks.map((d) => (
              <div
                key={d.name}
                className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    d.health === "warning" || d.health === "failed"
                      ? "bg-orange-300"
                      : "bg-[#b5c4d5]",
                  )}
                  style={{
                    width: Math.min(100, (d.used / d.total) * 100) + "%",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-black/5 pt-3 text-[10px] text-zinc-400">
        <div className="flex gap-3">
          <span className="flex items-center gap-1">
            <ArrowDown size={10} className="text-blue-400" />
            {h.online ? speed(m?.network.rx || 0) : "—"}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp size={10} className="text-emerald-400" />
            {h.online ? speed(m?.network.tx || 0) : "—"}
          </span>
        </div>
        <span className="flex items-center gap-1">
          {h.online && m
            ? `${Math.floor(m.uptime / 86400)} д. в работе`
            : "Нет связи"}
          <ChevronRight
            size={11}
            className={selected ? "text-blue-400" : "text-zinc-300"}
          />
        </span>
      </div>
      {!h.online && h.error && (
        <p
          className="mt-2 truncate text-[10px] text-orange-500"
          title={h.error}
        >
          {h.error}
        </p>
      )}
    </button>
  );
}
function Meter({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  detail?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex justify-between gap-2 text-[10px]">
        <span className="text-zinc-400">{label}</span>
        <span className="font-medium text-zinc-600">{percent(value)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={cn(
            "h-full rounded-full",
            label === "CPU"
              ? "bg-[#92bdf7]"
              : label === "GPU"
                ? "bg-[#b3a5e6]"
                : "bg-[#b5acd9]",
          )}
          style={{ width: Math.max(0, Math.min(value || 0, 100)) + "%" }}
        />
      </div>
      {detail && (
        <div
          title={detail}
          className="mt-1.5 truncate text-[8px] text-zinc-400"
        >
          {detail}
        </div>
      )}
    </div>
  );
}
function healthText(h: string) {
  return h === "healthy"
    ? "В норме"
    : h === "warning"
      ? "Проверить"
      : h === "failed"
        ? "Критическое"
        : "SMART недоступен";
}
function DiskList({ disks }: { disks: Disk[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-zinc-100">
      {disks.map((d) => (
        <div key={d.name}>
          <button
            onClick={() => setOpen(open === d.name ? null : d.name)}
            className="flex w-full flex-wrap items-center gap-3 py-4 text-left cursor-pointer"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-50 text-zinc-400">
              <HardDrive size={20} strokeWidth={1.4} />
            </div>
            <div className="min-w-[130px] flex-1">
              <div className="text-xs font-medium">{d.model}</div>
              <div className="mt-1 text-[10px] text-zinc-400">
                /dev/{d.name} · {d.type} · {bytes(d.total)}
                {d.temperature != null ? ` · ${d.temperature} °C` : ""}
              </div>
            </div>
            <div className="min-w-[120px] flex-1 sm:max-w-60">
              <div className="mb-1.5 text-[10px] text-zinc-400">
                {d.volumes.length
                  ? `${bytes(d.used)} занято в томах`
                  : "Нет смонтированных томов"}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-blue-300"
                  style={{
                    width: Math.min(100, (d.used / d.total) * 100) + "%",
                  }}
                />
              </div>
            </div>
            <span
              className={cn(
                "ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px]",
                d.health === "healthy"
                  ? "bg-emerald-50 text-emerald-600"
                  : d.health === "unknown"
                    ? "bg-zinc-100 text-zinc-400"
                    : "bg-orange-50 text-orange-500",
              )}
            >
              {d.health === "healthy" ? (
                <Check size={11} />
              ) : d.health === "unknown" ? (
                <CircleHelp size={11} />
              ) : (
                <AlertTriangle size={11} />
              )}{" "}
              {healthText(d.health)}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "text-zinc-400 transition-transform",
                open === d.name && "rotate-180",
              )}
            />
          </button>
          {open === d.name && (
            <div className="mb-4 rounded-xl bg-zinc-50 p-4 text-xs text-zinc-500 appear">
              {d.warning && <p className="mb-3 text-orange-600">{d.warning}</p>}
              {d.health === "unknown" && (
                <p className="mb-3">
                  Установите smartmontools и предоставьте агенту права чтения
                  SMART.
                </p>
              )}
              {d.volumes.map((v) => (
                <div key={v.mount} className="mb-2 flex justify-between gap-3">
                  <code>{v.mount}</code>
                  <span>
                    {bytes(v.used)} / {bytes(v.total)} · свободно{" "}
                    {bytes(Math.max(0, v.total - v.used))}
                  </span>
                </div>
              ))}
              <p className="mt-3 text-[10px] text-zinc-400">
                Занятое место рассчитано по смонтированным файловым системам.
                RAID, ZFS и LVM могут объединять несколько физических дисков;
                объём тома не равен ёмкости отдельного диска.
              </p>
            </div>
          )}
        </div>
      ))}
      {!disks.length && <Empty text="Данные о накопителях пока недоступны." />}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-28 items-center justify-center px-5 text-center text-xs leading-5 text-zinc-400">
      {text}
    </div>
  );
}
function AddServer({
  open,
  onOpenChange,
  request,
  onAdded,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  request: (path: string, options?: RequestInit) => Promise<any>;
  onAdded: () => void;
  onDownload: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [ip, setIp] = useState(""),
    [port, setPort] = useState("9108"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const cmd = "sudo python3 deploy/install_agent.py";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="mb-5 inline-flex rounded-2xl bg-blue-50 p-3 text-blue-500">
          <Server size={25} strokeWidth={1.5} />
        </div>
        <DialogTitle className="text-[22px] font-semibold tracking-[-.6px]">
          Добавить сервер
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-zinc-400">
          Добавьте Linux-сервер с установленным агентом. Мы проверим подключение
          и загрузим его историю.
        </DialogDescription>
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request("/hosts", {
                method: "POST",
                body: JSON.stringify({ name, ip, port: Number(port), token }),
              });
              onAdded();
              onOpenChange(false);
              setToken("");
              setIp("");
              setName("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block text-xs font-medium">
            Название{" "}
            <span className="font-normal text-zinc-400">· необязательно</span>
            <input
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, домашний сервер"
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
            />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 text-xs font-medium">
              IP-адрес
              <input
                required
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.10"
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
              />
            </label>
            <label className="block w-24 text-xs font-medium">
              Порт
              <input
                required
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
              />
            </label>
          </div>
          <label className="block text-xs font-medium">
            Токен агента
            <input
              required
              type="password"
              minLength={24}
              maxLength={256}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="HOMELAB_AGENT_TOKEN"
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
            />
          </label>
          <div className="rounded-xl bg-zinc-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
              <Terminal size={13} />
              Агент ещё не запущен?
            </div>
            <p className="mb-2 text-[10px] leading-4 text-zinc-400">
              Скачайте архив, перенесите на Linux-хост и распакуйте. Из каталога
              homelab-agent запустите установщик. Токен будет в
              /etc/homelab/agent.env.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-3"
              onClick={async () => {
                try {
                  await onDownload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download size={13} />
              Скачать Linux-агент
            </Button>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[9px] text-zinc-500">
                {cmd}
              </code>
              <button
                type="button"
                aria-label="Скопировать команду агента"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(cmd);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError(
                      "Буфер обмена недоступен. Скопируйте команду вручную.",
                    );
                  }
                }}
                className="text-zinc-400 cursor-pointer"
              >
                {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs text-red-500"
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <Loader2 size={15} className="spinner" />
            ) : (
              <Plus size={15} />
            )}{" "}
            {busy ? "Проверяем подключение…" : "Добавить сервер"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function HostDetails({ host }: { host: Host }) {
  const m = host.metrics;
  if (!m)
    return (
      <Empty text="Метрики ещё не получены. Проверьте подключение агента." />
    );
  return (
    <div className="mt-6 space-y-6">
      {m.diagnostics &&
        Object.entries(m.diagnostics).map(([key, value]) => (
          <p
            key={key}
            role="status"
            className="rounded-lg bg-orange-50 p-3 text-xs text-orange-600"
          >
            {key}: {value}
          </p>
        ))}
      {!host.online && (
        <div
          role="status"
          className="rounded-lg bg-orange-50 p-3 text-xs text-orange-600"
        >
          Сервер недоступен. Последние данные:{" "}
          {new Date(m.timestamp * 1000).toLocaleString("ru-RU")}. {host.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-5 rounded-xl bg-zinc-50 p-4">
        <Meter
          label="CPU"
          value={host.online ? m.cpu.usage : null}
          detail={`${m.cpu.model} · ${m.cpu.cores} потоков`}
        />
        <Meter
          label="Память"
          value={host.online ? m.memory.percent : null}
          detail={`${bytes(m.memory.used)} / ${bytes(m.memory.total)}`}
        />
      </div>
      <div>
        <h3 className="mb-3 text-xs font-semibold">Система</h3>
        <dl className="grid grid-cols-2 gap-y-3 text-xs">
          <dt className="text-zinc-400">Имя хоста</dt>
          <dd className="text-right">{m.hostname}</dd>
          <dt className="text-zinc-400">Время работы</dt>
          <dd className="text-right">
            {Math.floor(m.uptime / 86400)} д.{" "}
            {Math.floor((m.uptime % 86400) / 3600)} ч.
          </dd>
          <dt className="text-zinc-400">Сетевые интерфейсы</dt>
          <dd className="text-right">
            {m.network.interfaces.join(", ") || "Нет данных"}
          </dd>
          <dt className="text-zinc-400">Приём / передача</dt>
          <dd className="text-right">
            {host.online
              ? `${speed(m.network.rx)} / ${speed(m.network.tx)}`
              : "—"}
          </dd>
        </dl>
      </div>
      {!!m.gpus.length && (
        <div>
          <h3 className="mb-3 text-xs font-semibold">Видеокарты</h3>
          <div className="space-y-3">
            {m.gpus.map((gpu, index) => (
              <div
                key={index}
                className="rounded-xl border border-zinc-100 p-4"
              >
                <Meter
                  label="GPU"
                  value={host.online ? gpu.usage : null}
                  detail={gpu.name}
                />
                <p className="mt-3 text-[11px] text-zinc-400">
                  VRAM {bytes(gpu.memory_used)} / {bytes(gpu.memory_total)}
                  {gpu.temperature != null ? ` · ${gpu.temperature} °C` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="text-xs font-semibold">Накопители · {m.disks.length}</h3>
        <DiskList disks={m.disks} />
      </div>
    </div>
  );
}
