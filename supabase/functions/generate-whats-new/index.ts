import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DHPP_BASE = 'https://dhpp.hpfb-dgpsa.ca/review-documents';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---- Types ----
interface DhppDocument {
  type: 'RDS' | 'SBD' | 'SSR';
  title: string;
  url: string;
  product_type: string | null;
  control_number: string | null;
  din: string | null;
  manufacturer: string | null;
  submission_type: string | null;
  date_filed: string | null;
  decision_date: string | null;
  issued_date: string | null;
  updated_date: string | null;
  indication_summary: string | null;
  therapeutic_area: string | null;
  is_backdated: boolean;
}

interface GuidanceItem {
  title: string;
  url: string;
  date: string;
  source: string;
  therapeutic_area: string | null;
}

interface SafetyReviewPeriod {
  period: string;
  reviews: { brand_name: string; ingredient: string; safety_issue: string; trigger: string; therapeutic_area: string | null }[];
  no_reviews_message: string | null;
}

interface MedEffectItem {
  title: string;
  url: string;
  date: string;
  therapeutic_area: string | null;
}

// ---- Fetch with retry (sequential, avoids HTTP/2 errors) ----
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response | null> {
  const isCanadaCa = url.includes('canada.ca');
  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-CA,en;q=0.9',
      };
      
      let fetchUrl = url;
      if (isCanadaCa) {
        fetchUrl = proxies[attempt % proxies.length](url);
      }
      
      const res = await fetch(fetchUrl, { headers });
      if (res.ok) return res;
      console.error(`Fetch ${url} returned ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.error(`Fetch attempt ${attempt + 1} for ${url}: ${err}`);
    }
  }
  return null;
}

// ---- Utility ----
function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isInRange(dateStr: string | null, from: string, to: string): boolean {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
}

// getPublicationDate no longer needed - using DHPP's built-in publication_date filter

function classifyTherapeuticArea(title: string, indication: string | null): string {
  const text = `${title} ${indication || ''}`.toLowerCase();
  if (/\b(chemistry|manufacturing|controls|cmc|formulation|stability|impurit|excipient|specification|analytical|dissolution|bioequivalence)\b/.test(text)) return 'CMC';
  if (/\b(cancer|oncolog|tumor|tumour|carcinoma|lymphoma|leukemia|leukaemia|melanoma|sarcoma|myeloma|neoplasm|chemotherapy|anti-cancer|antineoplastic|metasta|malignant|glioblastoma|immunotherapy for.*cancer|checkpoint inhibitor)\b/.test(text)) return 'ONC';
  if (/\b(cardiovascular|cardiac|heart|hypertension|diabetes|diabet|insulin|renal|kidney|metaboli|cholesterol|lipid|statin|anticoagulant|thrombosis|atherosclerosis|arrhythmia|angina|myocardial|obesity|dyslipidemia|nephro|dialysis|glp-1|sglt2|dpp-4)\b/.test(text)) return 'CVRM';
  if (/\b(clinical trial|cta |phase [i1-3]|investigational|trial application)\b/.test(text)) return 'CTA';
  if (/\b(regulatory|compliance|enforcement|inspection|recall|guidance|policy|label|labelling|monograph|form |notice|administrative|procedural)\b/.test(text)) return 'RAOE';
  if (/\b(vaccine|vaccin|infectious|infection|antiviral|antibiotic|antimicrobial|hiv|hepatitis|influenza|covid|sars|tuberculosis|malaria|fungal|antifungal|immunization|pandemic|pathogen|viral|bacteria)\b/.test(text)) return 'RV&IT';
  return 'OTHER';
}

// ---- DHPP Scraping ----
function extractField(block: string, labelClass: string): string | null {
  const regex = new RegExp(
    `views-label-${labelClass}">[^<]*</span>\\s*<span class="field-content">([^<]*)</span>`, 'i'
  );
  const m = block.match(regex);
  return m ? m[1].trim() || null : null;
}

function parseDhppPage(html: string): DhppDocument[] {
  const documents: DhppDocument[] = [];
  const parts = html.split(/<div class="review-document views-row/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const titleMatch = block.match(/<a href="(https:\/\/dhpp\.hpfb-dgpsa\.ca\/review-documents\/resource\/[^"]+)">([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let type: 'RDS' | 'SBD' | 'SSR' = 'RDS';
    if (block.includes('review-document-sbd')) type = 'SBD';
    else if (block.includes('review-document-ssr')) type = 'SSR';

    documents.push({
      type,
      title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
      url: titleMatch[1],
      product_type: extractField(block, 'name-1'),
      control_number: extractField(block, 'field-control-number-dsts-number'),
      din: extractField(block, 'field-din'),
      manufacturer: extractField(block, 'name-3'),
      submission_type: extractField(block, 'name-5'),
      date_filed: parseDate(extractField(block, 'field-date-filed')),
      decision_date: parseDate(extractField(block, 'field-original-decision-date-1')),
      issued_date: parseDate(extractField(block, 'field-issued-date-1')),
      updated_date: parseDate(extractField(block, 'field-updated-date')),
      indication_summary: null,
      therapeutic_area: null,
      is_backdated: false,
    });
  }
  return documents;
}

function getTotalPages(html: string): number {
  const m = html.match(/Page \d+ of (\d+)/);
  return m ? parseInt(m[1]) : 1;
}

async function scrapeDhpp(dateFrom: string, dateTo: string): Promise<DhppDocument[]> {
  const allDocs: DhppDocument[] = [];
  
  // Use the DHPP website's built-in publication_date filter for accurate results
  const filterParam = `f%5B0%5D=publication_date%3A${dateFrom}~${dateTo}`;
  const firstUrl = `${DHPP_BASE}?${filterParam}`;
  console.log(`DHPP filtered page 0: ${firstUrl}`);
  const firstRes = await fetchWithRetry(firstUrl);
  if (!firstRes) return allDocs;
  const firstHtml = await firstRes.text();
  const firstDocs = parseDhppPage(firstHtml);
  const totalPages = getTotalPages(firstHtml);
  console.log(`DHPP filtered: ${totalPages} total pages, ${firstDocs.length} docs on page 1`);

  // All docs returned by the filter are in range - add them all
  allDocs.push(...firstDocs);

  // Continue pagination with the same filter
  const maxPages = Math.min(totalPages, 30);
  for (let page = 1; page < maxPages; page++) {
    const url = `${DHPP_BASE}?${filterParam}&page=${page}`;
    console.log(`DHPP filtered page ${page}: ${url}`);
    const res = await fetchWithRetry(url);
    if (!res) break;
    const html = await res.text();
    const docs = parseDhppPage(html);
    if (docs.length === 0) break;
    allDocs.push(...docs);
  }
  
  console.log(`DHPP: ${allDocs.length} documents found in date range`);
  return allDocs;
}

// Extended scrape for backdating
async function scrapeDhppExtended(dateFrom: string, dateTo: string): Promise<DhppDocument[]> {
  const extendedFrom = new Date(dateFrom + 'T00:00:00');
  extendedFrom.setDate(extendedFrom.getDate() - 28);
  const extFromStr = extendedFrom.toISOString().split('T')[0];
  
  // Use publication_date filter for the extended 4-week lookback period
  const filterParam = `f%5B0%5D=publication_date%3A${extFromStr}~${dateTo}`;
  const allDocs: DhppDocument[] = [];
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const url = page === 0 ? `${DHPP_BASE}?${filterParam}` : `${DHPP_BASE}?${filterParam}&page=${page}`;
    console.log(`DHPP extended page ${page}: ${url}`);
    const res = await fetchWithRetry(url);
    if (!res) break;
    const html = await res.text();
    const docs = parseDhppPage(html);
    if (docs.length === 0) break;
    allDocs.push(...docs);
  }
  return allDocs;
}

// ---- Backdating detection ----
async function detectBackdated(
  currentDocs: DhppDocument[],
  dateFrom: string,
  dateTo: string,
  supabase: ReturnType<typeof createClient>
): Promise<DhppDocument[]> {
  const lookbackFrom = new Date(dateFrom + 'T00:00:00');
  lookbackFrom.setDate(lookbackFrom.getDate() - 28);
  const lookbackStr = lookbackFrom.toISOString().split('T')[0];

  const { data: snapshots } = await supabase
    .from('report_snapshots')
    .select('document_urls, report_date_from, report_date_to')
    .gte('report_date_to', lookbackStr)
    .lt('report_date_from', dateFrom)
    .order('created_at', { ascending: false });

  if (!snapshots || snapshots.length === 0) {
    console.log('No previous snapshots found for backdating detection');
    return [];
  }

  const previousUrls = new Set<string>();
  for (const snap of snapshots) {
    const urls = snap.document_urls as string[];
    if (Array.isArray(urls)) urls.forEach(u => previousUrls.add(u));
  }
  console.log(`Previous snapshots contain ${previousUrls.size} URLs`);

  const extendedDocs = await scrapeDhppExtended(dateFrom, dateTo);
  const backdated: DhppDocument[] = [];
  const currentUrlSet = new Set(currentDocs.map(d => d.url));

  for (const doc of extendedDocs) {
    const pubDate = doc.issued_date || doc.updated_date || doc.decision_date;
    if (!pubDate) continue;
    if (currentUrlSet.has(doc.url)) continue;
    if (pubDate >= lookbackStr && pubDate < dateFrom) {
      if (!previousUrls.has(doc.url)) {
        doc.is_backdated = true;
        backdated.push(doc);
      }
    }
  }
  console.log(`Found ${backdated.length} backdated documents`);
  return backdated;
}

async function saveSnapshot(
  docs: DhppDocument[],
  dateFrom: string,
  dateTo: string,
  supabase: ReturnType<typeof createClient>
) {
  const urls = docs.filter(d => !d.is_backdated).map(d => d.url);
  await supabase.from('report_snapshots').insert({
    report_date_from: dateFrom,
    report_date_to: dateTo,
    document_urls: urls,
  });
}

// ---- Detail page + AI summary ----
function extractDetailSections(html: string): string {
  const sections: string[] = [];
  const detailsRegex = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div class="details-wrapper">([\s\S]*?)<\/div>\s*<\/details>/gi;
  let match;
  while ((match = detailsRegex.exec(html)) !== null) {
    const heading = match[1].replace(/<[^>]+>/g, '').trim();
    const content = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (heading && content) sections.push(`${heading}: ${content}`);
  }
  const therapeuticMatch = html.match(/<strong>Therapeutic Area:\s*<\/strong>[\s\S]*?<p>([^<]+)<\/p>/i);
  if (therapeuticMatch) sections.push(`Therapeutic Area: ${therapeuticMatch[1].trim()}`);
  const ingredientMatch = html.match(/<strong>Medicinal Ingredient\(s\):\s*<\/strong>[\s\S]*?<p>([^<]+)<\/p>/i);
  if (ingredientMatch) sections.push(`Medicinal Ingredient: ${ingredientMatch[1].trim()}`);
  return sections.join('\n\n');
}

async function getAiSummary(pageText: string, title: string): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return null;
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: 'You are a pharmaceutical regulatory expert. Given text from a Health Canada review document, extract a concise 1-2 sentence summary of what the drug is indicated/approved for. For biosimilars, state that it is a biosimilar and mention the reference drug. For safety reviews, summarize the safety concern. Be precise and clinical. Only return the summary text.' },
          { role: 'user', content: `Document title: ${title}\n\nPage content:\n${pageText.substring(0, 3000)}` }
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

async function enrichWithIndications(docs: DhppDocument[], supabase: ReturnType<typeof createClient>): Promise<void> {
  const urls = docs.map(d => d.url);
  const { data: existing } = await supabase
    .from('review_documents')
    .select('url, indication_summary')
    .in('url', urls);

  const summaryMap = new Map<string, string>();
  if (existing) {
    for (const row of existing) {
      if (row.indication_summary && row.indication_summary !== 'Not available for this document type') {
        summaryMap.set(row.url, row.indication_summary);
      }
    }
  }

  const needFetch: DhppDocument[] = [];
  for (const doc of docs) {
    if (summaryMap.has(doc.url)) {
      doc.indication_summary = summaryMap.get(doc.url)!;
    } else {
      needFetch.push(doc);
    }
  }

  // Fetch detail pages SEQUENTIALLY to avoid HTTP/2 errors
  const toProcess = needFetch.slice(0, 10);
  console.log(`Fetching ${toProcess.length} detail pages for AI summaries`);

  for (const doc of toProcess) {
    try {
      const res = await fetchWithRetry(doc.url);
      if (!res) {
        doc.indication_summary = 'Not available for this document type';
        continue;
      }
      const html = await res.text();
      const text = extractDetailSections(html);
      if (!text) {
        doc.indication_summary = 'Not available for this document type';
        continue;
      }
      const summary = await getAiSummary(text, doc.title);
      doc.indication_summary = summary || 'Not available for this document type';
    } catch {
      doc.indication_summary = 'Not available for this document type';
    }
  }

  for (const doc of docs) {
    doc.therapeutic_area = classifyTherapeuticArea(doc.title, doc.indication_summary);
  }
}

// ---- What's New pages scraping ----
// These pages use accordion <details> with year headers and <h3> month headers
// Items are in <ul><li> with dates in [YYYY-MM-DD] format (sometimes wrapped in <span class="nowrap">)
function parseWhatsNewPage(html: string, dateFrom: string, dateTo: string, source: string): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  
  // Only skip items already covered by the DHPP/RDS/SBD section or truly irrelevant
  const skipPatterns = [
    'Summary Basis of Decision',
    'Regulatory Decision Summary',
  ];

  // Extract all <li> items with links and dates
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const content = match[1];
    const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    // Date can be in [YYYY-MM-DD] or inside <span class="nowrap">[YYYY-MM-DD]</span>
    const dateMatch = content.match(/\[(\d{4}-\d{2}-\d{2})\]/);
    if (!linkMatch || !dateMatch) continue;

    const date = dateMatch[1];
    if (!isInRange(date, dateFrom, dateTo)) continue;

    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    
    if (skipPatterns.some(p => title.includes(p))) continue;

    const url = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`;
    items.push({ title, url, date, source, therapeutic_area: classifyTherapeuticArea(title, null) });
  }
  return items;
}

async function scrapeAllWhatsNewPages(dateFrom: string, dateTo: string): Promise<GuidanceItem[]> {
  const allItems: GuidanceItem[] = [];
  
  // Scrape each page SEQUENTIALLY to avoid HTTP/2 stream errors
  const pages = [
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/what-new-drug-products-health-canada.html', source: 'Drug Products' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/biologics-radio-pharmaceuticals-genetic-therapies/what-new-biologics-radiopharmaceuticals-genetic-therapies-health-canada.html', source: 'Biologics' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/compliance-enforcement/what-new.html', source: 'Compliance & Enforcement' },
  ];

  for (const { url, source } of pages) {
    console.log(`Scraping ${source}: ${url}`);
    const res = await fetchWithRetry(url);
    if (!res) {
      console.error(`Failed to fetch ${source} after retries`);
      continue;
    }
    const html = await res.text();
    const items = parseWhatsNewPage(html, dateFrom, dateTo, source);
    console.log(`${source}: found ${items.length} items`);
    allItems.push(...items);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  return allItems;
}

// ---- Consultations scraping ----
async function scrapeConsultations(dateFrom: string, dateTo: string): Promise<GuidanceItem[]> {
  console.log('Scraping consultations...');
  const url = 'https://www.canada.ca/en/health-canada/services/drugs-health-products/public-involvement-consultations/current-past-consultations.html';
  const res = await fetchWithRetry(url);
  if (!res) return [];
  const html = await res.text();
  const items: GuidanceItem[] = [];

  // Parse consultation items looking for date ranges with end dates
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const content = match[1];
    const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    const itemUrl = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`;

    // Look for end date patterns
    let endDate: string | null = null;
    
    // Pattern: "to YYYY-MM-DD" or "ends YYYY-MM-DD" etc
    const endDatePatterns = [
      /(?:to|end|ends|closing|deadline|until)\s*(?::|)\s*(\d{4}-\d{2}-\d{2})/i,
      /(\d{4}-\d{2}-\d{2})\s*$/,
      /\[(\d{4}-\d{2}-\d{2})\]/,
    ];
    
    // Also look for date ranges like "January 15, 2026 to February 28, 2026"
    const naturalDateRange = content.match(/(?:to|until)\s+(\w+ \d{1,2},?\s*\d{4})/i);
    if (naturalDateRange) {
      try {
        const d = new Date(naturalDateRange[1]);
        if (!isNaN(d.getTime())) endDate = d.toISOString().split('T')[0];
      } catch { /* skip */ }
    }

    if (!endDate) {
      for (const pat of endDatePatterns) {
        const m = content.match(pat);
        if (m) {
          endDate = parseDate(m[1]);
          break;
        }
      }
    }

    if (endDate && isInRange(endDate, dateFrom, dateTo)) {
      items.push({ title, url: itemUrl, date: endDate, source: 'Consultations', therapeutic_area: classifyTherapeuticArea(title, null) });
    }
  }
  console.log(`Consultations: found ${items.length} items`);
  return items;
}

// ---- MedEffect scraping ----
async function scrapeMedEffectWhatsNew(dateFrom: string, dateTo: string): Promise<MedEffectItem[]> {
  console.log('Scraping MedEffect What\'s New...');
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetchWithRetry('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/what-new.html');
  if (!res) return [];
  const html = await res.text();
  const items: MedEffectItem[] = [];
  
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const content = match[1];
    const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const dateMatch = content.match(/\[(\d{4}-\d{2}-\d{2})\]/);
    if (!linkMatch || !dateMatch) continue;
    const date = dateMatch[1];
    if (!isInRange(date, dateFrom, dateTo)) continue;
    const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    items.push({
      title,
      url: linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`,
      date,
      therapeutic_area: classifyTherapeuticArea(title, null),
    });
  }
  console.log(`MedEffect What's New: found ${items.length} items`);
  return items;
}

async function scrapeSafetyReviews(dateFrom: string, dateTo: string): Promise<{ periods: SafetyReviewPeriod[] }> {
  console.log('Scraping Safety Reviews...');
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetchWithRetry('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/safety-reviews/new.html');
  if (!res) return { periods: [] };
  const html = await res.text();

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const periods: SafetyReviewPeriod[] = [];

  const periodRegex = /List of Safety and Effectiveness Reviews Initiated from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g;
  let periodMatch;
  const periodPositions: { periodFrom: string; periodTo: string }[] = [];
  while ((periodMatch = periodRegex.exec(text)) !== null) {
    periodPositions.push({ periodFrom: periodMatch[1], periodTo: periodMatch[2] });
  }

  const noReviewRegex = /No safety and effectiveness reviews initiated from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g;
  let noMatch;
  const noReviewPeriods: { from: string; to: string }[] = [];
  while ((noMatch = noReviewRegex.exec(text)) !== null) {
    noReviewPeriods.push({ from: noMatch[1], to: noMatch[2] });
  }

  for (const period of periodPositions) {
    if (period.periodTo < dateFrom || period.periodFrom > dateTo) continue;

    const periodLabel = `${period.periodFrom} to ${period.periodTo}`;
    const noReview = noReviewPeriods.find(nr => nr.from === period.periodFrom);
    if (noReview) {
      periods.push({
        period: periodLabel,
        reviews: [],
        no_reviews_message: `No safety and effectiveness reviews initiated from ${noReview.from} to ${noReview.to}`,
      });
      continue;
    }

    const reviews: SafetyReviewPeriod['reviews'] = [];
    const periodHeaderInHtml = html.indexOf(`List of Safety and Effectiveness Reviews Initiated from ${period.periodFrom} to ${period.periodTo}`);
    if (periodHeaderInHtml === -1) continue;

    const nextTableStart = html.indexOf('<table', periodHeaderInHtml);
    if (nextTableStart === -1) continue;
    const nextTableEnd = html.indexOf('</table>', nextTableStart);
    if (nextTableEnd === -1) continue;

    const tableHtml = html.substring(nextTableStart, nextTableEnd + 8);
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isHeader = true;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      if (isHeader) { isHeader = false; continue; }
      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length >= 4) {
        reviews.push({
          brand_name: cells[0],
          ingredient: cells[1],
          safety_issue: cells[2],
          trigger: cells[3],
          therapeutic_area: classifyTherapeuticArea(cells[0], cells[2]),
        });
      }
    }
    periods.push({ period: periodLabel, reviews, no_reviews_message: null });
  }

  console.log(`Safety Reviews: found ${periods.length} periods`);
  return { periods };
}

// ---- Main handler ----
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dateFrom, dateTo, phase } = await req.json();
    if (!dateFrom || !dateTo) {
      return new Response(
        JSON.stringify({ error: 'dateFrom and dateTo are required (YYYY-MM-DD)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Phase 1: DHPP scraping + backdating + AI enrichment
    if (phase === 1 || !phase) {
      console.log(`Phase 1: DHPP scraping for ${dateFrom} to ${dateTo}`);
      const dhppDocs = await scrapeDhpp(dateFrom, dateTo);
      console.log(`DHPP: ${dhppDocs.length} documents found`);

      const backdatedDocs = await detectBackdated(dhppDocs, dateFrom, dateTo, supabase);
      const allDhppDocs = [...dhppDocs, ...backdatedDocs];
      console.log(`DHPP: ${dhppDocs.length} (+ ${backdatedDocs.length} backdated)`);

      if (allDhppDocs.length > 0) {
        await enrichWithIndications(allDhppDocs, supabase);
      }

      await saveSnapshot(dhppDocs, dateFrom, dateTo, supabase);

      if (phase === 1) {
        return new Response(
          JSON.stringify({ phase: 1, transparency_documents: allDhppDocs }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Phase 2: canada.ca guidance + consultations
    if (phase === 2) {
      console.log(`Phase 2: Guidance & Consultations for ${dateFrom} to ${dateTo}`);
      const guidanceItems = await scrapeAllWhatsNewPages(dateFrom, dateTo);
      const consultationItems = await scrapeConsultations(dateFrom, dateTo);
      const allGuidance = [...guidanceItems, ...consultationItems];
      console.log(`Guidance: ${guidanceItems.length}, Consultations: ${consultationItems.length}`);

      return new Response(
        JSON.stringify({ phase: 2, guidance_documents: allGuidance }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Phase 3: MedEffect + Safety Reviews
    if (phase === 3) {
      console.log(`Phase 3: MedEffect & Safety for ${dateFrom} to ${dateTo}`);
      const medEffectItems = await scrapeMedEffectWhatsNew(dateFrom, dateTo);
      const safetyData = await scrapeSafetyReviews(dateFrom, dateTo);
      console.log(`MedEffect: ${medEffectItems.length}, Safety periods: ${safetyData.periods.length}`);

      return new Response(
        JSON.stringify({ phase: 3, medeffect_whats_new: medEffectItems, safety_reviews: safetyData.periods }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Legacy: no phase specified, do everything (may timeout for large ranges)
    console.log(`Generating full report for ${dateFrom} to ${dateTo}`);
    const dhppDocs = await scrapeDhpp(dateFrom, dateTo);
    const backdatedDocs = await detectBackdated(dhppDocs, dateFrom, dateTo, supabase);
    const allDhppDocs = [...dhppDocs, ...backdatedDocs];
    if (allDhppDocs.length > 0) await enrichWithIndications(allDhppDocs, supabase);
    await saveSnapshot(dhppDocs, dateFrom, dateTo, supabase);
    const guidanceItems = await scrapeAllWhatsNewPages(dateFrom, dateTo);
    const consultationItems = await scrapeConsultations(dateFrom, dateTo);
    const medEffectItems = await scrapeMedEffectWhatsNew(dateFrom, dateTo);
    const safetyData = await scrapeSafetyReviews(dateFrom, dateTo);

    return new Response(
      JSON.stringify({
        date_range: { from: dateFrom, to: dateTo },
        transparency_documents: allDhppDocs,
        guidance_documents: [...guidanceItems, ...consultationItems],
        medeffect_whats_new: medEffectItems,
        safety_reviews: safetyData.periods,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Report generation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
