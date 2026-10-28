import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useParams,
  useLocation,
} from "react-router";
import { type HistoryPeriod } from "./components/resource-history";
import { NetworkHistory } from "./components/network-history";
import { ResourceRings } from "./components/resource-rings";
import { ServerPage } from "./components/server-page";
import { Launchpad } from "./components/launchpad";
import { readDashboardResponse } from "./dashboard-api";
import {
  LayoutGrid,
  House,
  Server,
  HardDrive,
  Plus,
  Search,
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
import { DiskStatus, getDiskStatus } from "./components/disk-status";
import "./index.css";

type View = "home" | "overview" | "servers" | "storage";
const labels: Record<View, string> = {
  home: "Главная",
  overview: "Обзор",
  servers: "Серверы",
  storage: "Накопители",
};
const viewPaths: Record<View, string> = {
  home: "/",
  overview: "/overview",
  servers: "/servers",
  storage: "/storage",
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
  const [dashboardVersion, setDashboardVersion] = useState<{
    version: string;
    commit?: string | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState(""),
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
      return readDashboardResponse(r, setAuth);
    },
    [token],
  );
  const load = useCallback(async () => {
    try {
      const d = await request("/hosts");
      setHosts(d.hosts);
      setDashboardVersion(d.version || null);
      setUpdated(d.timestamp);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [request]);
  useEffect(() => {
    if (view === "home") {
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, view]);
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
  const active = detail;
  useEffect(() => {
    document.title = `${detailId ? detail?.name || "Сервер" : labels[view]} — homelab-dashboard`;
    window.scrollTo(0, 0);
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
  const warnings = allDisks.filter((d) =>
    ["warning", "failed"].includes(d.health),
  );
  const smartUnchecked = allDisks.some(
    (d) =>
      d.health === "unknown" || (d.smart_state && d.smart_state !== "fresh"),
  );
  const smartPassive =
    allDisks.length > 0 && allDisks.every((d) => d.smart_state === "passive");
  return (
    <div className="min-h-screen lg:flex">
      {view !== "home" && (
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
                ["home", House],
                ["overview", LayoutGrid],
                ["servers", Server],
                ["storage", HardDrive],
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
          {dashboardVersion && (
            <div
              className="mt-6 px-3 text-[11px] text-muted-foreground"
              title={dashboardVersion.commit || undefined}
            >
              Dashboard{" "}
              {dashboardVersion.version === "development"
                ? "· разработка"
                : `v${dashboardVersion.version}`}
              {dashboardVersion.commit && (
                <span className="ml-1">
                  · {dashboardVersion.commit.slice(0, 7)}
                </span>
              )}
            </div>
          )}
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
      )}

      <main
        className={cn("min-w-0 flex-1", view !== "home" && "lg:ml-[218px]")}
      >
        {view !== "home" && (
          <>
            <header className="flex h-[56px] items-center justify-between gap-4 border-b border-black/[0.05] bg-white/60 px-5 lg:px-9">
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
                <div
                  tabIndex={0}
                  aria-describedby="last-update-tooltip"
                  className="group/update relative hidden cursor-help items-center gap-2 rounded text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 sm:flex"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      error ? "bg-orange-400" : "bg-emerald-500",
                    )}
                  />
                  {updated ? "Метрики · каждые 10 секунд" : "Подключение…"}
                  <span
                    id="last-update-tooltip"
                    role="tooltip"
                    className="absolute top-full right-0 z-30 hidden w-64 pt-2 group-hover/update:block group-focus-within/update:block"
                  >
                    <span className="block rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-5 text-foreground shadow-lg">
                      {updated
                        ? `Последнее обновление: ${new Date(updated * 1000).toLocaleString("ru-RU")}`
                        : "Данные ещё не получены"}
                    </span>
                  </span>
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
                    className={cn(
                      "text-muted-foreground",
                      refreshing && "spinner",
                    )}
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
            </nav>{" "}
          </>
        )}

        <div
          className={
            view === "home"
              ? undefined
              : "mx-auto max-w-[1510px] px-4 py-5 lg:px-6 lg:py-6"
          }
        >
          {view === "home" ? (
            <Launchpad request={request} />
          ) : (
            <>
              {!detailId && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="mb-1.5 flex items-center gap-2 text-[14px] text-muted-foreground">
                      <span className="h-px w-5 bg-zinc-300" />
                      ИНФРАСТРУКТУРА
                    </div>
                    <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-1.1px]">
                      {view === "overview" ? "Обзор" : labels[view]}
                    </h1>
                    <p className="mt-2 mb-0 text-[14px] text-muted-foreground">
                      {view === "overview"
                        ? "Состояние серверов и использование ресурсов."
                        : view === "storage"
                          ? "Состояние дисков, заполнение и SMART."
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
                  <button
                    onClick={load}
                    className="ml-3 underline cursor-pointer"
                  >
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
                    system={<HostDetails host={detail} />}
                    disks={
                      <DiskList
                        disks={detail.metrics?.disks || []}
                        online={detail.online}
                      />
                    }
                  />
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
                  {view === "overview" && (
                    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
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
                              {metrics.reduce((s, m) => s + m.cpu.cores, 0)}{" "}
                              потоков
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
                      <div className="mb-5 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {visible.map((h) => (
                          <ServerCard key={h.id} host={h} />
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
                        <Card key={h.id} className="min-w-0 px-4">
                          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 py-3">
                            <div className="shrink-0 rounded-lg bg-blue-50 p-2 text-blue-700">
                              <Server size={19} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h2 className="break-words text-sm font-semibold">
                                <Link
                                  to={`/servers/${encodeURIComponent(h.id)}`}
                                  className="hover:text-blue-700"
                                >
                                  {h.name}
                                </Link>
                              </h2>
                              <p className="break-words text-xs text-muted-foreground">
                                {h.ip} · {h.online ? "В сети" : "Недоступен"}
                                {h.demo ? " · Демо" : ""}
                              </p>
                            </div>
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="ml-auto shrink-0"
                            >
                              <Link
                                to={`/servers/${encodeURIComponent(h.id)}#disk-activity`}
                              >
                                Чтение и запись <ArrowUpRight size={14} />
                              </Link>
                            </Button>
                          </div>
                          {!h.online && (
                            <p className="mb-3 text-sm text-orange-700">
                              Последние доступные данные. Сервер не в сети.
                            </p>
                          )}
                          <DiskList
                            disks={h.metrics?.disks || []}
                            online={h.online}
                          />
                        </Card>
                      ))}
                      {!visible.length && (
                        <Empty text="Добавьте сервер, чтобы увидеть его накопители." />
                      )}
                    </div>
                  )}
                  {view === "overview" && (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
                      <NetworkHistory
                        hosts={eligible}
                        request={request}
                        period={period}
                        onPeriodChange={setPeriod}
                        end={updated || Date.now() / 1000}
                      />
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
                                    : smartUnchecked
                                      ? "bg-zinc-200/60 text-muted-foreground"
                                      : "bg-emerald-100/60 text-emerald-700",
                                )}
                              >
                                {warnings.length ? (
                                  <AlertTriangle size={18} />
                                ) : smartUnchecked ? (
                                  <CircleHelp size={18} />
                                ) : (
                                  <Check size={18} />
                                )}
                              </div>
                              <div>
                                <div className="text-sm font-medium">
                                  {warnings.length
                                    ? "Предупреждения SMART"
                                    : smartPassive
                                      ? "SMART: опрос отключён"
                                      : smartUnchecked
                                        ? "SMART: неполные данные"
                                        : "SMART: ошибок не обнаружено"}
                                </div>
                                <div className="mt-1 text-[12px] text-muted-foreground">
                                  {warnings.length
                                    ? `${warnings.length} из ${allDisks.length} требуют проверки`
                                    : smartPassive
                                      ? "SMART для части дисков не опрашивается"
                                      : smartUnchecked
                                        ? "Для части дисков нет свежих данных о состоянии"
                                        : "Предупреждений SMART нет"}
                                </div>
                              </div>
                            </div>
                            <div className="space-y-4">
                              {online.slice(0, 4).map((h) => (
                                <button
                                  key={h.id}
                                  onClick={() => {
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
                                        title={`${d.name}: ${getDiskStatus(d, h.online).label} · ${healthText(d)}`}
                                        className={cn(
                                          "h-2 w-2 rounded-full",
                                          getDiskStatus(d, h.online).dot,
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
                              Частота SMART зависит от политики агента; HDD
                              могут передавать сохранённые данные.
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
            </>
          )}
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
    <Card className="p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[14px] text-muted-foreground">{title}</span>
        <div className={cn("rounded-lg p-1.5", colors[color])}>
          <Icon size={15} strokeWidth={1.7} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[23px] leading-none font-semibold tracking-[-1px]">
          {value}
        </span>
        <span className="text-base font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      <div className="mt-2 min-h-4 text-[12px] text-muted-foreground">
        {detail}
      </div>
      <div className="mt-2 flex min-h-5 items-center gap-2 text-[12px] text-muted-foreground">
        {footer}
      </div>
    </Card>
  );
}
function ServerCard({ host: h }: { host: Host }) {
  const m = h.metrics;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(h.ip);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError(
        "Не удалось скопировать IP. Выделите адрес и скопируйте вручную.",
      );
    }
  };
  const warnings =
    m?.disks.filter((d) => ["warning", "failed"].includes(d.health)).length ||
    0;
  const resources = [
    {
      label: "CPU",
      value: h.online ? m?.cpu.usage : null,
      detail: m ? `${m.cpu.model} · ${m.cpu.cores} потоков` : "Нет данных CPU",
    },
    {
      label: "RAM",
      value: h.online ? m?.memory.percent : null,
      detail:
        h.online && m
          ? `Занято ${bytes(m.memory.used)} из ${bytes(m.memory.total)}`
          : "Нет текущих данных о памяти",
    },
    {
      label: "GPU",
      value: h.online ? m?.gpus[0]?.usage : null,
      detail: m?.gpus[0]?.name || "Нет данных GPU",
    },
  ];
  return (
    <article className="group relative flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors hover:border-blue-400 focus-within:border-blue-400">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold group-hover:text-blue-700">
            <Link
              to={`/servers/${encodeURIComponent(h.id)}`}
              title={`${h.name}${m?.os ? ` · ${m.os}` : ""}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-blue-600"
            >
              {h.name}
            </Link>
          </h3>
          <div className="relative z-10 mt-0.5 flex w-fit max-w-full items-center gap-1 text-xs text-muted-foreground">
            <span className="select-text break-all font-mono">{h.ip}</span>
            <button
              type="button"
              onClick={copyAddress}
              aria-label={
                copied ? `IP ${h.ip} скопирован` : `Скопировать IP ${h.ip}`
              }
              title={copied ? "Скопировано" : "Скопировать IP"}
              className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-blue-50 hover:text-blue-700"
            >
              {copied ? (
                <Check size={13} className="text-emerald-700" />
              ) : (
                <Copy size={13} />
              )}
            </button>
          </div>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px]",
            h.online ? "text-emerald-700" : "text-orange-700",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              h.online ? "bg-emerald-500" : "bg-orange-400",
            )}
          />
          {h.online ? "В сети" : "Нет связи"}
          {h.demo && <span className="text-muted-foreground">· Демо</span>}
        </span>
      </div>
      <span role="status" className="sr-only">
        {copied ? "IP-адрес скопирован" : ""}
      </span>
      {copyError && (
        <p role="alert" className="relative z-10 mt-1 text-xs text-orange-700">
          {copyError}
        </p>
      )}
      <ResourceRings resources={resources} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-zinc-100 pt-2 text-[11px] text-muted-foreground">
        <span
          title={
            warnings ? `${warnings} накопителей требуют внимания` : "Накопители"
          }
          className={cn(
            "flex items-center gap-1",
            warnings && "text-orange-700",
          )}
        >
          {warnings ? <AlertTriangle size={12} /> : <HardDrive size={12} />}
          {m
            ? `${m.disks.length} · ${bytes(m.disks.reduce((sum, d) => sum + d.total, 0))}`
            : "—"}
        </span>
        <span>
          {h.online && m
            ? `↓ ${speed(m.network.rx)} · ↑ ${speed(m.network.tx)}`
            : "Сеть: —"}
        </span>
      </div>
      {!h.online && (
        <p className="mt-2 text-[11px] text-orange-700">
          {m
            ? "Сведения сохранены с последнего подключения"
            : "Метрики ещё не получены"}
        </p>
      )}
      {!h.online && h.error && (
        <p
          title={h.error}
          className="mt-1 truncate text-[11px] text-orange-700"
        >
          {h.error}
        </p>
      )}
    </article>
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
function healthText(d: Disk) {
  if (d.smart_state === "not_applicable") return "SMART неприменим";
  if (d.health === "healthy") return "SMART: без ошибок";
  if (d.health === "warning") return "SMART: предупреждение";
  if (d.health === "failed") return "SMART: ошибки";
  if (d.smart_state === "passive" || d.smart_state === "skipped")
    return "SMART не опрашивается";
  if (d.smart_state === "sleeping") return "SMART: диск спал при проверке";
  if (d.smart_state === "unsupported") return "Опрос SMART пропущен";
  if (d.smart_state === "unavailable") return "SMART недоступен";
  if (d.smart_state === "waiting_activity") return "SMART: ожидание активности";
  if (d.smart_state === "cached") return "SMART: сохранённые данные";
  if (d.smart_state === "cooldown") return "SMART: повтор отложен";
  if (d.smart_state === "power_unknown")
    return "SMART: режим питания неизвестен";
  return "Нет данных о состоянии";
}
function diskSampleTime(value?: number | null) {
  if (value == null) return "ещё не получены";
  const minutes = Math.floor((Date.now() / 1000 - value) / 60);
  const age =
    minutes < 0
      ? "дата в будущем"
      : minutes < 1
        ? "только что"
        : minutes < 60
          ? `${minutes} мин. назад`
          : minutes < 1440
            ? `${Math.floor(minutes / 60)} ч. назад`
            : `${Math.floor(minutes / 1440)} дн. назад`;
  return `${new Date(value * 1000).toLocaleString("ru-RU")} (${age})`;
}
function smartPolicyText(state: string) {
  const messages: Record<string, string> = {
    not_applicable:
      "Виртуальный USB-носитель (например, KVM). SMART и состояние питания неприменимы и не опрашиваются.",
    passive:
      "Автоматический ATA SMART-опрос отключён или диск не входит в разрешённый список. Показаны метаданные и сохранённые показатели.",
    sleeping:
      "При SMART-проверке диск спал, поэтому снимок не обновлён. Состояние питания показано отдельным индикатором.",
    skipped:
      "Опрос SMART пропущен: политика для этого подключения не настроена.",
    unsupported:
      "Проверка питания не поддерживается. SMART пропущен, следующая попытка отложена.",
    unavailable:
      "SMART не удалось прочитать. Показан прежний снимок, если он есть. Проверьте диагностику агента.",
    waiting_activity:
      "SMART ожидает обычного чтения или записи на диск. Принудительного пробуждения по расписанию нет.",
    cached:
      "Показан сохранённый снимок SMART. ATA-опрос разрешён не чаще раза в сутки и только при наблюдаемой дисковой активности.",
    cooldown:
      "Предыдущая попытка прервана или ещё не завершена. Ограничение частоты сохраняется после перезапуска агента.",
    power_unknown:
      "Режим питания не удалось определить. SMART пропущен, следующая попытка отложена.",
    fresh:
      "Показан последний полученный снимок SMART; время измерения указано ниже.",
  };
  return messages[state] || "Состояние SMART передано агентом.";
}
function DiskDetails({ disk: d }: { disk: Disk }) {
  const number = (value?: number | null, suffix = "") =>
    value == null ? "—" : value.toLocaleString("ru-RU") + suffix;
  const virtual = d.type === "USB Gadget";
  const rows = [
    ["Серийный номер", d.serial || "—"],
    ["Прошивка", d.firmware || "—"],
    ["Интерфейс", d.interface?.toUpperCase() || "—"],
    ...(virtual
      ? []
      : [
          [
            "Скорость вращения",
            d.type === "HDD"
              ? number(d.rotation_rate, " об/мин")
              : d.type === "SSD" || d.type === "NVMe"
                ? "Без вращения"
                : "—",
          ],
          ["Наработка", number(d.power_on_hours, " ч")],
          ["Включения", number(d.power_cycles)],
          ["Запуски и остановки шпинделя", number(d.start_stop_count)],
          ["Циклы загрузки/выгрузки головок", number(d.load_cycle_count)],
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
        ]),
  ];
  return (
    <>
      {d.smart_state && (
        <div className="mb-4 space-y-1 text-[12px]">
          <p>{smartPolicyText(d.smart_state)}</p>
          {!virtual && (
            <p>Данные SMART: {diskSampleTime(d.smart_updated_at)}</p>
          )}
          {d.smart_attempt_at != null && (
            <p>Последняя попытка: {diskSampleTime(d.smart_attempt_at)}</p>
          )}
          <p>Заполнение томов: {diskSampleTime(d.usage_updated_at)}</p>
        </div>
      )}
      <dl className="mb-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3"
          >
            <dt className="text-[12px]">{label}</dt>
            <dd className="break-all text-right text-xs font-medium text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
function DiskList({
  disks,
  online = true,
}: {
  disks: Disk[];
  online?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-zinc-100">
      {disks.map((d) => (
        <div key={d.name} className="min-w-0">
          <button
            onClick={() => setOpen(open === d.name ? null : d.name)}
            aria-expanded={open === d.name}
            className="group/disk-row grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_16px] items-center gap-x-3 gap-y-2 py-3 text-left xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_16px]"
          >
            <span className="min-w-0">
              <span className="relative flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <span className="min-w-0 break-words">
                  {d.model || `/dev/${d.name}`}
                </span>
                <DiskStatus disk={d} online={online} />
              </span>
              <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                /dev/{d.name} ·{" "}
                {d.type === "Unknown" ? "Тип неизвестен" : d.type} ·{" "}
                {bytes(d.total)}
                {d.temperature != null ? ` · ${d.temperature} °C` : ""}
              </span>
            </span>
            <span className="col-start-1 min-w-0 xl:col-start-2 xl:row-start-1">
              <span className="mb-1 block text-xs text-muted-foreground">
                {d.volumes.length
                  ? `${bytes(d.used)} занято в томах`
                  : "Нет данных о заполнении"}
              </span>
              {!!d.volumes.length && (
                <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <span
                    className="block h-full rounded-full bg-blue-400"
                    style={{
                      width: `${d.total ? Math.max(0, Math.min(100, (d.used / d.total) * 100)) : 0}%`,
                    }}
                  />
                </span>
              )}
            </span>
            <span className="col-start-1 flex min-w-0 flex-col items-start gap-1 xl:col-start-3 xl:row-start-1">
              <span
                className={cn(
                  "break-words text-xs",
                  ["warning", "failed"].includes(d.health)
                    ? "text-orange-700"
                    : "text-muted-foreground",
                )}
              >
                {healthText(d)}
              </span>
              {d.smart_updated_at != null && (
                <span className="text-[11px] text-muted-foreground">
                  Проверка{" "}
                  {new Date(d.smart_updated_at * 1000).toLocaleString("ru-RU")}
                </span>
              )}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "col-start-2 row-start-1 text-muted-foreground transition-transform xl:col-start-4",
                open === d.name && "rotate-180",
              )}
            />
          </button>
          {open === d.name && (
            <div className="mb-3 min-w-0 rounded-lg bg-zinc-50 p-3 text-xs text-muted-foreground appear">
              {d.warning && <p className="mb-3 text-orange-700">{d.warning}</p>}
              <DiskDetails disk={d} />
              {d.health === "unknown" && !d.smart_state && (
                <p className="mb-3">
                  Агент не передал данные SMART. Состояние диска неизвестно.
                </p>
              )}
              {d.volumes.map((v) => (
                <div
                  key={v.mount}
                  className="mb-2 flex min-w-0 flex-wrap justify-between gap-2"
                >
                  <code className="min-w-0 break-all">{v.mount}</code>
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
              <p className="mt-3 border-t border-zinc-200 pt-3 text-sm leading-6 text-muted-foreground">
                После установки агент покажет IP-адрес, порт и токен. Показать
                их снова:{" "}
                <code className="select-all break-all font-mono text-zinc-700">
                  sudo homelab-agent connection-info
                </code>
              </p>
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
        <Route path="/network" element={<Navigate to="/overview" replace />} />
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
      <div>
        <h3 className="mb-3 text-sm font-semibold">Система</h3>
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Процессор</dt>
          <dd className="break-words text-right">
            {m.cpu.model} · {m.cpu.cores} потоков
          </dd>
          <dt className="text-muted-foreground">Оперативная память</dt>
          <dd className="break-words text-right">{bytes(m.memory.total)}</dd>
          <dt className="text-muted-foreground">Версия агента</dt>
          <dd className="break-words text-right">
            {m.agent_version || "Неизвестна"}
          </dd>
          <dt className="text-muted-foreground">Имя хоста</dt>
          <dd className="break-words text-right">{m.hostname}</dd>
          <dt className="text-muted-foreground">Время работы</dt>
          <dd className="break-words text-right">
            {Math.floor(m.uptime / 86400)} д.{" "}
            {Math.floor((m.uptime % 86400) / 3600)} ч.
          </dd>
          <dt className="text-muted-foreground">Сетевые интерфейсы</dt>
          <dd className="break-words text-right">
            {m.network.interfaces.join(", ") || "Нет данных"}
          </dd>
          <dt className="text-muted-foreground">Приём / передача</dt>
          <dd className="break-words text-right">
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
          Проверьте адрес или вернитесь на главную.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">На главную</Link>
        </Button>
      </div>
    </main>
  );
}
