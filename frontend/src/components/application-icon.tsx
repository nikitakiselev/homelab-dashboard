import { useEffect, useState } from "react";
import {
  Folder,
  Gamepad2,
  LayoutDashboard,
  Mic,
  PanelsTopLeft,
  Router,
  Ruler,
  Share2,
  Tv,
} from "lucide-react";
import { cn } from "../lib";
import { KNOWN_APPLICATIONS } from "./launchpad-data";

const generic = {
  torrserver: Tv,
  router: Router,
  folder: Folder,
  ruler: Ruler,
  share: Share2,
  microphone: Mic,
  gamepad: Gamepad2,
  dashboard: LayoutDashboard,
  television: Tv,
};

export function ApplicationIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  const Icon = generic[icon as keyof typeof generic] || PanelsTopLeft;
  const branded =
    icon !== "torrserver" &&
    KNOWN_APPLICATIONS.some((app) => app.id === icon) &&
    !failed;
  return (
    <span
      className={cn(
        "relative flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-[21px] bg-white shadow-[0_3px_12px_#1b24300a,0_1px_2px_#1b243006] ring-1 ring-black/[.045]",
        className,
      )}
    >
      {branded ? (
        <img
          src={`/app-icons/${icon}.webp`}
          alt=""
          className="h-[68%] w-[68%] object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center bg-blue-50/70 text-[#6587b7]"
          style={{
            backgroundImage:
              "linear-gradient(#6688bb0b 1px,transparent 1px),linear-gradient(90deg,#6688bb0b 1px,transparent 1px)",
            backgroundSize: "12px 12px",
          }}
        >
          <Icon size={34} strokeWidth={1.25} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
