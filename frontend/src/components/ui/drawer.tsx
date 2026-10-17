import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib";

export const Drawer = DialogPrimitive.Root;
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;

export function DrawerContent({
  className,
  children,
  closeDisabled = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  closeDisabled?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "drawer-panel fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-xl flex-col border-l border-black/5 bg-white shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          disabled={closeDisabled}
          aria-label="Закрыть панель"
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-40 sm:right-6 sm:top-5"
        >
          <X size={20} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-zinc-100 px-6 py-6 pr-16 sm:px-8 sm:pr-20",
        className,
      )}
      {...props}
    />
  );
}

export function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8",
        className,
      )}
      {...props}
    />
  );
}

export function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-white px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8",
        className,
      )}
      {...props}
    />
  );
}
