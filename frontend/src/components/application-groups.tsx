import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { type ApplicationGroup } from "./launchpad-data";

export function ApplicationGroups({
  groups,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  groups: ApplicationGroup[];
  onClose: () => void;
  onSave: (name: string, id?: string) => Promise<void>;
  onMove: (id: string, direction: number) => Promise<void>;
  onDelete: (group: ApplicationGroup) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle className="text-xl font-semibold">
          Группы приложений
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Названия и порядок разделов на главной.
        </DialogDescription>
        <div className="mt-5 space-y-2">
          {groups.map((group, index) => (
            <form
              key={group.id}
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => onSave(names[group.id] ?? group.name, group.id));
              }}
            >
              <input
                aria-label={`Название группы ${group.name}`}
                value={names[group.id] ?? group.name}
                maxLength={80}
                required
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 text-sm"
                onChange={(e) =>
                  setNames({ ...names, [group.id]: e.target.value })
                }
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                disabled={
                  busy || (names[group.id] ?? group.name) === group.name
                }
                aria-label={`Сохранить группу ${group.name}`}
              >
                <Check size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy || !index}
                onClick={() => void run(() => onMove(group.id, -1))}
                aria-label={`Выше: ${group.name}`}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy || index === groups.length - 1}
                onClick={() => void run(() => onMove(group.id, 1))}
                aria-label={`Ниже: ${group.name}`}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => onDelete(group)}
                aria-label={`Удалить группу ${group.name}`}
              >
                <Trash2 size={14} className="text-red-700" />
              </Button>
            </form>
          ))}
        </div>
        <form
          className="mt-5 flex gap-2 border-t border-zinc-100 pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await onSave(name);
              setName("");
            });
          }}
        >
          <input
            aria-label="Новая группа"
            placeholder="Название новой группы"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 text-sm"
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus size={15} />
            Добавить
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
