import { gradientPreviewRuntime } from "@/generated/gradient-preview-runtime";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { FocusReadingSettings } from "@readany/core/types/book";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { WebView } from "react-native-webview";

export function GradientTextPreview({
  config,
  foreground,
  background,
  text,
  active,
}: {
  config: FocusReadingSettings;
  foreground: string;
  background: string;
  text: string;
  active: boolean;
}) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const reduced = useReducedMotion();
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => listener.remove();
  }, []);
  const html = useMemo(() => {
    const escaped = text.replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
    );
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>body{margin:0;padding:8px 14px;background:${background};color:${foreground};font:17px/1.9 serif}p{margin:0;background-position:var(--readany-focus-motion-shift,0em) 0;background-clip:text;-webkit-background-clip:text}</style></head><body><p id="preview">${escaped}</p><script>${gradientPreviewRuntime.replace(/<\/script/gi, "<\\/script")};window.ReactNativeWebView?.postMessage('ready');</script></body></html>`;
  }, [text, foreground, background]);
  const source = useMemo(() => ({ html }), [html]);
  const payload = JSON.stringify([config, foreground, background, active && appActive, reduced]);
  useEffect(() => {
    if (!ready) return;
    ref.current?.injectJavaScript(`window.ReadAnyGradientPreview?.update(...${payload}); true;`);
  }, [ready, payload]);
  return (
    <WebView
      ref={ref}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      scrollEnabled={false}
      javaScriptEnabled
      source={source}
      onMessage={() => setReady(true)}
      onLoadStart={() => setReady(false)}
      style={{ height: 132, backgroundColor: background }}
    />
  );
}
