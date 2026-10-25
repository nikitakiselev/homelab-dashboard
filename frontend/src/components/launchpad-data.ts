export type ApplicationGroup = { id: string; name: string; position: number };
export type Application = {
  id: string;
  name: string;
  url: string;
  local_url: string;
  external_url: string;
  external_access: "unknown" | "unverified" | "confirmed";
  icon: string;
  group_id: string | null;
  position: number;
};
export type ApplicationDraft = Omit<Application, "id" | "position">;
export type Catalogue = {
  groups: ApplicationGroup[];
  applications: Application[];
};
export type ApiRequest = (path: string, options?: RequestInit) => Promise<any>;

export const KNOWN_APPLICATIONS = [
  { id: "plex", name: "Plex", aliases: ["plex"] },
  { id: "radarr", name: "Radarr", aliases: ["radarr"] },
  { id: "sonarr", name: "Sonarr", aliases: ["sonarr"] },
  { id: "prowlarr", name: "Prowlarr", aliases: ["prowlarr"] },
  { id: "transmission", name: "Transmission", aliases: ["transmission"] },
  { id: "torrserver", name: "TorrServer", aliases: ["torrserver"] },
  {
    id: "home-assistant",
    name: "Home Assistant",
    aliases: ["home assistant", "homeassistant"],
  },
  { id: "grafana", name: "Grafana", aliases: ["grafana"] },
  { id: "uptime-kuma", name: "Uptime Kuma", aliases: ["uptime kuma"] },
  { id: "prometheus", name: "Prometheus", aliases: ["prometheus"] },
  { id: "glitchtip", name: "GlitchTip", aliases: ["glitchtip"] },
  { id: "gitea", name: "Gitea", aliases: ["gitea"] },
  { id: "owncloud", name: "ownCloud", aliases: ["owncloud"] },
  {
    id: "open-webui",
    name: "Open WebUI",
    aliases: ["open webui", "openwebui"],
  },
  { id: "comfyui", name: "ComfyUI", aliases: ["comfyui"] },
  { id: "beszel", name: "Beszel", aliases: ["beszel"] },
  { id: "proxmox", name: "Proxmox", aliases: ["proxmox"] },
  { id: "homepage", name: "Homepage", aliases: ["homepage"] },
];

export const GENERIC_ICONS = [
  { id: "blueprint", name: "Приложение" },
  { id: "router", name: "Роутер" },
  { id: "folder", name: "Файлы" },
  { id: "ruler", name: "Измерения" },
  { id: "share", name: "Общий доступ" },
  { id: "microphone", name: "Аудио" },
  { id: "gamepad", name: "Игры" },
  { id: "dashboard", name: "Дашборд" },
  { id: "television", name: "Медиа" },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, " ")
    .trim();
}

export function recognizeApplication(name: string, url: string) {
  let address = "";
  try {
    const parsed = new URL(url);
    if (["http:", "https:"].includes(parsed.protocol)) {
      address = parsed.hostname + " " + parsed.pathname;
    }
  } catch {
    /* An incomplete address should not interrupt editing. */
  }
  const haystack = ` ${normalize(name)} ${normalize(address)} `;
  return (
    KNOWN_APPLICATIONS.find((app) =>
      app.aliases.some((alias) => haystack.includes(` ${alias} `)),
    ) || null
  );
}

export function externalAccessLabel(
  app: Pick<Application, "external_url" | "external_access">,
) {
  if (!app.external_url) return "";
  return `${app.external_access === "confirmed" ? "Доступно извне" : "Внешний адрес найден · доступ извне не проверен"} · ${app.external_url}`;
}

export function filterApplications<
  T extends { name: string; group_id: string | null },
>(apps: T[], groups: ApplicationGroup[], search: string): T[] {
  const query = search.trim().toLocaleLowerCase("ru");
  if (!query) return apps;
  const names = new Map(groups.map((g) => [g.id, g.name]));
  return apps.filter((app) =>
    `${app.name} ${names.get(app.group_id || "") || ""}`
      .toLocaleLowerCase("ru")
      .includes(query),
  );
}
