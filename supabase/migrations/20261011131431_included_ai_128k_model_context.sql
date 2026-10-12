begin;

-- Verified on the configured Tagflow deployment with 130,530 input tokens.
-- Scope the upgrade to this model; preserve larger windows and other models.
update public.tagflow_config
set config = jsonb_set(config, '{models}', (
      select jsonb_agg(case
        when model ->> 'id' = 'tagflow-code-27b' and (model ->> 'contextWindow')::bigint < 131072
          then jsonb_set(model, '{contextWindow}', '131072'::jsonb, false)
        else model end order by position)
      from jsonb_array_elements(config -> 'models') with ordinality as offered(model, position)
    ), false),
    updated_at = (extract(epoch from now()) * 1000)::bigint,
    updated_by = 'migration:included-ai-128k-context'
where id = 1 and exists (
  select 1 from jsonb_array_elements(config -> 'models') as offered(model)
  where model ->> 'id' = 'tagflow-code-27b' and (model ->> 'contextWindow')::bigint < 131072
);

commit;
