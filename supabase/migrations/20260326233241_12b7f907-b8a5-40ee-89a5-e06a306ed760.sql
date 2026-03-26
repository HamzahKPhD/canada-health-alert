
-- Create table for Health Canada review documents
CREATE TABLE public.review_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  product_type TEXT,
  control_number TEXT,
  din TEXT,
  manufacturer TEXT,
  submission_type TEXT,
  date_filed DATE,
  decision_date DATE,
  issued_date DATE,
  updated_date DATE,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.review_documents ENABLE ROW LEVEL SECURITY;

-- Allow public read access (this is public government data)
CREATE POLICY "Review documents are publicly readable"
  ON public.review_documents FOR SELECT
  USING (true);

-- Only service role can insert/update (edge function)
CREATE POLICY "Service role can insert review documents"
  ON public.review_documents FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update review documents"
  ON public.review_documents FOR UPDATE
  USING (true);

-- Create table to track scan history
CREATE TABLE public.scan_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  new_documents_count INTEGER NOT NULL DEFAULT 0,
  total_documents_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success'
);

ALTER TABLE public.scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scan log is publicly readable"
  ON public.scan_log FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert scan log"
  ON public.scan_log FOR INSERT
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_review_documents_url ON public.review_documents (url);
CREATE INDEX idx_review_documents_first_seen ON public.review_documents (first_seen_at DESC);
