
CREATE TABLE public.saved_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewers JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Saved reports are publicly readable"
  ON public.saved_reports FOR SELECT TO public USING (true);

CREATE POLICY "Service role can insert saved reports"
  ON public.saved_reports FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Anyone can insert saved reports"
  ON public.saved_reports FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anyone can delete saved reports"
  ON public.saved_reports FOR DELETE TO anon USING (true);

CREATE POLICY "Anyone can update saved reports"
  ON public.saved_reports FOR UPDATE TO anon USING (true);
