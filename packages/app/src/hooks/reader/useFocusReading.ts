import { useSettingsStore } from "@/stores/settings-store";
import type { FoliateView } from "@readany/core/hooks/reader/useFoliateView";
import i18n from "@readany/core/i18n";
import { focusLabels, normalizeFocusReading } from "@readany/core/reader/focus-reading";
import {
  FlashReader,
  setFocusGradientActive,
  stopFocusGradient,
  syncFocusGradient,
  turnFocusPage,
} from "@readany/core/reader/focus-reading-dom";
import type { ViewSettings } from "@readany/core/types";
import { type RefObject, useEffect, useRef } from "react";

interface Options {
  viewRef: RefObject<FoliateView | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  ready: boolean;
  active: boolean;
  bookKey: string;
  fixed: boolean;
  settings: ViewSettings;
  foreground: string;
  background: string;
  readText: () => string;
  onSettings?: () => void;
}

export function useFocusReading(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const syncRef = useRef<(...args: [ViewSettings, string, string, boolean, boolean]) => void>(
    () => {},
  );
  useEffect(() => {
    const view = options.viewRef.current;
    const host = options.containerRef.current;
    if (!view || !host || !options.ready) return;
    let flash: FlashReader | undefined;
    const documents = new Set<Document>();
    const rememberDocument = (doc: Document) => {
      for (const previous of documents) {
        if (!previous.defaultView || previous.defaultView.frameElement?.isConnected === false) {
          stopFocusGradient(previous);
          documents.delete(previous);
        }
      }
      documents.add(doc);
    };
    let pageKey = `${options.bookKey}:initial`;
    const sync = (update = true) => {
      let shouldUpdate = update;
      const current = latest.current;
      const config = normalizeFocusReading(current.settings.focusReading);
      const contents: { doc: Document }[] = view.renderer?.getContents?.() ?? [];
      for (const { doc } of contents) {
        rememberDocument(doc);
        syncFocusGradient(
          doc,
          config,
          pageKey,
          current.foreground,
          current.background,
          !current.fixed,
        );
        setFocusGradientActive(doc, current.active && !config.flashEnabled);
      }
      if (!config.flashEnabled || !current.active) {
        flash?.destroy();
        flash = undefined;
        return;
      }
      if (!flash) {
        flash = new FlashReader({
          host,
          readPage: () => ({ key: pageKey, text: latest.current.readText() }),
          turnPage: (direction) =>
            turnFocusPage(view, () => {
              const distance = view.renderer?.scrolled
                ? Math.max(1, host.clientHeight - 48)
                : undefined;
              return direction === "next" ? view.next(distance) : view.prev(distance);
            }),
          onSettings: () => latest.current.onSettings?.(),
          onClose: () =>
            useSettingsStore.getState().updateReadSettings({
              focusReading: {
                ...normalizeFocusReading(latest.current.settings.focusReading),
                flashEnabled: false,
              },
            }),
          labels: focusLabels((key) => String(i18n.t(key))),
        });
        shouldUpdate = true;
      }
      if (shouldUpdate)
        flash.update(
          config,
          current.foreground,
          current.background,
          current.settings.customFontFamily,
        );
      else flash.refresh();
    };
    const relocate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      pageKey = detail.cfi ?? JSON.stringify([detail.section, detail.page, detail.fraction]);
      sync(false);
    };
    const load = (event: Event) => {
      const current = latest.current;
      const doc = (event as CustomEvent).detail.doc as Document;
      rememberDocument(doc);
      syncFocusGradient(
        doc,
        current.settings.focusReading,
        pageKey,
        current.foreground,
        current.background,
        !current.fixed,
      );
      setFocusGradientActive(doc, current.active && !current.settings.focusReading?.flashEnabled);
    };
    syncRef.current = () => sync();
    view.addEventListener("load", load);
    view.addEventListener("relocate", relocate);
    sync();
    return () => {
      syncRef.current = () => {};
      flash?.destroy();
      for (const doc of documents) stopFocusGradient(doc);
      view.removeEventListener("load", load);
      view.removeEventListener("relocate", relocate);
    };
  }, [options.ready, options.bookKey, options.viewRef, options.containerRef]);
  useEffect(() => {
    syncRef.current(
      options.settings,
      options.foreground,
      options.background,
      options.active,
      options.fixed,
    );
  }, [options.settings, options.foreground, options.background, options.active, options.fixed]);
}
