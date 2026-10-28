import { cn, percent } from "../lib";

type Resource = {
  label: string;
  value: number | null | undefined;
  detail: string;
};

const colors = ["text-blue-500", "text-violet-500", "text-teal-500"];

export function ResourceRings({ resources }: { resources: Resource[] }) {
  const readings = resources.map((resource, index) => ({
    ...resource,
    value:
      resource.value != null && Number.isFinite(resource.value)
        ? Math.max(0, Math.min(100, resource.value))
        : null,
    color: colors[index],
    radius: 48 - index * 12,
  }));

  return (
    <div className="my-3 flex min-w-0 items-center gap-5">
      <svg
        viewBox="0 0 112 112"
        className="h-28 w-28 shrink-0"
        role="group"
        aria-label="Использование ресурсов сервера"
      >
        {readings.map(({ label, value, detail, color, radius }) => (
          <g
            key={label}
            role={value == null ? "img" : "progressbar"}
            aria-label={
              value == null
                ? `${label}: Нет данных`
                : label === "RAM"
                  ? "Занятая память"
                  : `Загрузка ${label}`
            }
            aria-valuemin={value == null ? undefined : 0}
            aria-valuemax={value == null ? undefined : 100}
            aria-valuenow={value ?? undefined}
            aria-valuetext={
              value == null ? undefined : `${percent(value)} · ${detail}`
            }
          >
            <title>{`${label}: ${percent(value)} · ${detail}`}</title>
            <circle
              cx="56"
              cy="56"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-zinc-100"
            />
            {value != null && (
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100 100"
                strokeDashoffset={100 - value}
                transform="rotate(-90 56 56)"
                opacity={value === 0 ? 0 : 1}
                className={cn(
                  color,
                  "transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none",
                )}
              />
            )}
          </g>
        ))}
      </svg>
      <dl className="min-w-0 flex-1 space-y-2.5">
        {readings.map(({ label, value, detail, color }) => (
          <div
            key={label}
            title={detail}
            className="flex items-center justify-between gap-3"
          >
            <dt className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full bg-current",
                  value == null ? "text-zinc-300" : color,
                )}
              />
              {label}
            </dt>
            <dd
              className={cn(
                "text-base leading-5 font-semibold tabular-nums",
                value == null && "text-muted-foreground",
                value != null && value >= 90 && "text-orange-700",
              )}
            >
              {percent(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
