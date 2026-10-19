import { focusRgb, readableFocusColor } from "./focus-colors";
import { GradientAnimation } from "./gradient-motion-dom";
export { readableFocusColor } from "./focus-colors";
import type { FocusReadingSettings } from "../types/book";
import {
  focusFragment,
  focusGradient,
  focusPagePhase,
  normalizeFocusReading,
  splitFocusText,
} from "./focus-reading";

const MARKER = "data-readany-focus-text";
const STYLE_ID = "readany-focus-gradient";
const gradientAnimations = new WeakMap<Document, GradientAnimation>();

export function stopFocusGradient(doc: Document) {
  gradientAnimations.get(doc)?.destroy();
  gradientAnimations.delete(doc);
}
export function setFocusGradientActive(doc: Document, active: boolean) {
  gradientAnimations.get(doc)?.setActive(active);
}
export function setFocusGradientReducedMotion(doc: Document, reduced: boolean) {
  gradientAnimations.get(doc)?.setReducedMotion(reduced);
}

/** Never split or replace book text nodes: EPUB CFIs and selections stay valid. */
export function syncFocusGradient(
  doc: Document,
  settings: Partial<FocusReadingSettings> | undefined,
  pageKey = "",
  foreground = "#222222",
  background = "#ffffff",
  enabled = true,
) {
  const config = normalizeFocusReading(settings);
  let sheet = doc.getElementById(STYLE_ID);
  if (!enabled || !config.gradientEnabled) {
    stopFocusGradient(doc);
    sheet?.remove();
    for (const node of Array.from(doc.querySelectorAll<HTMLElement>(`[${MARKER}]`))) {
      node.removeAttribute(MARKER);
      node.style.removeProperty("--readany-focus-offset");
    }
    return;
  }
  if (!sheet) {
    sheet = doc.createElement("style");
    sheet.id = STYLE_ID;
    doc.head.append(sheet);
  }
  const first = readableFocusColor(config.gradientColor1, background, foreground);
  const second = readableFocusColor(config.gradientColor2, background, foreground);
  // @supports prevents transparent/invisible text on older unsupported engines.
  sheet.textContent = `@supports ((background-clip: text) or (-webkit-background-clip: text)) {
    [${MARKER}] { background-image: var(--readany-focus-image, ${focusGradient(first, second, foreground)}) !important;
      background-position: calc(var(--readany-focus-offset) + var(--readany-focus-motion-shift, 0em)) 0 !important;
      background-clip: text !important; -webkit-background-clip: text !important;
      color: transparent !important; -webkit-text-fill-color: transparent !important; }
    [${MARKER}] :is(span, em, strong, b, i, a, ruby) {
      color: inherit !important; -webkit-text-fill-color: inherit !important; }
    [${MARKER}] rt { color: ${foreground} !important; -webkit-text-fill-color: ${foreground} !important; }
    [${MARKER}] ::selection { color: ${foreground}; -webkit-text-fill-color: ${foreground}; background: ${first}40; }
  }`;
  let animation = gradientAnimations.get(doc);
  if (!animation || animation.disposed) {
    animation = new GradientAnimation(doc.documentElement);
    gradientAnimations.set(doc, animation);
  }
  animation.update(config, foreground, background);
  const phase = focusPagePhase(pageKey);
  let index = 0;
  for (const node of Array.from(doc.querySelectorAll<HTMLElement>("p, li, blockquote, dd, div"))) {
    if (
      !node.textContent?.trim() ||
      node.querySelector("p, li, blockquote, dd, div, button, input, textarea, select, svg, img") ||
      node.closest("pre, code, svg, table, [hidden], [aria-hidden='true']")
    )
      continue;
    node.setAttribute(MARKER, "");
    node.style.setProperty("--readany-focus-offset", `${((phase + index++ * 137) % 280) / 20}em`);
  }
}

export interface FocusPage {
  key: string;
  text: string;
}
export interface FlashReaderOptions {
  host: HTMLElement;
  readPage: () => FocusPage;
  turnPage: (direction: "next" | "prev") => Promise<unknown>;
  onSettings: () => void;
  onClose: () => void;
  labels: Record<string, string>;
}

/** DOM-only so desktop and RN's WebView use exactly the same playback logic. */
export class FlashReader {
  private config = normalizeFocusReading();
  private root: HTMLElement;
  private band: HTMLElement;
  private before: HTMLElement;
  private anchor: HTMLElement;
  private after: HTMLElement;
  private status: HTMLElement;
  private play: HTMLButtonElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private playing = false;
  private busy = false;
  private disposed = false;
  private fragments: string[] = [];
  private index = 0;
  private pageKey = "";
  private foreground = "#222222";
  private background = "#ffffff";
  private fontFamily = "serif";
  private touchStart: { x: number; y: number } | null = null;
  private gestureMoved = false;
  private resizeObserver?: ResizeObserver;
  private previousFocus: Element | null;

  constructor(private options: FlashReaderOptions) {
    const doc = options.host.ownerDocument;
    this.previousFocus = doc.activeElement;
    this.root = doc.createElement("section");
    this.root.dataset.readanyFlash = "";
    this.root.tabIndex = -1;
    this.root.setAttribute("aria-label", options.labels.title);
    this.root.style.cssText =
      "position:absolute;inset:0;z-index:12;display:flex;flex-direction:column;justify-content:center;outline:none;overflow:hidden;touch-action:pan-y;";
    this.root.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.gestureMoved) this.gestureMoved = false;
    });
    this.root.addEventListener("keydown", this.onKey);
    this.root.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.root.addEventListener("touchend", this.onTouchEnd, { passive: false });
    doc.addEventListener("visibilitychange", this.onVisibility);
    const header = doc.createElement("div");
    header.style.cssText =
      "position:absolute;top:72px;left:20px;right:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:13px system-ui;";
    const title = doc.createElement("span");
    title.textContent = options.labels.title;
    header.append(
      title,
      this.button(options.labels.close, () => options.onClose()),
    );
    this.band = doc.createElement("div");
    this.band.style.cssText =
      "position:relative;display:block;width:100%;min-height:140px;padding:30px 12px;border-block:1px solid;box-sizing:border-box;white-space:pre;line-height:1.5;";
    this.before = doc.createElement("span");
    this.before.style.cssText =
      "position:absolute;right:calc(60% + var(--anchor-half, 0px));top:50%;transform:translateY(-50%);text-align:right";
    this.anchor = doc.createElement("span");
    this.anchor.style.cssText =
      "position:absolute;left:40%;top:50%;transform:translate(-50%,-50%);display:inline-block";
    this.after = doc.createElement("span");
    this.after.style.cssText =
      "position:absolute;left:calc(40% + var(--anchor-half, 0px));top:50%;transform:translateY(-50%)";
    this.band.append(this.before, this.anchor, this.after);
    for (const edge of ["top", "bottom"]) {
      const tick = doc.createElement("i");
      tick.style.cssText = `position:absolute;${edge}:0;left:40%;width:1px;height:14px;background:currentColor;opacity:.65;pointer-events:none;`;
      tick.dataset.tick = "";
      this.band.append(tick);
    }
    const footer = doc.createElement("div");
    footer.style.cssText =
      "position:absolute;bottom:max(76px,env(safe-area-inset-bottom));left:16px;right:16px;display:flex;flex-direction:column;align-items:center;gap:14px;font:12px system-ui;text-align:center;";
    this.status = doc.createElement("span");
    this.status.setAttribute("role", "status");
    const controls = doc.createElement("div");
    controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;";
    this.play = this.button(options.labels.play, () => this.toggle());
    controls.append(
      this.button(
        "←",
        () => {
          this.pause();
          void this.advance(-1);
        },
        options.labels.previous,
      ),
      this.play,
      this.button(
        "→",
        () => {
          this.pause();
          void this.advance(1);
        },
        options.labels.next,
      ),
      this.button(options.labels.settings, () => {
        this.pause();
        options.onSettings();
      }),
    );
    const hint = doc.createElement("span");
    hint.textContent = options.labels.hint;
    hint.style.opacity = "0.65";
    footer.append(this.status, controls, hint);
    this.root.append(header, this.band, footer);
    options.host.append(this.root);
    this.root.focus({ preventScroll: true });
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
      this.resizeObserver = new Observer(() => this.render());
      this.resizeObserver.observe(this.root);
    }
  }

  private button(text: string, action: () => void, label = text): HTMLButtonElement {
    const button = this.options.host.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.style.cssText =
      "appearance:none;background:transparent;color:inherit;border:1px solid currentColor;border-radius:24px;padding:9px 16px;min-height:40px;cursor:pointer;font:inherit;";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
    });
    return button;
  }

  update(
    settings: Partial<FocusReadingSettings> | undefined,
    foreground: string,
    background: string,
    fontFamily = "serif",
  ) {
    this.config = normalizeFocusReading(settings);
    this.foreground = foreground;
    this.background = background;
    this.fontFamily = fontFamily;
    this.root.style.background = `rgba(${focusRgb(background).join(",")},0.90)`;
    this.band.style.background = background;
    this.root.style.color = foreground;
    // Updating any setting pauses playback so the preview remains reviewable.
    this.pause();
    this.refresh();
  }

  refresh() {
    if (this.disposed || this.busy) return;
    const page = this.options.readPage();
    if (page.key !== this.pageKey || !this.fragments.length) {
      this.pageKey = page.key;
      this.fragments = splitFocusText(page.text).filter((part) => part.trim());
      this.index = 0;
    }
    this.render();
  }

  pause = () => {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.render();
  };

  private toggle() {
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.config.flashInterval === 0 || !this.fragments.length || this.disposed || this.busy)
      return;
    this.playing = true;
    this.render();
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.playing && this.config.flashInterval > 0 && !this.disposed) {
      this.timer = setTimeout(() => {
        void this.advance(1);
      }, this.config.flashInterval * 1000);
    }
  }

  private async advance(direction: 1 | -1) {
    if (this.busy || this.disposed) return;
    clearTimeout(this.timer);
    const next = this.index + direction;
    if (next >= 0 && next < this.fragments.length) {
      this.index = next;
    } else {
      this.busy = true;
      const oldKey = this.pageKey;
      try {
        await this.options.turnPage(direction === 1 ? "next" : "prev");
        if (this.disposed) return;
        const page = this.options.readPage();
        const fragments = splitFocusText(page.text).filter((part) => part.trim());
        if (page.key === oldKey || !fragments.length) {
          this.pause();
          return;
        }
        this.pageKey = page.key;
        this.fragments = fragments;
        this.index = direction === 1 ? 0 : fragments.length - 1;
      } catch {
        this.pause();
      } finally {
        this.busy = false;
      }
    }
    if (this.disposed) return;
    this.render();
    this.schedule();
  }

  private render() {
    if (!this.status || this.disposed) return;
    const text = this.fragments[this.index] ?? "";
    const part = focusFragment(text);
    this.before.textContent = part.before;
    // Keep the ticks inside a span separate from the anchor character so
    // measuring the anchor always measures the character itself.
    this.anchor.textContent = part.anchor;
    this.after.textContent = part.after;
    this.band.style.fontFamily = this.fontFamily;
    const available = Math.max(220, this.root.clientWidth) - 32;
    this.band.style.fontSize = `${Math.min(58, Math.max(16, available / Math.max(10, Array.from(text).length * 1.7)))}px`;
    this.band.style.color =
      this.config.flashTextColor === "auto"
        ? this.foreground
        : readableFocusColor(this.config.flashTextColor, this.background, this.foreground);
    this.band.style.borderColor = `${readableFocusColor(this.foreground, this.background, this.foreground)}60`;
    this.anchor.style.color = readableFocusColor(
      this.config.flashHighlightColor,
      this.background,
      this.foreground,
    );
    const bandRect = this.band.getBoundingClientRect();
    const anchorRect = this.anchor.getBoundingClientRect();
    this.band.style.setProperty("--anchor-half", `${anchorRect.width / 2}px`);
    for (const tick of Array.from(this.band.querySelectorAll<HTMLElement>("[data-tick]")))
      tick.style.left = `${anchorRect.left - bandRect.left + anchorRect.width / 2}px`;
    this.play.textContent = this.playing ? this.options.labels.pause : this.options.labels.play;
    this.play.setAttribute("aria-label", this.play.textContent);
    this.play.disabled = this.config.flashInterval === 0 || !text;
    this.play.style.opacity = this.play.disabled ? "0.45" : "1";
    this.status.textContent = text
      ? `${this.index + 1} / ${this.fragments.length} · ${this.config.flashInterval === 0 ? this.options.labels.manual : `${this.config.flashInterval.toFixed(1)} s`}`
      : this.options.labels.empty;
  }

  private onKey = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("input, select, textarea")) return;
    if (!["ArrowLeft", "ArrowRight", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") this.options.onClose();
    else if (event.key === " ") this.toggle();
    else {
      this.pause();
      void this.advance(event.key === "ArrowRight" ? 1 : -1);
    }
  };
  private onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || (event.target as Element).closest("button")) {
      this.touchStart = null;
      return;
    }
    this.touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  private onTouchEnd = (event: TouchEvent) => {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    event.preventDefault();
    event.stopPropagation();
    this.gestureMoved = true;
    this.pause();
    void this.advance(dx < 0 ? 1 : -1);
  };
  private onVisibility = () => {
    if (this.options.host.ownerDocument.hidden) this.pause();
  };

  destroy() {
    this.pause();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.options.host.ownerDocument.removeEventListener("visibilitychange", this.onVisibility);
    this.root.remove();
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected)
      this.previousFocus.focus({ preventScroll: true });
  }
}

/** Await a real relocate; a book-end no-op resolves without an arbitrary sleep. */
export async function turnFocusPage(view: EventTarget, turn: () => unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      view.removeEventListener("relocate", finish);
      resolve();
    };
    const timer = setTimeout(finish, 2500);
    view.addEventListener("relocate", finish, { once: true });
    Promise.resolve()
      .then(turn)
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        view.removeEventListener("relocate", finish);
        reject(error);
      });
  });
}
