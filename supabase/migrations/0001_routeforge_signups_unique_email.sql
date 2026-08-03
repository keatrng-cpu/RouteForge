-- Deduplicate signups by email (case-insensitive) so the client's
-- 409-on-duplicate flow works as designed.
--
-- Applied to project lamdouidiiuqtplqhsdz on 2026-07-14.
create unique index if not exists routeforge_signups_email_unique
  on public.routeforge_signups (lower(email));
