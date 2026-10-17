import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useLocation,
} from "react-router";
import {
  HistoryChart,
  PeriodSelector,
  type HistoryPeriod,
} from "./components/resource-history";
import { ServerPage } from "./components/server-page";
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
  Terminal,
  Command,
  LogOut,
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
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from "./components/ui/drawer";
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
const viewPaths: Record<View, string> = {
  overview: "/",
  servers: "/servers",
  storage: "/storage",
  network: "/network",
};
function App({ view }: { view: View }) {
  const navigate = useNavigate();
  const { serverId: detailId } = useParams();
  const { hash } = useLocation();
  const setView = (next: View) => navigate(viewPaths[next]);
  const [hosts, setHosts] = useState<Host[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [token, setToken] = useState(sessionStorage.getItem("homelab-token") || "");
  const [authDraft, setAuthDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [add, setAdd] = useState(false),
    [period, setPeriod] = useState<HistoryPeriod>(1),
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
  const detail = hosts.find((h) => h.id === detailId);
  const active = detailId
    ? detail
    : eligible.find((h) => h.id === selected) || eligible[0];
  useEffect(() => {
    document.title = `${detailId ? detail?.name || "Сервер" : labels[view]} — homelab-dashboard`;
    if (hash && detail) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [detailId, detail?.name, view, hash]);
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
  const rx = metrics.reduce((s, m) => s + m.network.rx, 0),
    tx = metrics.reduce((s, m) => s + m.network.tx, 0),
    warnings = allDisks.filter((d) => ["warning", "failed"].includes(d.health));
  return (
    <div className="min-h-screen lg:flex">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[218px] flex-col border-r border-black/[0.055] bg-white px-4 py-7 lg:flex">
        <Link
          to="/"
          className="mb-10 flex items-center gap-2.5 px-3 no-underline text-inherit"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#27292e] text-white shadow-sm">
            <Command size={18} />
          </div>
          <span className="text-[19px] font-semibold tracking-[-.7px]">
            homelab<span className="text-blue-700">.</span>
          </span>
        </Link>
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
            <Link
              key={id}
              to={viewPaths[id]}
              aria-current={view === id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] transition-colors cursor-pointer",
                view === id
                  ? "bg-blue-50 font-semibold text-blue-700"
                  : "text-muted-foreground hover:bg-black/3",
              )}
            >
              <Icon
                size={17}
                strokeWidth={1.7}
                className={view === id ? "text-blue-700" : ""}
              />
              {labels[id]}
              {id === "servers" && (
                <span className="ml-auto rounded bg-black/4 px-1.5 text-[12px] text-muted-foreground">
                  {visible.length}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {token && (
          <div className="mt-auto pt-6">
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => {
                sessionStorage.removeItem("homelab-token");
                setToken("");
                setAuth(true);
              }}
            >
              <LogOut size={16} className="shrink-0" />
              Выйти
            </Button>
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 lg:ml-[218px]">
        <header className="flex h-[70px] items-center justify-between gap-4 border-b border-black/[0.05] bg-white/60 px-5 lg:px-9">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Homelab</span>
            <ChevronRight size={12} className="text-muted-foreground" />
            <Link to={viewPaths[view]}>{labels[view]}</Link>
            {detailId && (
              <>
                <ChevronRight size={12} className="text-muted-foreground" />
                <span className="truncate">{detail?.name || "Сервер"}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 text-[14px] text-muted-foreground sm:flex">
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
                className={cn("text-muted-foreground", refreshing && "spinner")}
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
              asChild
            >
              <Link
                to={viewPaths[v]}
                aria-current={view === v ? "page" : undefined}
              >
                {labels[v]}
              </Link>
            </Button>
          ))}
        </nav>
        <div className="mx-auto max-w-[1510px] px-5 py-8 lg:px-9 lg:py-9">
          {!detailId && (
            <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-[14px] text-muted-foreground">
                  <span className="h-px w-5 bg-zinc-300" />
                  ИНФРАСТРУКТУРА
                </div>
                <h1 className="m-0 text-[30px] leading-tight font-semibold tracking-[-1.1px]">
                  {view === "overview" ? "Обзор" : labels[view]}
                </h1>
                <p className="mt-2 mb-0 text-[14px] text-muted-foreground">
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
                className="rounded-[9px] px-4 text-sm"
              >
                <Plus size={16} />
                Добавить сервер
              </Button>
            </div>
          )}
          {hosts.some((h) => h.demo) && showDemo && !detailId && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[14px] text-blue-700">
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
              className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
              <button onClick={load} className="ml-3 underline cursor-pointer">
                Повторить
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="spinner" size={18} />
              Загрузка метрик…
            </div>
          ) : detailId ? (
            detail ? (
              <ServerPage
                host={detail}
                period={period}
                onPeriodChange={setPeriod}
                records={history}
                loading={historyLoading}
                error={historyError}
                end={updated || Date.now() / 1000}
                onDelete={() => setDeleteTarget(detail.id)}
              >
                <HostDetails host={detail} />
              </ServerPage>
            ) : (
              <Card className="p-8">
                <h1 className="text-xl font-semibold">Сервер не найден</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {error
                    ? "Не удалось загрузить серверы. Повторите запрос."
                    : "Сервер удалён или адрес указан неверно."}
                </p>
                <Button asChild className="mt-5">
                  <Link to="/servers">Все серверы</Link>
                </Button>
              </Card>
            )
          ) : (
            <>
              {(view === "overview" || view === "network") && (
                <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
                  <Summary
                    icon={Server}
                    title="Серверы"
                    value={String(online.length)}
                    unit={`/ ${eligible.length}`}
                    detail="в сети"
                    color="blue"
                    footer={
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {eligible.length - online.length
                          ? `${eligible.length - online.length} недоступно`
                          : eligible.length
                            ? "Серверы доступны"
                            : "Нет подключённых серверов"}
                      </>
                    }
                  />
                  <Summary
                    icon={Cpu}
                    title="Процессор"
                    value={
                      metrics.some((m) => m.cpu.usage != null)
                        ? String(Math.round(cpu))
                        : "—"
                    }
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
                      <span className="rounded-md border border-black/5 bg-white px-1.5 py-0.5 text-[12px] text-muted-foreground">
                        {visible.length}
                      </span>
                    </div>
                    <label className="flex h-8 items-center gap-2 rounded-lg border border-black/[.06] bg-white px-2.5 text-muted-foreground">
                      <Search size={13} />
                      <input
                        aria-label="Найти сервер"
                        placeholder="Найти сервер…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-32 bg-transparent text-[14px] text-zinc-700 outline-none focus:shadow-none sm:w-40"
                      />
                    </label>
                  </div>
                  <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {visible.map((h) => (
                      <ServerCard
                        key={h.id}
                        host={h}
                        selected={active?.id === h.id}
                      />
                    ))}
                    {!visible.length && (
                      <Card className="col-span-full flex flex-col items-center py-14 text-center">
                        <div className="mb-4 rounded-2xl bg-blue-50 p-4 text-blue-700">
                          <Server size={28} strokeWidth={1.4} />
                        </div>
                        <h3 className="text-lg font-medium">
                          {search
                            ? "Серверы не найдены"
                            : "Нет подключённых серверов"}
                        </h3>
                        <p className="mb-5 max-w-sm text-sm text-muted-foreground">
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
                        <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
                          <Server size={19} />
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold">
                            <Link
                              to={`/servers/${encodeURIComponent(h.id)}`}
                              className="hover:text-blue-700"
                            >
                              {h.name}
                            </Link>
                          </h2>
                          <p className="text-[14px] text-muted-foreground">
                            {h.ip} · {h.online ? "В сети" : "Недоступен"}
                            {h.demo ? " · Демо" : ""}
                          </p>
                        </div>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                        >
                          <Link
                            to={`/servers/${encodeURIComponent(h.id)}#disk-activity`}
                          >
                            История дисков <ArrowUpRight size={14} />
                          </Link>
                        </Button>
                      </div>
                      {!h.online && (
                        <p className="mb-3 text-sm text-orange-700">
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
                          <Network
                            size={16}
                            className="text-muted-foreground"
                          />
                          Сетевая активность
                        </h2>
                        <label className="mt-2 block">
                          <span className="sr-only">Сервер для графика</span>
                          <select
                            aria-label="Сервер для графика"
                            value={active?.id || ""}
                            onChange={(e) => setSelected(e.target.value)}
                            className="max-w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-muted-foreground"
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
                      <PeriodSelector value={period} onChange={setPeriod} />
                    </div>
                    <div className="mb-2 flex items-center gap-7">
                      <div>
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <ArrowDown size={11} className="text-blue-700" />
                          Приём сейчас
                        </span>
                        <span className="text-xl font-medium tracking-[-.6px]">
                          {active?.online
                            ? speed(active.metrics?.network.rx || 0)
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <ArrowUp size={11} className="text-emerald-700" />
                          Передача сейчас
                        </span>
                        <span className="text-xl font-medium tracking-[-.6px]">
                          {active?.online
                            ? speed(active.metrics?.network.tx || 0)
                            : "—"}
                        </span>
                      </div>
                      <div className="ml-auto hidden text-right text-[12px] leading-5 text-muted-foreground sm:block">
                        <div>По всем серверам</div>
                        <div>
                          ↓ {speed(rx)} &nbsp; ↑ {speed(tx)}
                        </div>
                      </div>
                    </div>
                    <div className="pt-4">
                      <HistoryChart
                        records={history}
                        period={period}
                        end={updated || Date.now() / 1000}
                        loading={historyLoading}
                        error={historyError}
                        series={[
                          { key: "rx", label: "Приём", color: "#0066cc" },
                          { key: "tx", label: "Передача", color: "#087f6f" },
                        ]}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 text-[12px] text-muted-foreground">
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
                      <p className="mt-2 text-[12px] text-orange-700">
                        {active.history_error}
                      </p>
                    )}
                  </Card>
                  <Card className="p-5">
                    <div className="mb-5 flex items-center justify-between">
                      <h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheck
                          size={16}
                          className="text-muted-foreground"
                        />
                        Состояние накопителей
                      </h2>
                      <button
                        onClick={() => setView("storage")}
                        aria-label="Все накопители"
                        className="text-muted-foreground hover:text-blue-700 cursor-pointer"
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
                                ? "bg-orange-100/60 text-orange-700"
                                : "bg-emerald-100/60 text-emerald-700",
                            )}
                          >
                            {warnings.length ? (
                              <AlertTriangle size={18} />
                            ) : (
                              <Check size={18} />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium">
                              {warnings.length
                                ? "Предупреждения SMART"
                                : allDisks.some((d) => d.health === "unknown")
                                  ? "SMART: неполные данные"
                                  : "SMART: ошибок не обнаружено"}
                            </div>
                            <div className="mt-1 text-[12px] text-muted-foreground">
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
                              <Server
                                size={14}
                                className="text-muted-foreground"
                              />
                              <span className="min-w-0 flex-1 truncate text-[14px]">
                                {h.name}
                              </span>
                              <div className="flex gap-1">
                                {h.metrics?.disks.map((d) => (
                                  <span
                                    key={d.name}
                                    title={`${d.name}: ${healthText(d.health)}${d.smart_state ? ` · ${diskPowerText(d)}${d.smart_state !== "fresh" && d.smart_updated_at ? " · SMART ранее" : ""}` : ""}`}
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
                              <span className="w-14 text-right text-[12px] text-muted-foreground">
                                {h.metrics?.disks.length} диска
                              </span>
                              <ChevronRight
                                size={11}
                                className="text-muted-foreground"
                              />
                            </button>
                          ))}
                        </div>
                        <div className="mt-5 border-t border-black/5 pt-3 text-[12px] leading-relaxed text-muted-foreground">
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
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
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
        open={add}
        onOpenChange={setAdd}
        request={request}
        onAdded={() => {
          setShowDemo(false);
          load();
        }}
      />
      <Dialog open={auth} onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">
            Доступ к дашборду
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
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
              <p role="alert" className="text-sm text-red-700">
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
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">
            Удалить сервер из дашборда?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm text-muted-foreground">
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
                  if (detailId) navigate("/servers");
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
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-violet-50 text-violet-700",
    orange: "bg-orange-50 text-orange-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <Card className="p-4 xl:p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[14px] text-muted-foreground">{title}</span>
        <div className={cn("rounded-lg p-1.5", colors[color])}>
          <Icon size={15} strokeWidth={1.7} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[27px] leading-none font-semibold tracking-[-1px]">
          {value}
        </span>
        <span className="text-base font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      <div className="mt-2 min-h-4 text-[12px] text-muted-foreground">
        {detail}
      </div>
      <div className="mt-4 flex min-h-5 items-center gap-2 text-[12px] text-muted-foreground">
        {footer}
      </div>
    </Card>
  );
}
function ServerCard({ host: h, selected }: { host: Host; selected: boolean }) {
  const m = h.metrics,
    warn = m?.disks.some((d) => ["warning", "failed"].includes(d.health));
  return (
    <Link
      to={`/servers/${encodeURIComponent(h.id)}`}
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
              ? "bg-[#fff4e9] text-orange-800"
              : "bg-[#eef2fb] text-blue-700",
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
          <h3 className="truncate text-[14px] font-semibold tracking-[-.2px]">
            {h.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>{h.local ? "Этот сервер" : h.ip}</span>
            <span className="rounded border border-zinc-100 bg-zinc-50 px-1.5 py-px text-[12px]">
              {m?.platform === "Proxmox"
                ? "Proxmox"
                : m?.platform === "macOS"
                  ? "macOS"
                  : m?.os.startsWith("Ubuntu")
                    ? "Ubuntu"
                    : "Linux"}
            </span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {h.local ? "Сборщик" : "Агент"}: {m?.agent_version || "Неизвестна"}
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[12px]",
              h.online
                ? "bg-emerald-50 text-emerald-700"
                : "bg-zinc-100 text-muted-foreground",
            )}
          >
            {h.online ? "В сети" : "Недоступен"}
          </span>
          {h.demo && (
            <span className="text-[12px] text-muted-foreground">ДЕМО</span>
          )}
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
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-muted-foreground">
              Накопители{" "}
              <span className="ml-1 text-muted-foreground">
                {m?.disks.length || 0}
              </span>
            </span>
            <span
              className={cn(
                "flex items-center gap-1",
                warn ? "text-orange-700" : "text-muted-foreground",
              )}
            >
              {warn && <AlertTriangle size={10} />}{" "}
              {m ? bytes(m.disks.reduce((s, d) => s + d.used, 0)) : "—"}{" "}
              <span className="text-muted-foreground">
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
                    width:
                      (d.total ? Math.min(100, (d.used / d.total) * 100) : 0) +
                      "%",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-black/5 pt-3 text-[12px] text-muted-foreground">
        <div className="flex gap-3">
          <span className="flex items-center gap-1">
            <ArrowDown size={10} className="text-blue-700" />
            {h.online ? speed(m?.network.rx || 0) : "—"}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp size={10} className="text-emerald-700" />
            {h.online ? speed(m?.network.tx || 0) : "—"}
          </span>
        </div>
        <span className="flex items-center gap-1">
          {h.online && m
            ? `${Math.floor(m.uptime / 86400)} д. в работе`
            : "Нет связи"}
          <ChevronRight
            size={11}
            className={selected ? "text-blue-700" : "text-muted-foreground"}
          />
        </span>
      </div>
      {!h.online && h.error && (
        <p
          className="mt-2 truncate text-[12px] text-orange-700"
          title={h.error}
        >
          {h.error}
        </p>
      )}
    </Link>
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
      <div className="mb-2 flex justify-between gap-2 text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-muted-foreground">
          {percent(value)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={cn(
            "h-full rounded-full",
            label === "CPU"
              ? "bg-[#2563eb]"
              : label === "GPU"
                ? "bg-[#7c3aed]"
                : "bg-[#7c3aed]",
          )}
          style={{ width: Math.max(0, Math.min(value || 0, 100)) + "%" }}
        />
      </div>
      {detail && (
        <div
          title={detail}
          className="mt-1.5 truncate text-[12px] text-muted-foreground"
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
function diskPowerText(d: Disk) {
  if (d.power_state === "standby" || d.power_state === "sleep") return "Спит";
  if (d.power_state === "active") return "Активен";
  return "Режим неизвестен";
}
function diskSampleTime(value?: number | null) {
  return value == null
    ? "ещё не получены"
    : new Date(value * 1000).toLocaleString("ru-RU");
}
function DiskDetails({ disk: d }: { disk: Disk }) {
  const number = (value?: number | null, suffix = "") =>
    value == null ? "—" : value.toLocaleString("ru-RU") + suffix;
  const rows = [
    ["Серийный номер", d.serial || "—"],
    ["Прошивка", d.firmware || "—"],
    ["Интерфейс", d.interface?.toUpperCase() || "—"],
    [
      "Скорость вращения",
      d.type === "HDD" ? number(d.rotation_rate, " об/мин") : "Без вращения",
    ],
    ["Наработка", number(d.power_on_hours, " ч")],
    ["Включения", number(d.power_cycles)],
    ...(d.type === "NVMe"
      ? [
          ["Израсходованный ресурс", number(d.percentage_used, "%")],
          ["Доступный резерв", number(d.available_spare, "%")],
          ["Ошибки носителя", number(d.media_errors)],
        ]
      : [
          ["Переназначенные секторы", number(d.reallocated_sectors)],
          ["Ожидающие секторы", number(d.pending_sectors)],
          ["Неисправимые секторы", number(d.uncorrectable_sectors)],
        ]),
  ];
  return (
    <>
      {d.smart_state && (
        <div className="mb-4 space-y-1 text-[12px]">
          <p>
            {d.smart_state === "passive"
              ? "Автоматический SMART-опрос отключён: команды могут мешать таймеру сна и вызывать парковку головок. Показаны только метаданные и сохранённые показатели."
              : d.smart_state === "sleeping"
                ? "Диск спит. SMART и заполнение томов не опрашиваются; показаны последние сохранённые данные."
                : d.smart_state === "skipped"
                  ? "Опрос SMART пропущен: для этого подключения безопасная проверка сна не настроена."
                  : d.smart_state === "unsupported"
                    ? "Устройство не поддерживает безопасную проверку сна. SMART не опрашивается."
                    : d.smart_state === "unavailable"
                      ? "SMART недоступен. Проверьте права и наличие smartmontools 7.3 или новее. Повторный опрос без защиты сна не выполняется."
                      : "SMART получен при последнем опросе."}
          </p>
          <p>Данные SMART: {diskSampleTime(d.smart_updated_at)}</p>
          <p>Заполнение томов: {diskSampleTime(d.usage_updated_at)}</p>
        </div>
      )}
      <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-wrap justify-between gap-x-3 gap-y-1"
          >
            <dt className="text-[12px]">{label}</dt>
            <dd className="break-all text-[12px] font-medium text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
function DiskList({ disks }: { disks: Disk[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-zinc-100">
      {disks.map((d) => (
        <div key={d.name}>
          <button
            onClick={() => setOpen(open === d.name ? null : d.name)}
            aria-expanded={open === d.name}
            className="flex w-full flex-wrap items-center gap-3 py-4 text-left cursor-pointer"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-50 text-muted-foreground">
              <HardDrive size={20} strokeWidth={1.4} />
            </div>
            <div className="min-w-[130px] flex-1">
              <div className="text-sm font-medium">{d.model}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                /dev/{d.name} · {d.type} · {bytes(d.total)}
                {d.temperature != null
                  ? ` · ${d.temperature} °C${d.smart_state && d.smart_state !== "fresh" ? " (ранее)" : ""}`
                  : ""}
              </div>
            </div>
            {d.smart_state && (
              <span
                className={cn(
                  "rounded-full px-2 py-1 text-[12px]",
                  d.smart_state === "sleeping"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-zinc-100 text-muted-foreground",
                )}
              >
                {diskPowerText(d)}
              </span>
            )}
            <div className="min-w-[120px] flex-1 sm:max-w-60">
              <div className="mb-1.5 text-[12px] text-muted-foreground">
                {d.volumes.length
                  ? `${bytes(d.used)} занято в томах${d.smart_state && d.type === "HDD" && d.power_state !== "active" ? " (ранее)" : ""}`
                  : d.smart_state && !d.usage_updated_at
                    ? "Заполнение не опрашивалось"
                    : "Нет смонтированных томов"}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-blue-300"
                  style={{
                    width:
                      (d.total ? Math.min(100, (d.used / d.total) * 100) : 0) +
                      "%",
                  }}
                />
              </div>
            </div>
            <span
              className={cn(
                "ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px]",
                d.health === "healthy"
                  ? "bg-emerald-50 text-emerald-700"
                  : d.health === "unknown"
                    ? "bg-zinc-100 text-muted-foreground"
                    : "bg-orange-50 text-orange-700",
              )}
            >
              {d.health === "healthy" ? (
                <Check size={11} />
              ) : d.health === "unknown" ? (
                <CircleHelp size={11} />
              ) : (
                <AlertTriangle size={11} />
              )}{" "}
              {d.smart_state && d.smart_state !== "fresh" && d.smart_updated_at
                ? `${healthText(d.health)} · ранее`
                : healthText(d.health)}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "text-muted-foreground transition-transform",
                open === d.name && "rotate-180",
              )}
            />
          </button>
          {open === d.name && (
            <div className="mb-4 rounded-xl bg-zinc-50 p-4 text-sm text-muted-foreground appear">
              {d.warning && <p className="mb-3 text-orange-700">{d.warning}</p>}
              <DiskDetails disk={d} />
              {d.health === "unknown" && !d.smart_state && (
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
              <p className="mt-3 text-[12px] text-muted-foreground">
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
    <div className="flex h-full min-h-28 items-center justify-center px-5 text-center text-sm leading-5 text-muted-foreground">
      {text}
    </div>
  );
}
function AddServer({
  open,
  onOpenChange,
  request,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  request: (path: string, options?: RequestInit) => Promise<any>;
  onAdded: () => void;
}) {
  const [name, setName] = useState(""),
    [ip, setIp] = useState(""),
    [port, setPort] = useState("9108"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const cmd =
    "curl -fsSL https://raw.githubusercontent.com/nikitakiselev/homelab-dashboard/main/install.sh | sudo sh -s -- --agent";
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DrawerContent closeDisabled={busy}>
        <DrawerHeader>
          <DrawerTitle className="text-[22px] font-semibold tracking-[-.6px]">
            Добавить сервер
          </DrawerTitle>
          <DrawerDescription className="mt-2 text-sm leading-6 text-muted-foreground">
            Добавьте Linux-сервер с установленным агентом. Мы проверим
            подключение и загрузим его историю.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <form
            id="add-host-form"
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
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
            <label className="block text-sm font-medium">
              Название{" "}
              <span className="font-normal text-muted-foreground">
                · необязательно
              </span>
              <input
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, домашний сервер"
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
              />
            </label>
            <div className="flex gap-3">
              <label className="block min-w-0 flex-1 text-sm font-medium">
                IP-адрес
                <input
                  required
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.1.10"
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal"
                />
              </label>
              <label className="block w-24 text-sm font-medium">
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
            <label className="block text-sm font-medium">
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
              <div className="mb-2 flex items-center gap-2 text-[14px] text-muted-foreground">
                <Terminal size={13} />
                Установка агента на Linux
              </div>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-all break-all font-mono text-sm leading-6 text-zinc-700">
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
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-zinc-200/60"
                >
                  {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </form>
        </DrawerBody>
        <DrawerFooter>
          {error && (
            <p
              role="alert"
              className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button type="submit" form="add-host-form" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spinner" />
            ) : (
              <Plus size={15} />
            )}{" "}
            {busy ? "Проверяем подключение…" : "Добавить сервер"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {(Object.entries(viewPaths) as [View, string][]).map(([view, path]) => (
          <Route key={view} path={path} element={<App view={view} />} />
        ))}
        <Route path="/servers/:serverId" element={<App view="servers" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

function HostDetails({ host }: { host: Host }) {
  const m = host.metrics;
  if (!m)
    return (
      <Empty text="Метрики ещё не получены. Проверьте подключение агента." />
    );
  return (
    <div className="space-y-6">
      {m.diagnostics &&
        Object.entries(m.diagnostics).map(([key, value]) => (
          <p
            key={key}
            role="status"
            className="rounded-lg bg-orange-50 p-3 text-sm text-orange-700"
          >
            {key}: {value}
          </p>
        ))}
      {!host.online && (
        <div
          role="status"
          className="rounded-lg bg-orange-50 p-3 text-sm text-orange-700"
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
        <h3 className="mb-3 text-sm font-semibold">Система</h3>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-muted-foreground">
            Версия {host.local ? "сборщика" : "агента"}
          </dt>
          <dd className="text-right">{m.agent_version || "Неизвестна"}</dd>
          <dt className="text-muted-foreground">Имя хоста</dt>
          <dd className="text-right">{m.hostname}</dd>
          <dt className="text-muted-foreground">Время работы</dt>
          <dd className="text-right">
            {Math.floor(m.uptime / 86400)} д.{" "}
            {Math.floor((m.uptime % 86400) / 3600)} ч.
          </dd>
          <dt className="text-muted-foreground">Сетевые интерфейсы</dt>
          <dd className="text-right">
            {m.network.interfaces.join(", ") || "Нет данных"}
          </dd>
          <dt className="text-muted-foreground">Приём / передача</dt>
          <dd className="text-right">
            {host.online
              ? `${speed(m.network.rx)} / ${speed(m.network.tx)}`
              : "—"}
          </dd>
        </dl>
      </div>
      {!!m.gpus.length && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Видеокарты</h3>
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
                <p className="mt-3 text-[14px] text-muted-foreground">
                  {gpu.memory_used != null && gpu.memory_total != null
                    ? `VRAM ${bytes(gpu.memory_used)} / ${bytes(gpu.memory_total)}`
                    : gpu.shared_memory
                      ? "Общая системная память"
                      : "Объём видеопамяти недоступен"}
                  {gpu.temperature != null ? ` · ${gpu.temperature} °C` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Накопители · {m.disks.length}</h3>
        <DiskList disks={m.disks} />
      </div>
    </div>
  );
}

function NotFound() {
  useEffect(() => {
    document.title = "Страница не найдена — homelab-dashboard";
  }, []);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Страница не найдена</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Проверьте адрес или вернитесь к обзору серверов.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Открыть обзор</Link>
        </Button>
      </div>
    </main>
  );
}
