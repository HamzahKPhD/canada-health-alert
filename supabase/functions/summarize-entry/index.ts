const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' } });
    if (!resp.ok) return '';
    const html = await resp.text();
    const text = stripHtml(html);
    return text.slice(0, 18000);
  } catch (e) {
    console.error('fetchPageText failed', url, e);
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { url, title, type, metadata } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('Missing LOVABLE_API_KEY');

    const pageText = url ? await fetchPageText(url) : '';

    const systemPrompt = `You are a senior regulatory affairs intelligence analyst. Given a single Health Canada document (Regulatory Decision Summary, Summary Basis of Decision, Safety Reviews, Guidance, Notice, ICH, Consultation, or MedEffect item), write ONE concise paragraph (3-6 sentences) summarizing it specifically for a regulatory affairs audience. Highlight what matters for reg affairs: product/sponsor, indication, submission type, pivotal study designs (Phase, randomization, comparator, endpoints, sample size), key efficacy and safety outcome data, label/scope changes, safety signals, deadlines for consultations, and any strategic implications. Be specific with names, numbers, and dates pulled from the source. No bullet points, no headings, no preamble — just the paragraph. If the source text is sparse, summarize what is available and say so briefly.`;

    const userPrompt = `Document type: ${type || 'unknown'}\nTitle: ${title || ''}\nURL: ${url || ''}\nKnown metadata: ${JSON.stringify(metadata || {})}\n\nPage content:\n${pageText || '(page content unavailable)'}`;

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits in your workspace billing settings.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`AI gateway error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const summary = data?.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('summarize-entry error', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
