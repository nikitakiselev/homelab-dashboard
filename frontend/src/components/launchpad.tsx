import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe2,
  Loader2,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../lib";
import { ApplicationEditor } from "./application-editor";
import { ApplicationIcon } from "./application-icon";
import {
  externalAccessLabel,
  filterApplications,
  orderedApplications,
  OVERVIEW_APPLICATION,
  type Application,
  type ApplicationDraft,
  type ApiRequest,
  type Catalogue,
} from "./launchpad-data";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function Launchpad({ request }: { request: ApiRequest }) {
  const [data, setData] = useState<Catalogue>({ groups: [], applications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Application | "new" | null>(null);
  const [details, setDetails] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMenu() {
    if (menu.current) menu.current.open = false;
  }
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    request("/applications")
      .then((catalogue: Catalogue) => {
        if (alive) {
          setData(catalogue);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [request]);

  async function retry() {
    setLoading(true);
    try {
      setData(await request("/applications"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function saveApplication(draft: ApplicationDraft) {
    const id = editor && editor !== "new" ? editor.id : null;
    const saved: Application = await request(
      "/applications" + (id ? "/" + id : ""),
      { method: id ? "PUT" : "POST", body: JSON.stringify(draft) },
    );
    setData((current) => ({
      ...current,
      applications: id
        ? current.applications.map((a) => (a.id === id ? saved : a))
        : [...current.applications, saved],
    }));
    setEditor(null);
  }
  async function move(id: string, direction: number) {
    const ids = orderedApplications(data.applications).map((app) => app.id);
    const from = ids.indexOf(id),
      to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await request("/applications/order", {
      method: "PUT",
      body: JSON.stringify({ scope: "all", ids }),
    });
    setData((current) => ({
      ...current,
      applications: current.applications.map((app) => ({
        ...app,
        launchpad_position: ids.indexOf(app.id),
      })),
    }));
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    const target = deleting;
    await request("/applications/" + target.id, { method: "DELETE" });
    setData((current) => ({
      ...current,
      applications: current.applications.filter((a) => a.id !== target.id),
    }));
    setDeleting(null);
  }

  const applications = [
    OVERVIEW_APPLICATION,
    ...orderedApplications(data.applications),
  ];
  const visible = filterApplications(applications, search);
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[#283253] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -inset-24 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#16354e_0%,#393776_42%,#786496_72%,#d39183_100%)]" />
        <div className="absolute -bottom-[25%] -left-[15%] h-[90%] w-[105%] rotate-[-25deg] rounded-[50%] bg-[#ef9f83]/75 blur-[85px]" />
        <div className="absolute -top-[35%] right-[-20%] h-[110%] w-[80%] rotate-[-35deg] rounded-[50%] bg-[#6d74da]/80 blur-[100px]" />
        <div className="absolute top-[30%] -left-[25%] h-[50%] w-[100%] rotate-[-28deg] rounded-[50%] bg-[#9d5295]/65 blur-[85px]" />
        <div className="absolute inset-0 bg-[#111827]/15 backdrop-blur-2xl" />
      </div>
      <h1 className="sr-only">Приложения</h1>
      <details
        ref={menu}
        className="fixed top-5 right-5 z-30 sm:top-6 sm:right-7"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeMenu();
            menu.current?.querySelector("summary")?.focus();
          }
        }}
      >
        <summary
          aria-label="Меню приложений"
          title="Меню"
          className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white/90 shadow-sm backdrop-blur-xl transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white [&::-webkit-details-marker]:hidden"
        >
          <Menu size={20} strokeWidth={1.6} />
        </summary>
        <div className="absolute top-12 right-0 w-64 rounded-2xl border border-white/50 bg-white/90 p-1.5 text-zinc-800 shadow-xl backdrop-blur-2xl">
          <button
            disabled={loading}
            onClick={() => {
              closeMenu();
              setEditor("new");
            }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-black/5 disabled:opacity-50"
          >
            <Plus size={17} />
            Добавить приложение
          </button>
          <button
            disabled={loading}
            onClick={() => {
              closeMenu();
              setEditing(!editing);
            }}
            aria-pressed={editing}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {editing ? <Check size={17} /> : <Settings2 size={17} />}
            {editing ? "Готово" : "Настроить приложения"}
          </button>
          <div className="mt-1 border-t border-black/5 px-3 py-2 text-[10px] text-zinc-500">
            Иконки:{" "}
            <a
              href="/app-icons/NOTICE.txt"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              selfh.st/icons · CC BY 4.0
            </a>
          </div>
        </div>
      </details>
      <div className="relative mx-auto max-w-[1180px] px-5 pt-16 pb-12 sm:px-8 sm:pt-14">
        <div className="relative mx-auto mb-9 w-full max-w-[320px] sm:mb-12">
          <Search
            size={17}
            className="pointer-events-none absolute top-3 left-3.5 text-white/65"
          />
          <input
            aria-label="Найти приложение"
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="launchpad-search h-10 w-full rounded-xl border border-white/20 bg-white/12 pr-10 pl-10 text-sm shadow-[0_4px_20px_#10162a12] backdrop-blur-2xl"
          />
          {search && (
            <button
              aria-label="Очистить поиск"
              className="absolute top-1.5 right-1.5 cursor-pointer rounded-lg p-1.5 text-white/75 hover:bg-white/10"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <span>{error}</span>
            <button
              onClick={() => void retry()}
              className="flex items-center gap-1 underline cursor-pointer"
            >
              <RefreshCw size={13} />
              Повторить
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex h-60 items-center justify-center gap-2 text-sm text-white/70">
            <Loader2 className="spinner" size={17} />
            Загрузка приложений…
          </div>
        ) : (
          <>
            {!visible.length && (!error || applications.length > 0) && (
              <div className="rounded-2xl border border-dashed border-white/25 py-16 text-center">
                <div className="mx-auto mb-5 w-fit">
                  <ApplicationIcon icon="blueprint" />
                </div>
                <h2 className="text-base font-semibold">
                  {search ? "Ничего не найдено" : "Здесь будут ваши приложения"}
                </h2>
                <p className="mt-2 text-sm text-white/70">
                  {search
                    ? "Попробуйте другое название."
                    : "Добавьте первую ссылку на домашний сервис."}
                </p>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => (search ? setSearch("") : setEditor("new"))}
                >
                  {search ? "Сбросить поиск" : "Добавить приложение"}
                </Button>
              </div>
            )}
            <div
              aria-label="Приложения"
              className="grid grid-cols-3 gap-x-2 gap-y-4 min-[480px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 sm:gap-x-4 sm:gap-y-5"
            >
              {visible.map((app) => {
                const builtin = app.id === OVERVIEW_APPLICATION.id;
                const index = orderedApplications(data.applications).findIndex(
                  (a) => a.id === app.id,
                );
                return (
                  <div
                    key={app.id}
                    className="group/app relative min-w-0 rounded-2xl transition-colors hover:bg-white/[.06] focus-within:bg-white/[.06]"
                  >
                    <a
                      href={app.url}
                      target={builtin ? undefined : "_blank"}
                      rel="noreferrer"
                      aria-label={`Открыть ${app.name}`}
                      className="flex min-h-[140px] flex-col items-center rounded-2xl px-2 pt-4 pb-3 text-center no-underline outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-white/80"
                    >
                      <span className="relative">
                        <ApplicationIcon
                          icon={app.icon}
                          className="h-[78px] w-[78px] rounded-[20px] shadow-[0_5px_12px_#11182720] sm:h-[84px] sm:w-[84px] sm:rounded-[22px]"
                        />
                        {app.external_url && (
                          <span
                            role="img"
                            aria-label={externalAccessLabel(app)}
                            title={externalAccessLabel(app)}
                            className={cn(
                              "absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/30 shadow-sm",
                              app.external_access === "confirmed"
                                ? "bg-blue-600 text-white"
                                : "bg-[#43435c]/95 text-white/85 ring-1 ring-white/15",
                            )}
                          >
                            <Globe2 size={13} />
                            {app.external_access !== "confirmed" && (
                              <span
                                aria-hidden="true"
                                className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-white text-[8px] font-bold text-zinc-600"
                              >
                                ?
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="mt-3 line-clamp-2 min-h-9 w-full break-words text-[12px] leading-[18px] font-medium text-white [text-shadow:0_1px_3px_#10182770] sm:text-[13px]">
                        {app.name}
                      </span>
                    </a>
                    {editing && !builtin && (
                      <button
                        aria-label={`Меню: ${app.name}`}
                        title={`Меню: ${app.name}`}
                        onClick={() => setDetails(app)}
                        className="absolute top-0.5 right-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-white/80 hover:bg-white/15 sm:opacity-0 sm:group-hover/app:opacity-100 sm:group-focus-within/app:opacity-100 focus:opacity-100 cursor-pointer"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                    {editing && !builtin && (
                      <div className="mb-2 flex items-center justify-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy || index === 0}
                          aria-label={`Раньше: ${app.name}`}
                          onClick={() => void run(() => move(app.id, -1))}
                        >
                          <ArrowLeft size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Изменить: ${app.name}`}
                          onClick={() => setEditor(app)}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={
                            busy || index === data.applications.length - 1
                          }
                          aria-label={`Позже: ${app.name}`}
                          onClick={() => void run(() => move(app.id, 1))}
                        >
                          <ArrowRight size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {editor && (
        <ApplicationEditor
          key={editor === "new" ? "new" : editor.id}
          application={editor === "new" ? undefined : editor}
          onSave={saveApplication}
          onClose={() => setEditor(null)}
        />
      )}
      <Dialog
        open={!!details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
      >
        <DialogContent>
          {details && (
            <>
              <div className="mb-5">
                <ApplicationIcon icon={details.icon} />
              </div>
              <DialogTitle className="text-xl font-semibold">
                {details.name}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Ссылки и настройки приложения
              </DialogDescription>
              <div className="mt-5 space-y-4">
                {[
                  ["Основной адрес", details.url],
                  ["Локальный адрес", details.local_url],
                  ["Внешний адрес", details.external_url],
                ]
                  .filter(([, url]) => url)
                  .map(([label, url]) => (
                    <div key={label}>
                      <p className="mb-1 text-xs text-muted-foreground">
                        {label}
                      </p>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start gap-2 break-all text-sm text-blue-700"
                      >
                        {url}
                        <ArrowUpRight size={14} className="mt-0.5 shrink-0" />
                      </a>
                    </div>
                  ))}
              </div>
              {details.external_url && (
                <p className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 p-3 text-xs leading-5 text-muted-foreground">
                  <Globe2 size={15} className="mt-0.5 shrink-0" />
                  {details.external_access === "confirmed"
                    ? "Доступ извне подтверждён владельцем. Это не проверка текущей доступности."
                    : "Внешний адрес найден. Доступ из интернета пока не подтверждён."}
                </p>
              )}
              <div className="mt-6 flex justify-between gap-2 border-t border-zinc-100 pt-4">
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => {
                    setDeleting({
                      id: details.id,
                      name: details.name,
                    });
                    setDetails(null);
                  }}
                >
                  <Trash2 size={15} />
                  Удалить ярлык
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditor(details);
                    setDetails(null);
                  }}
                >
                  <Pencil size={15} />
                  Изменить
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">
            Удалить ярлык?
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
            {deleting?.name}. Само приложение продолжит работать.
          </DialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void run(remove)}
            >
              {busy && <Loader2 size={14} className="spinner" />}Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
