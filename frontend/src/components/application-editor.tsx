import { useState } from "react";
import { Check, Globe2, Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { ApplicationIcon } from "./application-icon";
import {
  GENERIC_ICONS,
  KNOWN_APPLICATIONS,
  recognizeApplication,
  type Application,
  type ApplicationDraft,
} from "./launchpad-data";

const inputClass =
  "h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm disabled:opacity-50";

export function ApplicationEditor({
  application,
  onSave,
  onClose,
}: {
  application?: Application;
  onSave: (draft: ApplicationDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(application?.name || "");
  const [url, setUrl] = useState(application?.url || "");
  const [localUrl, setLocalUrl] = useState(application?.local_url || "");
  const [externalUrl, setExternalUrl] = useState(
    application?.external_url || "",
  );
  const [access, setAccess] = useState(
    application?.external_access || "unknown",
  );
  const [icon, setIcon] = useState(application?.icon || "blueprint");
  const [manualIcon, setManualIcon] = useState(!!application);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestion = recognizeApplication(name, url);
  const selectedIcon = manualIcon ? icon : suggestion?.id || icon;
  const changedExternal =
    !!application && externalUrl !== application.external_url;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogTitle className="pr-6 text-xl font-semibold">
          {application ? "Изменить приложение" : "Добавить приложение"}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Ссылка на сервис, который всегда будет под рукой.
        </DialogDescription>
        <form
          className="mt-6 space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onSave({
                name,
                url,
                local_url: localUrl,
                external_url: externalUrl,
                external_access: externalUrl
                  ? access === "confirmed"
                    ? "confirmed"
                    : "unverified"
                  : "unknown",
                icon: selectedIcon,
                group_id: application?.group_id || null,
              });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-start gap-4">
            <ApplicationIcon
              icon={selectedIcon}
              className="mt-5 h-16 w-16 rounded-[18px]"
            />
            <div className="min-w-0 flex-1 space-y-3">
              <label className="block text-xs font-medium">
                Название
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass + " mt-1.5"}
                  placeholder={suggestion?.name || "Моё приложение"}
                />
              </label>
              <label className="block text-xs font-medium">
                Иконка
                <select
                  value={selectedIcon}
                  onChange={(e) => {
                    setIcon(e.target.value);
                    setManualIcon(true);
                  }}
                  className={inputClass + " mt-1.5"}
                >
                  <optgroup label="Общие">
                    {GENERIC_ICONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Приложения">
                    {KNOWN_APPLICATIONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
          </div>
          <label className="block text-xs font-medium">
            Основной адрес
            <input
              type="url"
              required
              maxLength={2048}
              placeholder="https://app.example"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => {
                if (!name && suggestion) setName(suggestion.name);
              }}
              className={inputClass + " mt-1.5"}
            />
          </label>
          {suggestion && !manualIcon && (
            <p className="flex items-center gap-2 text-xs text-blue-700">
              <Sparkles size={14} />
              Подобрана иконка {suggestion.name}
            </p>
          )}
          <details
            open={!!application?.local_url || !!application?.external_url}
            className="rounded-xl border border-zinc-200 p-4"
          >
            <summary className="cursor-pointer text-sm font-medium">
              Локальный и внешний доступ
            </summary>
            <div className="mt-4 space-y-4">
              <label className="block text-xs font-medium">
                Локальный адрес · необязательно
                <input
                  type="url"
                  maxLength={2048}
                  value={localUrl}
                  placeholder="http://192.168.50.12:8080"
                  onChange={(e) => {
                    if (url === localUrl) setUrl(e.target.value);
                    setLocalUrl(e.target.value);
                  }}
                  className={inputClass + " mt-1.5"}
                />
              </label>
              {localUrl && localUrl !== url && (
                <button
                  type="button"
                  className="text-xs text-blue-700 cursor-pointer"
                  onClick={() => setUrl(localUrl)}
                >
                  Открывать по локальному адресу
                </button>
              )}
              <label className="block text-xs font-medium">
                Внешний адрес · необязательно
                <input
                  type="url"
                  maxLength={2048}
                  value={externalUrl}
                  placeholder="https://app.example"
                  onChange={(e) => {
                    if (url === externalUrl) setUrl(e.target.value);
                    setExternalUrl(e.target.value);
                    setAccess(e.target.value ? "unverified" : "unknown");
                  }}
                  className={inputClass + " mt-1.5"}
                />
              </label>
              {externalUrl && externalUrl !== url && (
                <button
                  type="button"
                  className="text-xs text-blue-700 cursor-pointer"
                  onClick={() => setUrl(externalUrl)}
                >
                  Открывать по внешнему адресу
                </button>
              )}
              <label className="flex items-start gap-2.5 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 accent-blue-600"
                  disabled={!externalUrl || changedExternal}
                  checked={access === "confirmed"}
                  onChange={(e) =>
                    setAccess(e.target.checked ? "confirmed" : "unverified")
                  }
                />
                <span
                  className={
                    !externalUrl || changedExternal
                      ? "text-muted-foreground"
                      : ""
                  }
                >
                  <Globe2 size={14} className="mr-1 inline" />Я подтвердил
                  доступ к приложению из интернета
                </span>
              </label>
              {changedExternal && externalUrl && (
                <p className="text-xs leading-5 text-muted-foreground">
                  Сохраните новый внешний адрес, затем подтвердите доступ.
                  Прежнее подтверждение снято.
                </p>
              )}
            </div>
          </details>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="spinner" />
              ) : (
                <Check size={15} />
              )}
              {application ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
