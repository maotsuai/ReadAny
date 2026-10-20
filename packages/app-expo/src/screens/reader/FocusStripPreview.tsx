import { gradientPreviewRuntime } from "@/generated/gradient-preview-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { WebView } from "react-native-webview";

export function FocusStripPreview({
  text,
  color,
  highlight,
  background,
}: { text: string; color: string; highlight: string; background: string }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const source = useMemo(
    () => ({
      html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;overflow:hidden;background:${background};color:${color}}#strip{height:100%}i{position:absolute;left:40%;height:12px;width:1px;background:currentColor;pointer-events:none}</style></head><body><div id="strip"></div><i style="top:0"></i><i style="bottom:0"></i><script>${gradientPreviewRuntime.replace(/<\/script/gi, "<\\/script")};window.ReactNativeWebView?.postMessage('ready');</script></body></html>`,
    }),
    [background, color],
  );
  const payload = JSON.stringify([text, color, highlight]);
  useEffect(() => {
    if (ready)
      ref.current?.injectJavaScript(
        `window.ReadAnyFocusStripPreview?.update(...${payload}); true;`,
      );
  }, [ready, payload]);
  return (
    <WebView
      ref={ref}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      scrollEnabled={false}
      nestedScrollEnabled
      javaScriptEnabled
      source={source}
      onMessage={() => setReady(true)}
      onLoadStart={() => setReady(false)}
      style={{ height: 100, backgroundColor: background }}
    />
  );
}
