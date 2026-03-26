import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BASE_URL = 'https://dhpp.hpfb-dgpsa.ca/review-documents';
const PAGES_TO_SCRAPE = 3;

interface ReviewDocument {
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
}

function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function extractField(block: string, labelClass: string): string | null {
  // Match: <span class="views-label views-label-{labelClass}">...</span><span class="field-content">VALUE</span>
  const regex = new RegExp(
    `views-label-${labelClass}">[^<]*</span>\\s*<span class="field-content">([^<]*)</span>`,
    'i'
  );
  const m = block.match(regex);
  return m ? m[1].trim() || null : null;
}

function parseDocumentsFromHtml(html: string): ReviewDocument[] {
  const documents: ReviewDocument[] = [];

  // Split by review-document divs
  const parts = html.split(/<div class="review-document views-row/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    // Extract title and URL from the link
    const titleMatch = block.match(/<a href="(https:\/\/dhpp\.hpfb-dgpsa\.ca\/review-documents\/resource\/[^"]+)">([^<]+)<\/a>/);
    if (!titleMatch) continue;

    const url = titleMatch[1];
    const title = titleMatch[2].trim();

    documents.push({
      title,
      url,
      product_type: extractField(block, 'name-1'),
      control_number: extractField(block, 'field-control-number-dsts-number'),
      din: extractField(block, 'field-din'),
      manufacturer: extractField(block, 'name-3'),
      submission_type: extractField(block, 'name-5'),
      date_filed: parseDate(extractField(block, 'field-date-filed')),
      decision_date: parseDate(extractField(block, 'field-original-decision-date-1')),
      issued_date: parseDate(extractField(block, 'field-issued-date-1')),
      updated_date: parseDate(extractField(block, 'field-updated-date')),
    });
  }

  return documents;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const allDocuments: ReviewDocument[] = [];

    for (let page = 0; page < PAGES_TO_SCRAPE; page++) {
      const url = page === 0 ? BASE_URL : `${BASE_URL}?page=${page}`;
      console.log(`Fetching page ${page}: ${url}`);

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; HealthCanadaMonitor/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch page ${page}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        const docs = parseDocumentsFromHtml(html);
        console.log(`Page ${page}: found ${docs.length} documents`);
        allDocuments.push(...docs);
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err);
      }
    }

    console.log(`Total documents scraped: ${allDocuments.length}`);

    if (allDocuments.length === 0) {
      await supabase.from('scan_log').insert({
        new_documents_count: 0,
        total_documents_count: 0,
        status: 'no_documents_found',
      });

      return new Response(
        JSON.stringify({ success: false, error: 'No documents found during scrape' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get existing URLs to count new ones
    const { data: existingDocs } = await supabase
      .from('review_documents')
      .select('url');
    
    const existingUrls = new Set((existingDocs || []).map((d: { url: string }) => d.url));
    
    let newCount = 0;
    for (const doc of allDocuments) {
      if (!existingUrls.has(doc.url)) {
        newCount++;
      }
    }

    // Upsert all documents
    const { error: upsertError } = await supabase
      .from('review_documents')
      .upsert(allDocuments, { onConflict: 'url', ignoreDuplicates: true });

    if (upsertError) {
      console.error('Upsert error:', upsertError);
    }

    // Get total count
    const { count } = await supabase
      .from('review_documents')
      .select('*', { count: 'exact', head: true });

    // Log scan
    await supabase.from('scan_log').insert({
      new_documents_count: newCount,
      total_documents_count: count || 0,
      status: 'success',
    });

    return new Response(
      JSON.stringify({
        success: true,
        scraped: allDocuments.length,
        new_documents: newCount,
        total_in_db: count,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scraping error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
