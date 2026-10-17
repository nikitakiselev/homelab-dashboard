import * as React from "react";
import { cn } from "../../lib";
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-black/[0.065] bg-white shadow-[0_2px_8px_0_#00000003]",
        className,
      )}
      {...props}
    />
  );
}
