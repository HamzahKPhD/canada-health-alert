import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DHPP_BASE = 'https://dhpp.hpfb-dgpsa.ca/review-documents';
const USER_AGENT = 'Mozilla/5.0 (compatible; HealthCanadaMonitor/1.0)';
const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

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

function getPublicationDate(doc: DhppDocument): string | null {
  const dates = [doc.decision_date, doc.issued_date, doc.updated_date].filter(Boolean) as string[];
  if (dates.length === 0) return null;
  return dates.sort().reverse()[0];
}

function classifyTherapeuticArea(title: string, indication: string | null): string {
  const text = `${title} ${indication || ''}`.toLowerCase();
  
  // CMC - Chemistry, Manufacturing, and Controls
  if (/\b(chemistry|manufacturing|controls|cmc|formulation|stability|impurit|excipient|specification|analytical|dissolution|bioequivalence)\b/.test(text)) return 'CMC';
  
  // ONC - Oncology
  if (/\b(cancer|oncolog|tumor|tumour|carcinoma|lymphoma|leukemia|leukaemia|melanoma|sarcoma|myeloma|neoplasm|chemotherapy|anti-cancer|antineoplastic|metasta|malignant|glioblastoma|immunotherapy for.*cancer|checkpoint inhibitor)\b/.test(text)) return 'ONC';
  
  // CVRM - Cardiovascular, Renal, and Metabolism
  if (/\b(cardiovascular|cardiac|heart|hypertension|diabetes|diabet|insulin|renal|kidney|metaboli|cholesterol|lipid|statin|anticoagulant|thrombosis|atherosclerosis|arrhythmia|angina|myocardial|obesity|dyslipidemia|nephro|dialysis|glp-1|sglt2|dpp-4)\b/.test(text)) return 'CVRM';
  
  // CTA - Clinical Trials
  if (/\b(clinical trial|cta |phase [i1-3]|investigational|trial application)\b/.test(text)) return 'CTA';
  
  // RAOE - Regulatory Affairs and Operations
  if (/\b(regulatory|compliance|enforcement|inspection|recall|guidance|policy|label|labelling|monograph|form |notice|administrative|procedural)\b/.test(text)) return 'RAOE';
  
  // RV&IT - Vaccines and Infectious Diseases
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
    const titleMatch = block.match(/<a href="(https:\/\/dhpp\.hpfb-dgpsa\.ca\/review-documents\/resource\/[^"]+)">([^<]+)<\/a>/);
    if (!titleMatch) continue;

    let type: 'RDS' | 'SBD' | 'SSR' = 'RDS';
    if (block.includes('review-document-sbd')) type = 'SBD';
    else if (block.includes('review-document-ssr')) type = 'SSR';

    documents.push({
      type,
      title: titleMatch[2].trim(),
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

async function scrapeDhpp(dateFrom: string, dateTo: string): Promise<DhppDocument[]> {
  const allDocs: DhppDocument[] = [];
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = page === 0 ? DHPP_BASE : `${DHPP_BASE}?page=${page}`;
    console.log(`DHPP page ${page}: ${url}`);
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) break;
      const html = await res.text();
      const docs = parseDhppPage(html);
      if (docs.length === 0) break;

      let anyInOrAfterRange = false;
      for (const doc of docs) {
        const pubDate = getPublicationDate(doc);
        if (pubDate && pubDate >= dateFrom) {
          anyInOrAfterRange = true;
          if (isInRange(pubDate, dateFrom, dateTo)) {
            allDocs.push(doc);
          }
        }
      }
      if (!anyInOrAfterRange) break;
    } catch (err) {
      console.error(`DHPP page ${page} error:`, err);
      break;
    }
  }
  return allDocs;
}

// Scrape the previous 4 weeks for backdating detection
async function scrapeDhppExtended(dateFrom: string): Promise<DhppDocument[]> {
  // Go back 4 weeks from dateFrom
  const extendedFrom = new Date(dateFrom + 'T00:00:00');
  extendedFrom.setDate(extendedFrom.getDate() - 28);
  const extFromStr = extendedFrom.toISOString().split('T')[0];
  
  const allDocs: DhppDocument[] = [];
  const maxPages = 15;

  for (let page = 0; page < maxPages; page++) {
    const url = page === 0 ? DHPP_BASE : `${DHPP_BASE}?page=${page}`;
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) break;
      const html = await res.text();
      const docs = parseDhppPage(html);
      if (docs.length === 0) break;

      let anyInOrAfterRange = false;
      for (const doc of docs) {
        const pubDate = getPublicationDate(doc);
        if (pubDate && pubDate >= extFromStr) {
          anyInOrAfterRange = true;
          allDocs.push(doc);
        }
      }
      if (!anyInOrAfterRange) break;
    } catch (err) {
      console.error(`DHPP extended page ${page} error:`, err);
      break;
    }
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
  // Get all snapshot URLs from previous reports that overlap the 4-week lookback
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

  // Collect all URLs that were in previous snapshots
  const previousUrls = new Set<string>();
  for (const snap of snapshots) {
    const urls = snap.document_urls as string[];
    if (Array.isArray(urls)) {
      urls.forEach(u => previousUrls.add(u));
    }
  }

  console.log(`Previous snapshots contain ${previousUrls.size} URLs`);

  // Scrape extended range to find docs in previous date ranges
  const extendedDocs = await scrapeDhppExtended(dateFrom);
  
  // Filter: docs that are in the previous date ranges but NOT in previous snapshots = backdated
  const backdated: DhppDocument[] = [];
  const currentUrlSet = new Set(currentDocs.map(d => d.url));

  for (const doc of extendedDocs) {
    const pubDate = getPublicationDate(doc);
    if (!pubDate) continue;
    // Skip docs already in current range
    if (currentUrlSet.has(doc.url)) continue;
    // Doc is in the previous 4 weeks range but not in our current range
    if (pubDate >= lookbackStr && pubDate < dateFrom) {
      // Was NOT in previous snapshots = it's backdated
      if (!previousUrls.has(doc.url)) {
        doc.is_backdated = true;
        backdated.push(doc);
      }
    }
  }

  console.log(`Found ${backdated.length} backdated documents`);
  return backdated;
}

// Save current snapshot
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

  const toProcess = needFetch.slice(0, 8);
  console.log(`Fetching ${toProcess.length} detail pages for AI summaries`);

  await Promise.all(toProcess.map(async (doc) => {
    try {
      const res = await fetch(doc.url, { headers: FETCH_HEADERS });
      if (!res.ok) return;
      const html = await res.text();
      const text = extractDetailSections(html);
      if (!text) {
        doc.indication_summary = 'Not available for this document type';
        return;
      }
      const summary = await getAiSummary(text, doc.title);
      doc.indication_summary = summary || 'Not available for this document type';
    } catch {
      doc.indication_summary = 'Not available for this document type';
    }
  }));

  // Classify therapeutic areas for all docs
  for (const doc of docs) {
    doc.therapeutic_area = classifyTherapeuticArea(doc.title, doc.indication_summary);
  }
}

// ---- What's New pages scraping ----
function parseHtmlWhatsNew(html: string, dateFrom: string, dateTo: string, source: string): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    const content = match[1];
    const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    const dateMatch = content.match(/\[(\d{4}-\d{2}-\d{2})\]/);
    if (!linkMatch || !dateMatch) continue;

    const date = dateMatch[1];
    if (!isInRange(date, dateFrom, dateTo)) continue;

    const title = linkMatch[2].trim();
    const url = linkMatch[1];

    const skipPatterns = [
      'Multiple additions to the Prescription Drug List',
      'Updated List of Drugs for an Urgent Public Health Need',
      'Updated Register of Certificates of Supplementary Protection',
      'Medical Devices',
      'Register for Innovative Drugs',
      'NOC Data Extract',
      'Notice of Compliance (NOC) Data Extract',
      'DPD Extract',
      'Product Monograph Brand Safety Updates',
      'Summary Basis of Decision',
    ];
    if (skipPatterns.some(p => title.includes(p))) continue;

    items.push({ title, url, date, source, therapeutic_area: classifyTherapeuticArea(title, null) });
  }
  return items;
}

async function scrapeWhatsNewPages(dateFrom: string, dateTo: string): Promise<GuidanceItem[]> {
  const urls = [
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/what-new-drug-products-health-canada.html', source: 'Drug Products' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/biologics-radio-pharmaceuticals-genetic-therapies/what-new-biologics-radiopharmaceuticals-genetic-therapies-health-canada.html', source: 'Biologics' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/compliance-enforcement/what-new.html', source: 'Compliance & Enforcement' },
  ];

  const results = await Promise.all(urls.map(async ({ url, source }) => {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) return [];
      const html = await res.text();
      return parseHtmlWhatsNew(html, dateFrom, dateTo, source);
    } catch (err) {
      console.error(`Error scraping ${source}:`, err);
      return [];
    }
  }));

  return results.flat();
}

// ---- Consultations scraping ----
async function scrapeConsultations(dateFrom: string, dateTo: string): Promise<GuidanceItem[]> {
  try {
    const url = 'https://www.canada.ca/en/health-canada/services/drugs-health-products/public-involvement-consultations/current-past-consultations.html';
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) return [];
    const html = await res.text();
    const items: GuidanceItem[] = [];

    // Parse consultation items - look for end dates
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = liRegex.exec(html)) !== null) {
      const content = match[1];
      const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) continue;

      const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
      const itemUrl = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`;

      // Look for end date patterns
      const endDatePatterns = [
        /(?:end|closing|close|deadline)[^:]*:\s*(\d{4}-\d{2}-\d{2})/i,
        /(?:end|closing|close|deadline)[^:]*:\s*(\w+ \d{1,2},?\s*\d{4})/i,
        /to\s+(\d{4}-\d{2}-\d{2})/i,
      ];

      let endDate: string | null = null;
      for (const pat of endDatePatterns) {
        const m = content.match(pat);
        if (m) {
          endDate = parseDate(m[1]);
          if (!endDate) {
            // Try parsing natural date
            try {
              const d = new Date(m[1]);
              if (!isNaN(d.getTime())) endDate = d.toISOString().split('T')[0];
            } catch { /* skip */ }
          }
          break;
        }
      }

      // Also check for any date in brackets
      if (!endDate) {
        const dateMatch = content.match(/\[(\d{4}-\d{2}-\d{2})\]/);
        if (dateMatch) endDate = dateMatch[1];
      }

      // Include if end date falls in range
      if (endDate && isInRange(endDate, dateFrom, dateTo)) {
        items.push({ title, url: itemUrl, date: endDate, source: 'Consultations', therapeutic_area: classifyTherapeuticArea(title, null) });
      }
    }
    return items;
  } catch (err) {
    console.error('Consultations scraping error:', err);
    return [];
  }
}

// ---- MedEffect scraping ----
async function scrapeMedEffectWhatsNew(dateFrom: string, dateTo: string): Promise<MedEffectItem[]> {
  try {
    const res = await fetch('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/what-new.html', { headers: FETCH_HEADERS });
    if (!res.ok) return [];
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
    return items;
  } catch (err) {
    console.error('MedEffect What\'s New error:', err);
    return [];
  }
}

async function scrapeSafetyReviews(dateFrom: string, dateTo: string): Promise<{ periods: SafetyReviewPeriod[]; raw_html_snippet: string }> {
  try {
    const res = await fetch('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/safety-reviews/new.html', { headers: FETCH_HEADERS });
    if (!res.ok) return { periods: [], raw_html_snippet: '' };
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

    return { periods, raw_html_snippet: '' };
  } catch (err) {
    console.error('Safety reviews error:', err);
    return { periods: [], raw_html_snippet: '' };
  }
}

// ---- Main handler ----
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dateFrom, dateTo } = await req.json();
    if (!dateFrom || !dateTo) {
      return new Response(
        JSON.stringify({ error: 'dateFrom and dateTo are required (YYYY-MM-DD)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating What's New report for ${dateFrom} to ${dateTo}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Run all scraping in parallel
    const [dhppDocs, guidanceItems, consultationItems, medEffectItems, safetyData] = await Promise.all([
      scrapeDhpp(dateFrom, dateTo),
      scrapeWhatsNewPages(dateFrom, dateTo),
      scrapeConsultations(dateFrom, dateTo),
      scrapeMedEffectWhatsNew(dateFrom, dateTo),
      scrapeSafetyReviews(dateFrom, dateTo),
    ]);

    // Detect backdated docs
    const backdatedDocs = await detectBackdated(dhppDocs, dateFrom, dateTo, supabase);

    const allDhppDocs = [...dhppDocs, ...backdatedDocs];

    console.log(`DHPP: ${dhppDocs.length} (+ ${backdatedDocs.length} backdated), Guidance: ${guidanceItems.length}, Consultations: ${consultationItems.length}, MedEffect: ${medEffectItems.length}, Safety periods: ${safetyData.periods.length}`);

    // Enrich DHPP docs with indication summaries & therapeutic areas
    if (allDhppDocs.length > 0) {
      await enrichWithIndications(allDhppDocs, supabase);
    }

    // Save snapshot for future backdating detection
    await saveSnapshot(dhppDocs, dateFrom, dateTo, supabase);

    // Merge consultations into guidance
    const allGuidance = [...guidanceItems, ...consultationItems];

    const report = {
      date_range: { from: dateFrom, to: dateTo },
      transparency_documents: allDhppDocs,
      guidance_documents: allGuidance,
      medeffect_whats_new: medEffectItems,
      safety_reviews: safetyData.periods,
    };

    return new Response(
      JSON.stringify(report),
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
