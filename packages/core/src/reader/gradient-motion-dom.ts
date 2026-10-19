import type { FocusReadingSettings } from "../types/book";
import { readableFocusColor } from "./focus-colors";
import { focusGradient, normalizeFocusReading } from "./focus-reading";
import { RandomGradientClock, gradientMotionFrame } from "./gradient-motion";

const IMAGE = "--readany-focus-image";
const SHIFT = "--readany-focus-motion-shift";

/** One shared timeline per book document, also used by both settings previews.
 * Changes CSS paint only; all text, layout, background and opacity stay still. */
export class GradientAnimation {
  private config = normalizeFocusReading();
  private foreground = "#222222";
  private background = "#ffffff";
  private active = true;
  private reducedByHost = false;
  private clock = new RandomGradientClock(20, 45);
  private signature = "";
  private frameId: number | undefined;
  private lastPaint = 0;
  private media: MediaQueryList | undefined;
  private frame: Element | null;
  private wasConnected = false;
  disposed = false;
  constructor(private target: HTMLElement) {
    const doc = target.ownerDocument;
    const win = doc.defaultView;
    this.frame = win?.frameElement ?? null;
    this.wasConnected = this.frame?.isConnected ?? false;
    this.media = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (this.media?.addEventListener) this.media.addEventListener("change", this.sync);
    else this.media?.addListener?.(this.sync);
    doc.addEventListener("visibilitychange", this.sync);
    win?.addEventListener("pagehide", this.destroy);
  }
  update(
    settings: Partial<FocusReadingSettings> | undefined,
    foreground: string,
    background: string,
    active = this.active,
    reduced = this.reducedByHost,
  ) {
    if (this.disposed) return;
    this.config = normalizeFocusReading(settings);
    this.foreground = foreground;
    this.background = background;
    this.active = active;
    this.reducedByHost = reduced;
    const signature = `${this.config.gradientCycleMin}/${this.config.gradientCycleMax}`;
    if (this.signature !== signature) {
      const phase = this.clock.phase;
      this.clock = new RandomGradientClock(
        this.config.gradientCycleMin,
        this.config.gradientCycleMax,
      );
      this.clock.phase = phase;
      this.signature = signature;
    }
    this.sync();
  }
  setActive(active: boolean) {
    this.active = active;
    this.sync();
  }
  setReducedMotion(reduced: boolean) {
    this.reducedByHost = reduced;
    this.sync();
  }
  private sync = () => {
    if (this.disposed) return;
    const reduced = this.reducedByHost || this.media?.matches === true;
    const dynamic = this.config.gradientEnabled && this.config.gradientMotionEnabled;
    const running = dynamic && !reduced && this.active && !this.target.ownerDocument.hidden;
    this.target.dataset.readanyGradientState = !dynamic
      ? "static"
      : reduced
        ? "reduced"
        : running
          ? "running"
          : "paused";
    if (!running) {
      this.cancel();
      this.paint(reduced || !dynamic);
    } else {
      this.paint(false);
      if (this.frameId === undefined)
        this.frameId = this.target.ownerDocument.defaultView?.requestAnimationFrame(this.tick);
    }
  };
  private paint(staticFrame: boolean) {
    if (staticFrame) {
      const a = readableFocusColor(this.config.gradientColor1, this.background, this.foreground);
      const b = readableFocusColor(this.config.gradientColor2, this.background, this.foreground);
      this.target.style.setProperty(IMAGE, focusGradient(a, b, this.foreground));
      this.target.style.setProperty(SHIFT, "0em");
    } else {
      const frame = gradientMotionFrame(
        this.config,
        this.clock.phase,
        this.foreground,
        this.background,
      );
      this.target.style.setProperty(IMAGE, frame.image);
      this.target.style.setProperty(SHIFT, `${frame.offset.toFixed(5)}em`);
    }
  }
  private tick = (timestamp: number) => {
    this.frameId = undefined;
    if (this.disposed) return;
    if (this.frame?.isConnected) this.wasConnected = true;
    if (
      !this.target.isConnected ||
      (this.wasConnected && !this.frame?.isConnected) ||
      !this.target.ownerDocument.defaultView
    ) {
      this.destroy();
      return;
    }
    if (timestamp - this.lastPaint >= 50) {
      this.clock.tick(timestamp);
      this.paint(false);
      this.lastPaint = timestamp;
    }
    this.frameId = this.target.ownerDocument.defaultView.requestAnimationFrame(this.tick);
  };
  private cancel() {
    if (this.frameId !== undefined)
      this.target.ownerDocument.defaultView?.cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.clock.suspend();
    this.lastPaint = 0;
  }
  destroy = () => {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    if (this.media?.removeEventListener) this.media.removeEventListener("change", this.sync);
    else this.media?.removeListener?.(this.sync);
    this.target.ownerDocument.removeEventListener("visibilitychange", this.sync);
    this.target.ownerDocument.defaultView?.removeEventListener("pagehide", this.destroy);
    this.target.style.removeProperty(IMAGE);
    this.target.style.removeProperty(SHIFT);
    delete this.target.dataset.readanyGradientState;
  };
}

/** Install the same motion engine in the small native WebView preview. */
export function installGradientPreview(scope: Window & typeof globalThis) {
  let animation: GradientAnimation | undefined;
  const api = {
    update(
      settings: Partial<FocusReadingSettings>,
      foreground: string,
      background: string,
      active: boolean,
      reduced: boolean,
    ) {
      const target = scope.document.getElementById("preview");
      if (!target) return;
      const config = normalizeFocusReading(settings);
      scope.document.body.style.background = background;
      scope.document.body.style.color = foreground;
      target.style.backgroundImage = config.gradientEnabled ? "var(--readany-focus-image)" : "none";
      target.style.color = config.gradientEnabled ? "transparent" : foreground;
      target.style.setProperty(
        "-webkit-text-fill-color",
        config.gradientEnabled ? "transparent" : foreground,
      );
      animation ??= new GradientAnimation(target);
      animation.update(config, foreground, background, active, reduced);
    },
  };
  Object.assign(scope, { ReadAnyGradientPreview: api });
}
