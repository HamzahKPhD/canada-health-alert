import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BASE_URL = 'https://dhpp.hpfb-dgpsa.ca/review-documents';
const MAX_PAGES = 400;
const CONCURRENCY = 6;

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
  const regex = new RegExp(
    `views-label-${labelClass}">[^<]*</span>\\s*<span class="field-content">([^<]*)</span>`,
    'i'
  );
  const m = block.match(regex);
  return m ? m[1].trim() || null : null;
}

function parseDocumentsFromHtml(html: string): ReviewDocument[] {
  const documents: ReviewDocument[] = [];
  const parts = html.split(/<div class="review-document views-row/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const titleMatch = block.match(/<a href="(https:\/\/dhpp\.hpfb-dgpsa\.ca\/review-documents\/resource\/[^"]+)">([^<]+)<\/a>/);
    if (!titleMatch) continue;

    documents.push({
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
    });
  }

  return documents;
}

function extractDetailSections(html: string): string {
  // Extract content from <details> blocks which contain purpose and decision info
  const sections: string[] = [];
  
  // Get all details blocks
  const detailsRegex = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div class="details-wrapper">([\s\S]*?)<\/div>\s*<\/details>/gi;
  let match;
  while ((match = detailsRegex.exec(html)) !== null) {
    const heading = match[1].replace(/<[^>]+>/g, '').trim();
    const content = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (heading && content) {
      sections.push(`${heading}: ${content}`);
    }
  }
  
  // Also extract therapeutic area
  const therapeuticMatch = html.match(/<strong>Therapeutic Area:\s*<\/strong>[\s\S]*?<p>([^<]+)<\/p>/i);
  if (therapeuticMatch) {
    sections.push(`Therapeutic Area: ${therapeuticMatch[1].trim()}`);
  }

  // Extract medicinal ingredient
  const ingredientMatch = html.match(/<strong>Medicinal Ingredient\(s\):\s*<\/strong>[\s\S]*?<p>([^<]+)<\/p>/i);
  if (ingredientMatch) {
    sections.push(`Medicinal Ingredient: ${ingredientMatch[1].trim()}`);
  }
  
  return sections.join('\n\n');
}

async function getIndicationSummary(pageText: string, title: string): Promise<string | null> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    console.error('LOVABLE_API_KEY not set, cannot generate AI summaries');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: 'You are a pharmaceutical regulatory expert. Given text from a Health Canada review document, extract a concise 1-2 sentence summary of what the drug is indicated/approved for. For biosimilars, state that it is a biosimilar and mention the reference drug and its therapeutic uses. For safety reviews, summarize the safety concern being reviewed. Be precise and clinical. Only return the summary text, nothing else.'
          },
          {
            role: 'user',
            content: `Document title: ${title}\n\nPage content:\n${pageText.substring(0, 3000)}`
          }
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    return summary || null;
  } catch (err) {
    console.error('Error calling AI API:', err);
    return null;
  }
}

async function fetchDetailPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HealthCanadaMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
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
    let stopRequested = false;

    // Scrape all listing pages in parallel batches, stop when an empty page is hit
    for (let batchStart = 0; batchStart < MAX_PAGES && !stopRequested; batchStart += CONCURRENCY) {
      const batch = Array.from({ length: CONCURRENCY }, (_, i) => batchStart + i)
        .filter((p) => p < MAX_PAGES);

      const results = await Promise.all(
        batch.map(async (page) => {
          const url = page === 0 ? BASE_URL : `${BASE_URL}?page=${page}`;
          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; HealthCanadaMonitor/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
            });
            if (!response.ok) return { page, docs: [] as ReviewDocument[] };
            const html = await response.text();
            return { page, docs: parseDocumentsFromHtml(html) };
          } catch (err) {
            console.error(`Error fetching page ${page}:`, err);
            return { page, docs: [] as ReviewDocument[] };
          }
        })
      );

      for (const { page, docs } of results.sort((a, b) => a.page - b.page)) {
        if (docs.length === 0) {
          stopRequested = true;
          console.log(`Page ${page} empty — stopping pagination.`);
          break;
        }
        console.log(`Page ${page}: ${docs.length} docs`);
        allDocuments.push(...docs);
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

    // Fetch indication summaries for documents that don't have one yet
    const { data: docsNeedingIndication } = await supabase
      .from('review_documents')
      .select('id, url, title')
      .is('indication_summary', null)
      .limit(10);

    let indicationsAdded = 0;
    if (docsNeedingIndication && docsNeedingIndication.length > 0) {
      console.log(`Fetching indications for ${docsNeedingIndication.length} documents`);
      
      for (const doc of docsNeedingIndication) {
        const html = await fetchDetailPage(doc.url);
        if (!html) continue;

        const pageText = extractDetailSections(html);
        if (!pageText) {
          await supabase
            .from('review_documents')
            .update({ indication_summary: 'Not available for this document type' })
            .eq('id', doc.id);
          continue;
        }

        const summary = await getIndicationSummary(pageText, doc.title);
        if (summary) {
          await supabase
            .from('review_documents')
            .update({ indication_summary: summary })
            .eq('id', doc.id);
          indicationsAdded++;
        } else {
          await supabase
            .from('review_documents')
            .update({ indication_summary: 'Not available for this document type' })
            .eq('id', doc.id);
        }
      }
      console.log(`Added ${indicationsAdded} indication summaries`);
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
        indications_added: indicationsAdded,
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
