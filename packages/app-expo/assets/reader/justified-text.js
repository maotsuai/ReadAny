(function installReadAnyJustifiedText(root) {
  const MARKER = "data-readany-justify-body";
  const STYLE_ID = "__readany_justified_text__";
  const PRESERVED_ALIGNMENTS = new Set([
    "center",
    "right",
    "end",
    "-webkit-center",
    "-webkit-right",
  ]);
  const EXCLUDED_ANCESTORS =
    "pre, code, kbd, samp, table, caption, figcaption, form, button, input, textarea, select";

  function shouldJustify(paragraph, unsupportedLayout, view) {
    if (!paragraph || unsupportedLayout || paragraph.querySelector("br")) return false;
    if (paragraph.closest(EXCLUDED_ANCESTORS)) return false;
    const alignment = String(view.getComputedStyle(paragraph).textAlign || "").toLowerCase();
    return !PRESERVED_ALIGNMENTS.has(alignment);
  }

  function apply(doc, enabled, unsupportedLayout) {
    if (!doc || !doc.head) return;

    for (const element of doc.querySelectorAll(`[${MARKER}]`)) {
      element.removeAttribute(MARKER);
    }
    const existingStyle = doc.getElementById(STYLE_ID);
    if (existingStyle) existingStyle.remove();

    if (!enabled || unsupportedLayout || !doc.defaultView) return;

    for (const paragraph of doc.querySelectorAll("p")) {
      if (shouldJustify(paragraph, unsupportedLayout, doc.defaultView)) {
        paragraph.setAttribute(MARKER, "true");
      }
    }

    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[${MARKER}="true"] { text-align: justify !important; text-justify: inter-word; }`;
    doc.head.appendChild(style);
  }

  root.ReadAnyJustifiedText = { apply, shouldJustify };
})(globalThis);
