import { graphemes } from "./focus-reading";

/** A continuous, unbroken page of text. Only the character beneath the fixed
 * reading marker changes color; scrolling never replaces text with phrases. */
export class ManualFocusStrip {
  readonly element: HTMLDivElement;
  private track: HTMLDivElement;
  private characters: HTMLSpanElement[] = [];
  private centers: number[] = [];
  private index = -1;
  private text = "";
  private color = "";
  private highlight = "";
  private observer?: ResizeObserver;
  private pointer: { id: number; x: number; left: number } | null = null;

  constructor(
    host: HTMLElement,
    private onProgress: (index: number, total: number) => void = () => {},
  ) {
    const doc = host.ownerDocument;
    this.element = doc.createElement("div");
    this.element.dataset.readanyFocusStrip = "";
    this.element.tabIndex = 0;
    this.element.style.cssText =
      "position:relative;width:100%;height:100%;min-height:80px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;touch-action:pan-x;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;user-select:none;-webkit-user-select:none;cursor:grab;";
    this.track = doc.createElement("div");
    this.track.style.cssText =
      "position:relative;display:flex;align-items:center;width:max-content;min-height:inherit;height:100%;white-space:pre;box-sizing:content-box;";
    this.track.setAttribute("aria-hidden", "true");
    this.element.append(this.track);
    host.append(this.element);
    this.element.addEventListener("scroll", this.onScroll, { passive: true });
    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);
    this.element.addEventListener("pointerup", this.onPointerEnd);
    this.element.addEventListener("pointercancel", this.onPointerEnd);
    this.element.addEventListener("wheel", this.onWheel, { passive: false });
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
      this.observer = new Observer(this.measure);
      this.observer.observe(this.element);
    }
    doc.defaultView?.addEventListener("resize", this.measure);
  }

  update(text: string, color: string, highlight: string, fontFamily = "serif", fontSize = 36) {
    // Page extraction can contain physical line breaks. Keep all words and
    // punctuation, replacing whitespace breaks with spaces on this single line.
    const line = text.replace(/\s+/gu, " ").trim();
    const changed = line !== this.text;
    this.color = color;
    this.highlight = highlight;
    this.element.style.color = color;
    this.element.style.fontFamily = fontFamily;
    this.element.style.fontSize = `${fontSize}px`;
    this.element.style.lineHeight = "1.5";
    if (changed) {
      this.text = line;
      this.element.setAttribute("aria-label", line);
      this.index = -1;
      this.characters = graphemes(line).map((char) => {
        const span = this.element.ownerDocument.createElement("span");
        span.textContent = char;
        span.style.flex = "none";
        return span;
      });
      this.track.replaceChildren(...this.characters);
    }
    for (let i = 0; i < this.characters.length; i++)
      this.characters[i].style.color = i === this.index ? highlight : color;
    this.measure();
    // A mode switch may need to restore the manual status even when the
    // visible character has not changed since this strip was last shown.
    this.onProgress(Math.max(0, this.index + 1), this.characters.length);
  }

  private measure = () => {
    const anchor = this.element.clientWidth * 0.4;
    this.track.style.paddingLeft = `${anchor}px`;
    this.track.style.paddingRight = `${this.element.clientWidth - anchor}px`;
    this.centers = this.characters.map((span) => span.offsetLeft + span.offsetWidth / 2 - anchor);
    const current = Math.max(0, this.index);
    this.element.scrollLeft = this.centers[current] ?? 0;
    this.onScroll();
  };

  get atStart() {
    return this.element.scrollLeft <= (this.centers[0] ?? 0) + 1;
  }
  get atEnd() {
    return this.element.scrollLeft >= (this.centers[this.centers.length - 1] ?? 0) - 1;
  }

  /** False means this page's edge was already reached; the reader can turn. */
  step(direction: 1 | -1): boolean {
    if (direction === 1 ? this.atEnd : this.atStart) return false;
    this.element.scrollLeft = Math.max(
      this.centers[0] ?? 0,
      Math.min(
        this.centers[this.centers.length - 1] ?? 0,
        this.element.scrollLeft + direction * this.element.clientWidth * 0.65,
      ),
    );
    this.onScroll();
    return true;
  }

  toEnd() {
    this.element.scrollLeft = this.centers[this.centers.length - 1] ?? 0;
    this.onScroll();
  }

  toStart() {
    this.element.scrollLeft = this.centers[0] ?? 0;
    this.onScroll();
  }

  private onScroll = () => {
    if (!this.characters.length) {
      this.onProgress(0, 0);
      return;
    }
    // Locate the glyph closest to the marker without measuring every glyph
    // during each touch/inertial-scroll frame.
    let low = 0;
    let high = this.centers.length - 1;
    const offset = this.element.scrollLeft;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.centers[middle] + this.centers[middle + 1]) / 2 < offset) low = middle + 1;
      else high = middle;
    }
    if (low !== this.index) {
      if (this.characters[this.index]) this.characters[this.index].style.color = this.color;
      this.index = low;
      this.characters[this.index].style.color = this.highlight;
      this.element.dataset.focusCharacter = String(low);
      this.onProgress(low + 1, this.characters.length);
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    this.pointer = { id: event.pointerId, x: event.clientX, left: this.element.scrollLeft };
    this.element.setPointerCapture(event.pointerId);
    this.element.style.cursor = "grabbing";
  };
  private onPointerMove = (event: PointerEvent) => {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    event.preventDefault();
    this.element.scrollLeft = this.pointer.left + this.pointer.x - event.clientX;
    this.onScroll();
  };
  private onPointerEnd = () => {
    this.pointer = null;
    this.element.style.cursor = "grab";
  };
  private onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? this.element.clientWidth : 1;
    this.element.scrollLeft += event.deltaY * unit;
    this.onScroll();
  };

  destroy() {
    this.observer?.disconnect();
    this.element.ownerDocument.defaultView?.removeEventListener("resize", this.measure);
    this.element.remove();
  }
}

/** Native settings previews use this same scrolling/highlighting implementation. */
export function installFocusStripPreview(win: Window) {
  const host = win.document.getElementById("strip");
  if (!host) return;
  const strip = new ManualFocusStrip(host);
  Object.assign(win, {
    ReadAnyFocusStripPreview: {
      update: (text: string, color: string, highlight: string) =>
        strip.update(text, color, highlight, "serif", 24),
    },
  });
  win.addEventListener("pagehide", () => strip.destroy(), { once: true });
}
