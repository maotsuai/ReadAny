import { resolveIncomingBookFile } from "@/lib/library/system-book-file";
import { navigate, navigationRef } from "@/lib/navigationRef";
import { useLibraryStore } from "@/stores/library-store";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

interface SystemBookOpenHandlerProps {
  enabled: boolean;
  navigationReady: boolean;
  libraryLoaded: boolean;
}

async function importAndOpenBookUrl(url: string, showError: (message: string) => void) {
  const file = await resolveIncomingBookFile(url);
  if (!file) return;

  const store = useLibraryStore.getState();
  const result = await store.importBooks([file]);
  const targetBook = result.imported[0] ?? result.skippedDuplicates[0]?.existingBook;

  if (targetBook) {
    navigate("Reader", { bookId: targetBook.id });
    return;
  }

  const failure = result.failures[0];
  if (failure) showError(failure.error);
}

/**
 * Bridges cold-start and warm-start document URLs into the existing library
 * importer. The queue waits for bootstrap, onboarding, navigation, and the
 * initial library load so opening a book cannot race database hydration.
 */
export function SystemBookOpenHandler({
  enabled,
  navigationReady,
  libraryLoaded,
}: SystemBookOpenHandlerProps) {
  const { t } = useTranslation();
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const processing = useRef(false);
  const lastQueued = useRef<{ url: string; at: number } | null>(null);

  useEffect(() => {
    let active = true;
    const enqueue = (url: string | null) => {
      if (!active || !url) return;
      const now = Date.now();
      if (lastQueued.current?.url === url && now - lastQueued.current.at < 1000) return;
      lastQueued.current = { url, at: now };
      setPendingUrls((current) => [...current, url]);
    };

    const subscription = Linking.addEventListener("url", ({ url }) => enqueue(url));
    void Linking.getInitialURL().then(enqueue).catch(console.error);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !navigationReady || !libraryLoaded || processing.current) return;
    if (!navigationRef.isReady()) return;

    const url = pendingUrls[0];
    if (!url) return;

    processing.current = true;
    void importAndOpenBookUrl(url, (message) => {
      Alert.alert(t("common.error", "Error"), message);
    })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[SystemBookOpen] Failed to open incoming book:", error);
        Alert.alert(t("common.error", "Error"), message);
      })
      .finally(() => {
        processing.current = false;
        setPendingUrls((current) => (current[0] === url ? current.slice(1) : current));
      });
  }, [enabled, libraryLoaded, navigationReady, pendingUrls, t]);

  return null;
}
