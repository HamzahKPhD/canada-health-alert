// Client-side: fetch a Health Canada document page via CORS proxy, force every
// <details>/expandable section open, render in a hidden iframe, then save as PDF
// using html2pdf.js. Mirrors the "Expand All" view the user sees in-browser.

// @ts-ignore - no types shipped
import html2pdf from "html2pdf.js";

const PROXY = "https://corsproxy.io/?";

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function fetchPageHtml(url: string): Promise<string> {
  const res = await fetch(`${PROXY}${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function prepareHtml(rawHtml: string, sourceUrl: string): string {
  let html = rawHtml;

  // Inject <base> so relative CSS/images resolve against the origin
  const baseTag = `<base href="${sourceUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  } else {
    html = `${baseTag}${html}`;
  }

  // Force every <details> open (matches the site's "Expand all" button)
  html = html.replace(/<details(?![^>]*\bopen\b)([^>]*)>/gi, "<details$1 open>");

  // Some Health Canada pages use aria-expanded accordions — flip them too
  html = html.replace(/aria-expanded="false"/gi, 'aria-expanded="true"');
  html = html.replace(/class="([^"]*\bcollapse\b(?!\s+show)[^"]*)"/gi,
    (m, cls) => `class="${cls} show"`);

  return html;
}

async function renderIframe(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "1024px";
    iframe.style.height = "1400px";
    iframe.style.border = "0";
    iframe.srcdoc = html;
    iframe.onload = () => {
      // Give external CSS/images a moment to load
      setTimeout(() => resolve(iframe), 1500);
    };
    iframe.onerror = () => reject(new Error("iframe load failed"));
    document.body.appendChild(iframe);
  });
}

export async function downloadPageAsPdf(url: string, title: string): Promise<void> {
  const raw = await fetchPageHtml(url);
  const prepared = prepareHtml(raw, url);
  const iframe = await renderIframe(prepared);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Cannot access iframe document");

    // Defensive: open any remaining details in the live DOM
    doc.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));

    const target = doc.body;
    const fileName = `${sanitizeFileName(title) || "health-canada-document"}.pdf`;

    await html2pdf()
      .from(target)
      .set({
        margin: 10,
        filename: fileName,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowWidth: 1024,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        // @ts-ignore - pagebreak is supported at runtime but missing from types
        pagebreak: { mode: ["css", "legacy"] },
      } as any)
      .save();
  } finally {
    iframe.remove();
  }
}

export async function downloadManyAsPdf(
  items: { url: string; title: string }[],
  onProgress?: (done: number, total: number, currentTitle: string) => void
): Promise<{ success: number; failed: { title: string; error: string }[] }> {
  let success = 0;
  const failed: { title: string; error: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    onProgress?.(i, items.length, it.title);
    try {
      await downloadPageAsPdf(it.url, it.title);
      success++;
    } catch (err) {
      failed.push({
        title: it.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  onProgress?.(items.length, items.length, "");
  return { success, failed };
}
