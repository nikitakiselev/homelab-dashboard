import { cn, type Disk } from "../lib";

export function getDiskStatus(
  disk: Disk,
  online = true,
  now = Date.now() / 1000,
) {
  const unknown = { label: "Неизвестно", dot: "bg-amber-400" };
  if (!online) return { ...unknown, label: "Нет связи" };
  if (disk.smart_state === "not_applicable")
    return { label: "Виртуальный носитель", dot: "bg-zinc-400" };
  if (disk.health === "failed")
    return { label: "Ошибка SMART", dot: "bg-red-500" };
  if (disk.type !== "HDD") {
    if (disk.health === "warning")
      return { label: "Проверить SMART", dot: "bg-amber-400" };
    return disk.health === "healthy"
      ? { label: "В норме", dot: "bg-emerald-500" }
      : unknown;
  }
  const age =
    disk.power_checked_at == null ? Infinity : now - disk.power_checked_at;
  if (age < 0 || age > Math.max(120, (disk.power_interval_seconds || 60) * 2))
    return unknown;
  if (disk.power_error) return { label: "Ошибка опроса", dot: "bg-red-500" };
  if (disk.power_state === "standby" || disk.power_state === "sleep")
    return { label: "Спит", dot: "bg-zinc-400" };
  if (disk.power_state === "active")
    return { label: "Вращается", dot: "bg-emerald-500" };
  return unknown;
}

export function DiskStatus({ disk, online }: { disk: Disk; online: boolean }) {
  const status = getDiskStatus(disk, online);
  const measured =
    disk.power_checked_at == null
      ? "Нет замера питания"
      : `Питание проверено ${new Date(disk.power_checked_at * 1000).toLocaleString("ru-RU")}`;
  const detail =
    disk.type === "HDD"
      ? [status.label, measured, disk.power_error].filter(Boolean).join(" · ")
      : status.label;
  return (
    <span
      role="img"
      aria-label={detail}
      className="group/disk-status inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center"
    >
      <span
        className={cn("h-2 w-2 rounded-full", status.dot)}
        aria-hidden="true"
      />
      <span
        aria-hidden="true"
        className="absolute top-full left-0 z-30 hidden w-60 max-w-full pt-2 text-left group-hover/disk-status:block group-focus-visible/disk-row:block"
      >
        <span className="block rounded-lg border border-zinc-200 bg-white p-3 text-xs font-normal leading-5 text-zinc-900 shadow-lg">
          <span className="flex items-center gap-2 font-semibold">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} />
            {status.label}
          </span>
          {disk.type === "HDD" && (
            <span className="mt-1 block text-zinc-500">{measured}</span>
          )}
          {disk.type === "HDD" && disk.power_error && (
            <span className="mt-1 block break-words text-orange-700">
              {disk.power_error}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
