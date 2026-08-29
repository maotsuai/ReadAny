import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const helperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/reader/justified-text.js",
);

const marker = "data-readany-justify-body";

class FakeParagraph {
  readonly attributes = new Map<string, string>();

  constructor(
    public alignment: string,
    private readonly hasLineBreak = false,
    private readonly hasExcludedAncestor = false,
  ) {}

  querySelector(selector: string): object | null {
    return selector === "br" && this.hasLineBreak ? {} : null;
  }

  closest(): object | null {
    return this.hasExcludedAncestor ? {} : null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class FakeDocument {
  style: { id: string; textContent: string; remove: () => void } | null = null;
  readonly defaultView = {
    getComputedStyle: (paragraph: FakeParagraph) => ({ textAlign: paragraph.alignment }),
  };
  readonly head = {
    appendChild: (style: { id: string; textContent: string; remove: () => void }) => {
      this.style = style;
    },
  };

  constructor(readonly paragraphs: FakeParagraph[]) {}

  querySelectorAll(selector: string): FakeParagraph[] {
    if (selector === "p") return this.paragraphs;
    if (selector === `[${marker}]`) {
      return this.paragraphs.filter((paragraph) => paragraph.attributes.has(marker));
    }
    return [];
  }

  getElementById(id: string): FakeDocument["style"] {
    return this.style?.id === id ? this.style : null;
  }

  createElement(): NonNullable<FakeDocument["style"]> {
    const style = {
      id: "",
      textContent: "",
      remove: () => {
        if (this.style === style) this.style = null;
      },
    };
    return style;
  }
}

interface JustifiedTextApi {
  apply: (doc: FakeDocument, enabled: boolean, unsupportedLayout: boolean) => void;
  shouldJustify: (
    paragraph: FakeParagraph,
    unsupportedLayout: boolean,
    view: FakeDocument["defaultView"],
  ) => boolean;
}

function loadHelper(): JustifiedTextApi | null {
  if (!existsSync(helperPath)) return null;
  const context: Record<string, unknown> = {};
  context.globalThis = context;
  runInNewContext(readFileSync(helperPath, "utf8"), context);
  return context.ReadAnyJustifiedText as JustifiedTextApi;
}

describe("reader-side justified text helper", () => {
  it("justifies only eligible ordinary paragraphs", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const doc = new FakeDocument([]);
    expect(api.shouldJustify(new FakeParagraph("left"), false, doc.defaultView)).toBe(true);
    expect(api.shouldJustify(new FakeParagraph("center"), false, doc.defaultView)).toBe(false);
    expect(api.shouldJustify(new FakeParagraph("right"), false, doc.defaultView)).toBe(false);
    expect(api.shouldJustify(new FakeParagraph("left", true), false, doc.defaultView)).toBe(false);
    expect(api.shouldJustify(new FakeParagraph("left", false, true), false, doc.defaultView)).toBe(
      false,
    );
    expect(api.shouldJustify(new FakeParagraph("left"), true, doc.defaultView)).toBe(false);
  });

  it("reclassifies paragraphs and fully restores book alignment when disabled", () => {
    const api = loadHelper();
    expect(api).not.toBeNull();
    if (!api) return;

    const left = new FakeParagraph("left");
    const centered = new FakeParagraph("center");
    const doc = new FakeDocument([left, centered]);

    api.apply(doc, true, false);
    expect(left.attributes.get(marker)).toBe("true");
    expect(centered.attributes.has(marker)).toBe(false);
    expect(doc.style?.textContent).toContain("text-align: justify !important");
    expect(doc.style?.textContent).toContain("text-justify: inter-word");

    left.alignment = "center";
    api.apply(doc, true, false);
    expect(left.attributes.has(marker)).toBe(false);
    expect(doc.style).not.toBeNull();

    api.apply(doc, false, false);
    expect(left.attributes.has(marker)).toBe(false);
    expect(centered.attributes.has(marker)).toBe(false);
    expect(doc.style).toBeNull();
  });
});
