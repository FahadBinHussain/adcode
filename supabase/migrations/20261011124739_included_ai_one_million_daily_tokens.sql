-- Upgrade saved defaults and individual positive token allowances to at least 1M.
-- Keep disabled allowances, larger custom limits, block flags, and all usage intact.
begin;

update public.tagflow_config
set config = jsonb_set(config, '{limits,dailyTokens}', '1000000'::jsonb, false),
    updated_at = (extract(epoch from now()) * 1000)::bigint,
    updated_by = 'migration:included-ai-1m'
where id = 1
  and (config #>> '{limits,dailyTokens}')::bigint between 1 and 999999;

update public.tagflow_user_policies
set policy = jsonb_set(
  jsonb_set(
    jsonb_set(policy, '{limits,dailyTokens}', '1000000'::jsonb, false),
    '{updatedAt}', to_jsonb((extract(epoch from now()) * 1000)::bigint), false
  ),
  '{updatedBy}', '"migration:included-ai-1m"'::jsonb, false
)
where (policy #>> '{limits,dailyTokens}')::bigint between 1 and 999999;

commit;
