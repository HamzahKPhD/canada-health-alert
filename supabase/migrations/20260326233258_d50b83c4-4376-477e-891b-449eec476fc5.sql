
-- Drop overly permissive policies
DROP POLICY "Service role can insert review documents" ON public.review_documents;
DROP POLICY "Service role can update review documents" ON public.review_documents;
DROP POLICY "Service role can insert scan log" ON public.scan_log;

-- Recreate with service role check (anon users cannot write)
CREATE POLICY "Service role can insert review documents"
  ON public.review_documents FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update review documents"
  ON public.review_documents FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert scan log"
  ON public.scan_log FOR INSERT
  TO service_role
  WITH CHECK (true);
