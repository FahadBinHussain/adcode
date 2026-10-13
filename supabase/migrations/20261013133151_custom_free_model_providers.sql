-- Free models can come from administrator-registered OpenAI-compatible providers.
-- Their IDs always start with custom-, matching CUSTOM_PROVIDER_ID in includedProviders.ts.
begin;
alter table public.ai_model_requests drop constraint if exists ai_model_requests_provider_check;
alter table public.ai_model_requests add constraint ai_model_requests_provider_check
  check (provider in ('tagflow','openai','google','groq','openrouter') or provider ~ '^custom-[a-z][a-z0-9-]{0,39}$');
commit;
