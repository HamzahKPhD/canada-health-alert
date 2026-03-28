
CREATE TABLE public.report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date_from date NOT NULL,
  report_date_to date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  document_urls jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.report_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Report snapshots are publicly readable"
  ON public.report_snapshots FOR SELECT TO public USING (true);

CREATE POLICY "Service role can insert report snapshots"
  ON public.report_snapshots FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update report snapshots"
  ON public.report_snapshots FOR UPDATE TO service_role USING (true);
