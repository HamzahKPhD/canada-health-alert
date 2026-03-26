import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BASE_URL = 'https://dhpp.hpfb-dgpsa.ca/review-documents';
const PAGES_TO_SCRAPE = 5; // Scrape first 5 pages (most recent ~100 documents)

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

function parseDocumentsFromHtml(html: string): ReviewDocument[] {
  const documents: ReviewDocument[] = [];
  
  // Match each search result item
  const resultPattern = /<article[^>]*class="[^"]*search-result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  
  while ((match = resultPattern.exec(html)) !== null) {
    const block = match[1];
    
    // Extract title and URL
    const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    
    const url = titleMatch[1].startsWith('http') ? titleMatch[1] : `https://dhpp.hpfb-dgpsa.ca${titleMatch[1]}`;
    const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
    
    if (!title || !url) continue;
    
    // Extract fields from definition list
    const getField = (label: string): string | null => {
      const regex = new RegExp(`${label}[^<]*<\\/dt>\\s*<dd[^>]*>([^<]*)<\\/dd>`, 'i');
      const m = block.match(regex);
      return m ? m[1].trim() : null;
    };
    
    documents.push({
      title,
      url,
      product_type: getField('Product Type'),
      control_number: getField('Control Number'),
      din: getField('DIN'),
      manufacturer: getField('Manufacturer'),
      submission_type: getField('Submission Type'),
      date_filed: parseDate(getField('Date Filed') || getField('Submission Date')),
      decision_date: parseDate(getField('Decision') || getField('Authorization Date')),
      issued_date: parseDate(getField('Issued') || getField('Original Publication Date')),
      updated_date: parseDate(getField('Updated Date')),
    });
  }
  
  return documents;
}

// Fallback: parse from text content (markdown-like)
function parseDocumentsFromText(text: string): ReviewDocument[] {
  const documents: ReviewDocument[] = [];
  const lines = text.split('\n');
  
  let current: Partial<ReviewDocument> | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Title line - starts with a link pattern
    const linkMatch = trimmed.match(/^\[(.+?)\]\((https:\/\/dhpp\.hpfb-dgpsa\.ca\/review-documents\/resource\/[^\)]+)\)/);
    if (linkMatch) {
      if (current?.title && current?.url) {
        documents.push(current as ReviewDocument);
      }
      current = {
        title: linkMatch[1],
        url: linkMatch[2],
        product_type: null,
        control_number: null,
        din: null,
        manufacturer: null,
        submission_type: null,
        date_filed: null,
        decision_date: null,
        issued_date: null,
        updated_date: null,
      };
      continue;
    }
    
    if (!current) continue;
    
    if (trimmed.startsWith('Product Type:')) current.product_type = trimmed.replace('Product Type:', '').trim();
    if (trimmed.startsWith('Control Number:')) current.control_number = trimmed.replace('Control Number:', '').trim();
    if (trimmed.startsWith('DIN')) current.din = trimmed.replace(/^DIN\(s\):/, '').trim();
    if (trimmed.startsWith('Manufacturer:')) current.manufacturer = trimmed.replace('Manufacturer:', '').trim();
    if (trimmed.startsWith('Submission Type:')) current.submission_type = trimmed.replace('Submission Type:', '').trim();
    if (trimmed.startsWith('Date Filed')) current.date_filed = parseDate(trimmed);
    if (trimmed.startsWith('Decision')) current.decision_date = parseDate(trimmed);
    if (trimmed.startsWith('Issued')) current.issued_date = parseDate(trimmed);
    if (trimmed.startsWith('Updated Date:')) current.updated_date = parseDate(trimmed);
  }
  
  if (current?.title && current?.url) {
    documents.push(current as ReviewDocument);
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

    // Scrape multiple pages
    for (let page = 0; page < PAGES_TO_SCRAPE; page++) {
      const url = page === 0 ? BASE_URL : `${BASE_URL}?page=${page}`;
      console.log(`Fetching page ${page}: ${url}`);
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'HealthCanadaMonitor/1.0',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        
        if (!response.ok) {
          console.error(`Failed to fetch page ${page}: ${response.status}`);
          continue;
        }
        
        const html = await response.text();
        
        // Try HTML parsing first
        let docs = parseDocumentsFromHtml(html);
        
        // Fallback to text parsing if HTML parsing yields nothing
        if (docs.length === 0) {
          // Convert HTML to rough text
          const text = html.replace(/<[^>]*>/g, '\n').replace(/\n{3,}/g, '\n\n');
          docs = parseDocumentsFromText(text);
        }
        
        console.log(`Page ${page}: found ${docs.length} documents`);
        allDocuments.push(...docs);
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err);
      }
    }

    console.log(`Total documents scraped: ${allDocuments.length}`);

    if (allDocuments.length === 0) {
      // Log failed scan
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

    // Upsert documents (insert new, skip existing based on URL)
    let newCount = 0;
    for (const doc of allDocuments) {
      const { error } = await supabase
        .from('review_documents')
        .upsert(doc, { onConflict: 'url', ignoreDuplicates: true });
      
      if (!error) {
        // Check if it was actually new
        const { data: existing } = await supabase
          .from('review_documents')
          .select('first_seen_at, created_at')
          .eq('url', doc.url)
          .single();
        
        if (existing) {
          const firstSeen = new Date(existing.first_seen_at).getTime();
          const createdAt = new Date(existing.created_at).getTime();
          // If first_seen is very close to created_at (within 5 seconds), it's new
          if (Math.abs(firstSeen - createdAt) < 5000) {
            const now = Date.now();
            if (Math.abs(now - createdAt) < 60000) {
              newCount++;
            }
          }
        }
      }
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
