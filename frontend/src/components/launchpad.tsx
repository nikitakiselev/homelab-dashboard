import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  FolderPlus,
  Globe2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { cn, type Host } from "../lib";
import { ApplicationEditor } from "./application-editor";
import { ApplicationGroups } from "./application-groups";
import { ApplicationIcon } from "./application-icon";
import {
  externalAccessLabel,
  filterApplications,
  type Application,
  type ApplicationDraft,
  type ApplicationGroup,
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

export function Launchpad({
  request,
  hosts,
  hostsLoading,
  hostsError,
}: {
  request: ApiRequest;
  hosts: Host[];
  hostsLoading: boolean;
  hostsError: string;
}) {
  const [data, setData] = useState<Catalogue>({ groups: [], applications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Application | "new" | null>(null);
  const [details, setDetails] = useState<Application | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [deleting, setDeleting] = useState<{
    kind: "application" | "group";
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

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
  async function saveGroup(name: string, id?: string) {
    const group: ApplicationGroup = await request(
      "/application-groups" + (id ? "/" + id : ""),
      { method: id ? "PUT" : "POST", body: JSON.stringify({ name }) },
    );
    setData((current) => ({
      ...current,
      groups: id
        ? current.groups.map((g) => (g.id === id ? group : g))
        : [...current.groups, group],
    }));
  }
  async function move(
    kind: "applications" | "groups",
    id: string,
    direction: number,
    groupId: string | null = null,
  ) {
    const items = (
      kind === "groups"
        ? data.groups
        : data.applications.filter((a) => a.group_id === groupId)
    )
      .slice()
      .sort((a, b) => a.position - b.position);
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(id),
      to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await request(
      kind === "groups" ? "/application-groups/order" : "/applications/order",
      { method: "PUT", body: JSON.stringify({ ids, group_id: groupId }) },
    );
    setData((current) =>
      kind === "groups"
        ? {
            ...current,
            groups: current.groups.map((g) => ({
              ...g,
              position: ids.indexOf(g.id),
            })),
          }
        : {
            ...current,
            applications: current.applications.map((a) =>
              a.group_id === groupId
                ? { ...a, position: ids.indexOf(a.id) }
                : a,
            ),
          },
    );
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
    await request(
      (target.kind === "group" ? "/application-groups/" : "/applications/") +
        target.id,
      { method: "DELETE" },
    );
    setData((current) => {
      if (target.kind === "application")
        return {
          ...current,
          applications: current.applications.filter((a) => a.id !== target.id),
        };
      const moved = current.applications
        .filter((a) => a.group_id === target.id)
        .sort((a, b) => a.position - b.position);
      const start =
        Math.max(
          -1,
          ...current.applications
            .filter((a) => a.group_id === null)
            .map((a) => a.position),
        ) + 1;
      return {
        groups: current.groups.filter((g) => g.id !== target.id),
        applications: current.applications.map((a) =>
          a.group_id === target.id
            ? {
                ...a,
                group_id: null,
                position: start + moved.findIndex((m) => m.id === a.id),
              }
            : a,
        ),
      };
    });
    setDeleting(null);
  }

  const groups = data.groups.slice().sort((a, b) => a.position - b.position);
  const applications = data.applications
    .slice()
    .sort((a, b) => a.position - b.position);
  const visible = filterApplications(applications, groups, search);
  const sections = [
    ...groups,
    { id: null, name: "Без группы", position: Infinity },
  ];
  const online = hosts.filter((host) => host.online).length;
  return (
    <div className="mx-auto max-w-[1240px] pb-6">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4 pt-2 sm:pt-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-[.14em] text-muted-foreground">
            ДОМАШНЕЕ ПРОСТРАНСТВО
          </p>
          <h1 className="m-0 text-[30px] font-semibold tracking-[-1.2px] sm:text-[34px]">
            Ваш homelab
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Все приложения — в одном месте.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => setEditing(!editing)}
            disabled={loading}
            aria-pressed={editing}
            aria-label={
              editing ? "Завершить упорядочивание" : "Упорядочить приложения"
            }
          >
            {editing ? <Check size={16} /> : <Settings2 size={16} />}
            <span className="hidden sm:inline">
              {editing ? "Готово" : "Упорядочить"}
            </span>
          </Button>
          <Button onClick={() => setEditor("new")} disabled={loading}>
            <Plus size={16} />
            Добавить приложение
          </Button>
        </div>
      </div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/[.045] bg-white px-5 py-4 shadow-[0_2px_8px_#18253b02]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3f6fa] text-[#708198]">
            <Server size={19} strokeWidth={1.5} />
          </span>
          <div>
            <p className="text-sm font-medium">
              {hostsLoading
                ? "Подключение к серверам…"
                : hostsError
                  ? "Метрики серверов недоступны"
                  : hosts.length
                    ? `${online} из ${hosts.length} серверов в сети`
                    : "Серверы ещё не подключены"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hostsError
                ? "Каталог приложений доступен"
                : hosts.some((h) => h.demo)
                  ? "Включены демонстрационные данные"
                  : hosts.length
                    ? hosts.map((h) => h.name).join(" · ")
                    : "Добавьте агент в разделе «Серверы»"}
            </p>
          </div>
        </div>
        <Link
          to="/overview"
          className="flex items-center gap-1 text-xs font-medium text-blue-700"
        >
          Мониторинг
          <ChevronRight size={14} />
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-[380px]">
          <Search
            size={17}
            className="pointer-events-none absolute top-3 left-3.5 text-zinc-400"
          />
          <input
            aria-label="Найти приложение"
            placeholder="Найти приложение или группу…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-xl border border-black/[.065] bg-white/70 pr-10 pl-10 text-sm"
          />
          {search && (
            <button
              aria-label="Очистить поиск"
              className="absolute top-2 right-2 rounded-lg p-1.5 text-muted-foreground hover:bg-zinc-100 cursor-pointer"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {editing && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGroupsOpen(true)}
            >
              <FolderPlus size={14} />
              Группы
            </Button>
          )}
          <span>
            {search
              ? `Найдено: ${visible.length}`
              : `Приложений: ${applications.length}`}
          </span>
          <span
            className="flex items-center gap-1.5"
            title="Глобус отмечает наличие внешнего адреса. Подробности — в меню приложения."
          >
            <Globe2 size={13} />
            Внешний адрес
          </span>
        </div>
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
        <div className="flex h-60 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="spinner" size={17} />
          Загрузка приложений…
        </div>
      ) : (
        <>
          {!visible.length && (!error || applications.length > 0) && (
            <div className="rounded-2xl border border-dashed border-zinc-300 py-16 text-center">
              <div className="mx-auto mb-5 w-fit">
                <ApplicationIcon icon="blueprint" />
              </div>
              <h2 className="text-base font-semibold">
                {search ? "Ничего не найдено" : "Здесь будут ваши приложения"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {search
                  ? "Попробуйте другое название или группу."
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
          <div className="space-y-7">
            {sections.map((group) => {
              const items = visible.filter((app) => app.group_id === group.id);
              const allItems = applications.filter(
                (app) => app.group_id === group.id,
              );
              if (!items.length && !(editing && group.id && !search))
                return null;
              return (
                <section key={group.id || "ungrouped"} aria-label={group.name}>
                  <div className="mb-3 flex items-center gap-2.5">
                    <h2 className="text-[14px] font-semibold tracking-[-.2px]">
                      {group.name}
                    </h2>
                    <span className="rounded-md bg-zinc-200/55 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {items.length}
                    </span>
                    <div className="h-px flex-1 bg-black/[.045]" />
                  </div>
                  <div className="grid grid-cols-3 gap-x-1 gap-y-2 min-[480px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                    {items.map((app) => {
                      const index = allItems.findIndex((a) => a.id === app.id);
                      return (
                        <div
                          key={app.id}
                          className="group/app relative min-w-0 rounded-2xl transition-colors hover:bg-white/75 focus-within:bg-white/75"
                        >
                          <a
                            href={app.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Открыть ${app.name}`}
                            className="flex min-h-[136px] flex-col items-center rounded-2xl px-2 pt-4 pb-3 text-center no-underline outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-blue-600"
                          >
                            <span className="relative">
                              <ApplicationIcon icon={app.icon} />
                              {app.external_url && (
                                <span
                                  role="img"
                                  aria-label={externalAccessLabel(app)}
                                  title={externalAccessLabel(app)}
                                  className={cn(
                                    "absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-[#f5f5f7]",
                                    app.external_access === "confirmed"
                                      ? "bg-blue-600 text-white"
                                      : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-300",
                                  )}
                                >
                                  <Globe2 size={13} />
                                  {app.external_access !== "confirmed" && (
                                    <span
                                      aria-hidden="true"
                                      className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-white text-[8px] font-bold"
                                    >
                                      ?
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                            <span className="mt-3 line-clamp-2 min-h-9 w-full break-words text-[12px] leading-[18px] font-medium text-zinc-700 sm:text-[13px]">
                              {app.name}
                            </span>
                          </a>
                          <button
                            aria-label={`Меню: ${app.name}`}
                            title={`Меню: ${app.name}`}
                            onClick={() => setDetails(app)}
                            className="absolute top-0.5 right-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white sm:opacity-0 sm:group-hover/app:opacity-100 sm:group-focus-within/app:opacity-100 focus:opacity-100 cursor-pointer"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {editing && (
                            <div className="mb-2 flex items-center justify-center gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={busy || index === 0}
                                aria-label={`Раньше: ${app.name}`}
                                onClick={() =>
                                  void run(() =>
                                    move(
                                      "applications",
                                      app.id,
                                      -1,
                                      app.group_id,
                                    ),
                                  )
                                }
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
                                disabled={busy || index === allItems.length - 1}
                                aria-label={`Позже: ${app.name}`}
                                onClick={() =>
                                  void run(() =>
                                    move(
                                      "applications",
                                      app.id,
                                      1,
                                      app.group_id,
                                    ),
                                  )
                                }
                              >
                                <ArrowRight size={13} />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!items.length && (
                    <p className="py-4 text-xs text-muted-foreground">
                      В группе пока нет приложений. Выберите её при добавлении
                      или редактировании.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-10 text-center text-[10px] text-zinc-400">
        Иконки:{" "}
        <a
          href="/app-icons/NOTICE.txt"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          selfh.st/icons · CC BY 4.0
        </a>
      </p>
      {editor && (
        <ApplicationEditor
          key={editor === "new" ? "new" : editor.id}
          application={editor === "new" ? undefined : editor}
          groups={groups}
          onSave={saveApplication}
          onClose={() => setEditor(null)}
        />
      )}
      {groupsOpen && (
        <ApplicationGroups
          groups={groups}
          onClose={() => setGroupsOpen(false)}
          onSave={saveGroup}
          onMove={(id, direction) => move("groups", id, direction)}
          onDelete={(g) => {
            setGroupsOpen(false);
            setDeleting({ kind: "group", id: g.id, name: g.name });
          }}
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
              <DialogDescription className="mt-2 text-sm text-muted-foreground">
                {groups.find((g) => g.id === details.group_id)?.name ||
                  "Без группы"}
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
                      kind: "application",
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
            {deleting?.kind === "group" ? "Удалить группу?" : "Удалить ярлык?"}
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
            {deleting?.name}.{" "}
            {deleting?.kind === "group"
              ? "Приложения останутся в разделе «Без группы»."
              : "Само приложение продолжит работать."}
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
