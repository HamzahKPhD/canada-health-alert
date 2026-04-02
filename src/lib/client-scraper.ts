// Client-side scraping for canada.ca pages
// These pages block cloud server IPs but work fine from browsers

interface GuidanceItem {
  title: string;
  url: string;
  date: string;
  source: string;
  therapeutic_area: string | null;
}

interface MedEffectItem {
  title: string;
  url: string;
  date: string;
  therapeutic_area: string | null;
  is_infowatch: boolean;
  az_relevant_info: string | null;
}

interface SafetyReviewPeriod {
  period: string;
  reviews: { brand_name: string; ingredient: string; safety_issue: string; trigger: string; therapeutic_area: string | null }[];
  no_reviews_message: string | null;
}

function isInRange(dateStr: string | null, from: string, to: string): boolean {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
}

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

const SKIP_PATTERNS = ['Summary Basis of Decision', 'Regulatory Decision Summary'];

function parseWhatsNewHtml(html: string, dateFrom: string, dateTo: string, source: string): GuidanceItem[] {
  const items: GuidanceItem[] = [];
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
    if (SKIP_PATTERNS.some(p => title.includes(p))) continue;
    const url = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`;
    items.push({ title, url, date, source, therapeutic_area: classifyTherapeuticArea(title, null) });
  }
  return items;
}

async function fetchCanadaPage(url: string): Promise<string | null> {
  try {
    // Try direct fetch first (works from browser since same-origin isn't an issue for public pages)
    // Use corsproxy to handle CORS since we're fetching from a different origin
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (res.ok) return await res.text();
    
    // Fallback proxy
    const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res2 = await fetch(fallbackUrl);
    if (res2.ok) return await res2.text();
    
    console.error(`Failed to fetch ${url}: ${res.status}, fallback: ${res2.status}`);
    return null;
  } catch (err) {
    console.error(`Fetch error for ${url}:`, err);
    return null;
  }
}

export async function scrapeGuidanceDocuments(dateFrom: string, dateTo: string, onProgress?: (msg: string) => void): Promise<GuidanceItem[]> {
  const allItems: GuidanceItem[] = [];
  
  const pages = [
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/what-new-drug-products-health-canada.html', source: 'Drug Products' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/biologics-radio-pharmaceuticals-genetic-therapies/what-new-biologics-radiopharmaceuticals-genetic-therapies-health-canada.html', source: 'Biologics' },
    { url: 'https://www.canada.ca/en/health-canada/services/drugs-health-products/compliance-enforcement/what-new.html', source: 'Compliance & Enforcement' },
  ];

  for (const { url, source } of pages) {
    onProgress?.(`Scraping ${source}...`);
    const html = await fetchCanadaPage(url);
    if (!html) {
      console.warn(`Failed to fetch ${source}`);
      continue;
    }
    const items = parseWhatsNewHtml(html, dateFrom, dateTo, source);
    console.log(`${source}: found ${items.length} items`);
    allItems.push(...items);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  return allItems;
}

export async function scrapeConsultations(dateFrom: string, dateTo: string, onProgress?: (msg: string) => void): Promise<GuidanceItem[]> {
  onProgress?.('Scraping Consulting with Canadians...');
  const url = 'https://www.canada.ca/en/government/system/consultations/consultingcanadians.html';
  const html = await fetchCanadaPage(url);
  if (!html) return [];
  const items: GuidanceItem[] = [];

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = trRegex.exec(html)) !== null) {
    const row = match[1];
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      cells.push(tdMatch[1]);
    }
    if (cells.length < 7) continue;
    const org = cells[6].replace(/<[^>]+>/g, '').trim();
    if (!org.toLowerCase().includes('health canada')) continue;
    const endDateStr = cells[5].replace(/<[^>]+>/g, '').trim();
    const endDateMatch = endDateStr.match(/(\d{4}-\d{2}-\d{2})/);
    const endDate = endDateMatch ? endDateMatch[1] : null;
    if (!endDate || !isInRange(endDate, dateFrom, dateTo)) continue;
    const linkMatch = cells[0].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const title = linkMatch ? linkMatch[2].replace(/<[^>]+>/g, '').trim() : cells[0].replace(/<[^>]+>/g, '').trim();
    const itemUrl = linkMatch ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`) : '';
    const status = cells[1].replace(/<[^>]+>/g, '').trim();
    const dateRange = cells[3].replace(/<[^>]+>/g, '').trim();
    items.push({
      title: `${title} (${status}) [${dateRange}]`,
      url: itemUrl,
      date: endDate,
      source: 'Consultations',
      therapeutic_area: classifyTherapeuticArea(title, null),
    });
  }
  console.log(`Consultations: found ${items.length} Health Canada items`);
  return items;
}

export async function scrapeMedEffect(dateFrom: string, dateTo: string, onProgress?: (msg: string) => void): Promise<{ items: MedEffectItem[], periods: SafetyReviewPeriod[], noDataStatement: string | null }> {
  // MedEffect What's New
  onProgress?.("Scraping MedEffect What's New...");
  const medHtml = await fetchCanadaPage('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/what-new.html');
  const items: MedEffectItem[] = [];
  
  if (medHtml) {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = liRegex.exec(medHtml)) !== null) {
      const content = match[1];
      const linkMatch = content.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const dateMatch = content.match(/\[(\d{4}-\d{2}-\d{2})\]/);
      if (!linkMatch || !dateMatch) continue;
      const date = dateMatch[1];
      if (!isInRange(date, dateFrom, dateTo)) continue;
      const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
      const isInfowatch = /health product infowatch|infowatch/i.test(title);
      const url = linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.canada.ca${linkMatch[1]}`;
      items.push({ title, url, date, therapeutic_area: classifyTherapeuticArea(title, null), is_infowatch: isInfowatch, az_relevant_info: null });
    }
  }

  // Safety Reviews
  onProgress?.('Scraping Safety Reviews...');
  await new Promise(r => setTimeout(r, 500));
  const safetyHtml = await fetchCanadaPage('https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/safety-reviews/new.html');
  const periods: SafetyReviewPeriod[] = [];
  let noDataStatement: string | null = null;

  if (safetyHtml) {
    const text = safetyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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
    let foundOverlap = false;
    for (const period of periodPositions) {
      if (period.periodTo < dateFrom || period.periodFrom > dateTo) continue;
      foundOverlap = true;
      const periodLabel = `${period.periodFrom} to ${period.periodTo}`;
      const noReview = noReviewPeriods.find(nr => nr.from === period.periodFrom);
      if (noReview) {
        periods.push({ period: periodLabel, reviews: [], no_reviews_message: `No safety and effectiveness reviews initiated from ${noReview.from} to ${noReview.to}` });
        continue;
      }
      const reviews: SafetyReviewPeriod['reviews'] = [];
      const periodHeaderInHtml = safetyHtml.indexOf(`List of Safety and Effectiveness Reviews Initiated from ${period.periodFrom} to ${period.periodTo}`);
      if (periodHeaderInHtml === -1) continue;
      const nextTableStart = safetyHtml.indexOf('<table', periodHeaderInHtml);
      if (nextTableStart === -1) continue;
      const nextTableEnd = safetyHtml.indexOf('</table>', nextTableStart);
      if (nextTableEnd === -1) continue;
      const tableHtml = safetyHtml.substring(nextTableStart, nextTableEnd + 8);
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
          reviews.push({ brand_name: cells[0], ingredient: cells[1], safety_issue: cells[2], trigger: cells[3], therapeutic_area: classifyTherapeuticArea(cells[0], cells[2]) });
        }
      }
      periods.push({ period: periodLabel, reviews, no_reviews_message: null });
    }
    for (const nr of noReviewPeriods) {
      if (nr.to < dateFrom || nr.from > dateTo) continue;
      const alreadyAdded = periods.some(p => p.period === `${nr.from} to ${nr.to}`);
      if (!alreadyAdded) {
        foundOverlap = true;
        periods.push({ period: `${nr.from} to ${nr.to}`, reviews: [], no_reviews_message: `No safety and effectiveness reviews initiated from ${nr.from} to ${nr.to}` });
      }
    }
    if (!foundOverlap) {
      noDataStatement = `No safety and effectiveness reviews list provided by HC for ${dateFrom} to ${dateTo} (as of ${new Date().toISOString().split('T')[0]}).`;
    }
  } else {
    noDataStatement = `No safety and effectiveness reviews list provided by HC for ${dateFrom} to ${dateTo} (as of ${new Date().toISOString().split('T')[0]}).`;
  }

  console.log(`MedEffect: ${items.length} items, Safety periods: ${periods.length}`);
  return { items, periods, noDataStatement };
}
