import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function bytes(n: number, decimals = 1) {
  if (!n) return "0 Б";
  const k = 1024,
    units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(4, Math.floor(Math.log(Math.max(n, 1)) / Math.log(k)));
  return `${(n / k ** i).toLocaleString("ru-RU", { maximumFractionDigits: decimals })} ${units[i]}`;
}
export function speed(n: number) {
  return bytes(n) + "/с";
}
export function percent(n: number | null | undefined) {
  return n == null ? "—" : Math.round(n) + "%";
}
export type Disk = {
  serial?: string;
  firmware?: string;
  interface?: string;
  rotation_rate?: number | null;
  power_state?: string;
  smart_state?: string;
  smart_updated_at?: number | null;
  usage_updated_at?: number | null;
  power_on_hours?: number | null;
  power_cycles?: number | null;
  reallocated_sectors?: number | null;
  pending_sectors?: number | null;
  uncorrectable_sectors?: number | null;
  percentage_used?: number | null;
  available_spare?: number | null;
  media_errors?: number | null;

  name: string;
  model: string;
  type: string;
  total: number;
  used: number;
  mounted_total: number;
  health: string;
  temperature: number | null;
  warning: string | null;
  volumes: { mount: string; total: number; used: number }[];
};
export type GPU = {
  engines?: Record<string, number>;
  shared_memory?: boolean;
  name: string;
  usage: number | null;
  memory_used: number | null;
  memory_total: number | null;
  temperature: number | null;
};
export type Metrics = {
  agent_version?: string;
  diagnostics?: Record<string, string>;
  timestamp: number;
  hostname: string;
  platform: string;
  os: string;
  cpu: { usage: number | null; cores: number; model: string };
  memory: { total: number; used: number; percent: number };
  disks: Disk[];
  gpus: GPU[];
  uptime: number;
  network: { rx: number; tx: number; interfaces: string[] };
};
export type Host = {
  local?: boolean;
  id: string;
  name: string;
  ip: string;
  port: number | null;
  online: boolean;
  demo: boolean;
  metrics: Metrics | null;
  error?: string;
  history_error?: string;
};
export type Point = {
  bucket: number;
  cpu: number;
  memory: number;
  rx: number;
  tx: number;
  rx_bytes: number;
  tx_bytes: number;
};
