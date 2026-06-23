// Client-side: fetch a Health Canada document page via CORS proxy, force every
// <details>/expandable section open, inject into the main document, then save
// as PDF using html2pdf.js. Mirrors the "Expand all" view the user sees.

// @ts-ignore - no types shipped
import html2pdf from "html2pdf.js";

// Try multiple CORS proxies in order — corsproxy.io occasionally rate-limits.
const PROXIES = [
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function fetchPageHtml(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (const build of PROXIES) {
    try {
      const res = await fetch(build(url));
      if (!res.ok) {
        lastErr = new Error(`status ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text && text.length > 500) return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to fetch via proxies: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

function buildPdfContainer(rawHtml: string, sourceUrl: string, title: string): HTMLDivElement {
  // Parse the page so we can pull only the useful content into the main document.
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  // Force every <details> open
  doc.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  // Flip aria-expanded accordions
  doc.querySelectorAll('[aria-expanded="false"]').forEach((el) =>
    el.setAttribute("aria-expanded", "true")
  );
  // Bootstrap-style collapse
  doc.querySelectorAll(".collapse").forEach((el) => el.classList.add("show"));

  // Strip elements that break PDF rendering or aren't useful
  doc
    .querySelectorAll(
      'script, noscript, iframe, link[rel="stylesheet"], style, header nav, footer, .wb-bc, #wb-bc, .gc-prtts, .pagedetails, form[role="search"]'
    )
    .forEach((el) => el.remove());

  // Pick the main content area; fall back to body
  const main =
    doc.querySelector("main") ||
    doc.querySelector('[role="main"]') ||
    doc.querySelector("#wb-cont") ||
    doc.body;

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "900px";
  container.style.background = "#ffffff";
  container.style.color = "#000000";
  container.style.fontFamily = "Arial, Helvetica, sans-serif";
  container.style.fontSize = "12px";
  container.style.lineHeight = "1.5";
  container.style.padding = "16px";

  const header = document.createElement("div");
  header.style.marginBottom = "12px";
  header.style.borderBottom = "1px solid #999";
  header.style.paddingBottom = "8px";
  header.innerHTML = `<h1 style="font-size:18px;margin:0 0 6px">${title.replace(/[<>&]/g, "")}</h1>
    <div style="font-size:10px;color:#444">Source: ${sourceUrl}</div>`;
  container.appendChild(header);

  // Import the main subtree into the current document so html2canvas can render it
  container.appendChild(document.importNode(main, true));

  // Rewrite relative image/anchor URLs against the source URL
  container.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (src && !/^https?:/i.test(src) && !src.startsWith("data:")) {
      try {
        img.setAttribute("src", new URL(src, sourceUrl).toString());
      } catch {}
    }
    img.setAttribute("crossorigin", "anonymous");
  });

  document.body.appendChild(container);
  return container;
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          // safety timeout
          setTimeout(() => resolve(), 4000);
        })
    )
  );
}

export async function downloadPageAsPdf(url: string, title: string): Promise<void> {
  const raw = await fetchPageHtml(url);
  const container = buildPdfContainer(raw, url, title);

  try {
    await waitForImages(container);

    const fileName = `${sanitizeFileName(title) || "health-canada-document"}.pdf`;

    await html2pdf()
      .from(container)
      .set({
        margin: 10,
        filename: fileName,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: 900,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        // @ts-ignore - pagebreak is supported at runtime but missing from types
        pagebreak: { mode: ["css", "legacy", "avoid-all"] },
      } as any)
      .save();
  } finally {
    container.remove();
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
