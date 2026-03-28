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
}

interface GuidanceItem {
  title: string;
  url: string;
  date: string;
  source: string;
}

interface SafetyReviewPeriod {
  period: string;
  reviews: { brand_name: string; ingredient: string; safety_issue: string; trigger: string }[];
  no_reviews_message: string | null;
}

interface MedEffectItem {
  title: string;
  url: string;
  date: string;
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
  return dates.sort().reverse()[0]; // most recent date
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

    // Determine type from CSS class
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

      // Check if we've gone past the date range
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
      // If all docs on this page are before the range, stop
      if (!anyInOrAfterRange) break;
    } catch (err) {
      console.error(`DHPP page ${page} error:`, err);
      break;
    }
  }
  return allDocs;
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
  // Check DB for existing summaries
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

  // Fill from DB cache
  const needFetch: DhppDocument[] = [];
  for (const doc of docs) {
    if (summaryMap.has(doc.url)) {
      doc.indication_summary = summaryMap.get(doc.url)!;
    } else {
      needFetch.push(doc);
    }
  }

  // Fetch detail pages for remaining (limit to avoid timeout)
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
}

// ---- What's New pages scraping ----
function parseWhatsNewPage(text: string, dateFrom: string, dateTo: string, source: string): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  // Match lines like: - [title](url) [YYYY-MM-DD] or [title](url)[YYYY-MM-DD]
  const regex = /- \[([^\]]+)\]\(([^)]+)\)\s*\[?(\d{4}-\d{2}-\d{2})\]?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const date = match[3];
    if (!isInRange(date, dateFrom, dateTo)) continue;

    const title = match[1];
    // Filter out noise items per SOP
    const skipPatterns = [
      'Multiple additions to the Prescription Drug List',
      'Updated List of Drugs for an Urgent Public Health Need',
      'Updated Register of Certificates of Supplementary Protection',
      'Information pertaining to Medical Devices',
      'Register for Innovative Drugs',
      'Notice of Compliance (NOC) Data Extract',
      'NOC Data Extract',
      'DPD Extract',
      'Product Monograph Brand Safety Updates',
      'Summary Basis of Decision',
    ];
    if (skipPatterns.some(p => title.includes(p))) continue;

    items.push({ title, url: match[2], date, source });
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
      // Convert HTML to simplified text for parsing
      const text = html.replace(/<[^>]+>/g, (tag) => {
        if (tag.startsWith('<a ')) {
          const href = tag.match(/href="([^"]+)"/);
          return href ? `](${href[1]})` : '';
        }
        if (tag === '</a>') return '';
        if (tag === '<li>') return '- [';
        return '';
      });
      // Actually, let me parse the HTML more carefully
      return parseHtmlWhatsNew(html, dateFrom, dateTo, source);
    } catch (err) {
      console.error(`Error scraping ${source}:`, err);
      return [];
    }
  }));

  return results.flat();
}

function parseHtmlWhatsNew(html: string, dateFrom: string, dateTo: string, source: string): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  // Match list items with links and dates
  // Pattern: <li><a href="URL">Title</a> [DATE]</li> or similar variations
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

    // Filter noise
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

    items.push({ title, url, date, source });
  }
  return items;
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
      items.push({
        title: linkMatch[2].replace(/<[^>]+>/g, '').trim(),
        url: linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`,
        date,
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

    // Extract the text content for parsing
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const periods: SafetyReviewPeriod[] = [];

    // Find period headers: "List of Safety and Effectiveness Reviews Initiated from YYYY-MM-DD to YYYY-MM-DD"
    const periodRegex = /List of Safety and Effectiveness Reviews Initiated from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g;
    let periodMatch;
    const periodPositions: { start: number; end: number; periodFrom: string; periodTo: string }[] = [];

    while ((periodMatch = periodRegex.exec(text)) !== null) {
      periodPositions.push({
        start: periodMatch.index,
        end: periodMatch.index + periodMatch[0].length,
        periodFrom: periodMatch[1],
        periodTo: periodMatch[2],
      });
    }

    // Also check for "No safety and effectiveness reviews" messages  
    const noReviewRegex = /No safety and effectiveness reviews initiated from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g;
    let noMatch;
    const noReviewPeriods: { from: string; to: string }[] = [];
    while ((noMatch = noReviewRegex.exec(text)) !== null) {
      noReviewPeriods.push({ from: noMatch[1], to: noMatch[2] });
    }

    // Parse HTML tables for safety reviews
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    const tables: { html: string; pos: number }[] = [];
    while ((tableMatch = tableRegex.exec(html)) !== null) {
      tables.push({ html: tableMatch[0], pos: tableMatch.index });
    }

    // For each period, check if it overlaps with the date range
    for (const period of periodPositions) {
      // Check if this period overlaps with our date range
      if (period.periodTo < dateFrom || period.periodFrom > dateTo) continue;

      const periodLabel = `${period.periodFrom} to ${period.periodTo}`;

      // Check if there's a "no reviews" message for this period
      const noReview = noReviewPeriods.find(nr => nr.from === period.periodFrom);
      if (noReview) {
        periods.push({
          period: periodLabel,
          reviews: [],
          no_reviews_message: `No safety and effectiveness reviews initiated from ${noReview.from} to ${noReview.to}`,
        });
        continue;
      }

      // Find the table associated with this period (the next table after the period header in the HTML)
      // Parse table rows
      const reviews: SafetyReviewPeriod['reviews'] = [];

      // Find the corresponding section in original HTML
      const periodHeaderInHtml = html.indexOf(`List of Safety and Effectiveness Reviews Initiated from ${period.periodFrom} to ${period.periodTo}`);
      if (periodHeaderInHtml === -1) continue;

      // Find the next table after this header
      const nextTableStart = html.indexOf('<table', periodHeaderInHtml);
      if (nextTableStart === -1) continue;
      const nextTableEnd = html.indexOf('</table>', nextTableStart);
      if (nextTableEnd === -1) continue;

      const tableHtml = html.substring(nextTableStart, nextTableEnd + 8);
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let isHeader = true;
      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        if (isHeader) { isHeader = false; continue; } // skip header row
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
    const [dhppDocs, guidanceItems, medEffectItems, safetyData] = await Promise.all([
      scrapeDhpp(dateFrom, dateTo),
      scrapeWhatsNewPages(dateFrom, dateTo),
      scrapeMedEffectWhatsNew(dateFrom, dateTo),
      scrapeSafetyReviews(dateFrom, dateTo),
    ]);

    console.log(`DHPP: ${dhppDocs.length}, Guidance: ${guidanceItems.length}, MedEffect: ${medEffectItems.length}, Safety periods: ${safetyData.periods.length}`);

    // Enrich DHPP docs with indication summaries
    if (dhppDocs.length > 0) {
      await enrichWithIndications(dhppDocs, supabase);
    }

    const report = {
      date_range: { from: dateFrom, to: dateTo },
      transparency_documents: dhppDocs,
      guidance_documents: guidanceItems,
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
