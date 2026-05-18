-- Wire the existing update_updated_at_column() function (from
-- 20260124_initial_schema.sql) to user_settings and rewards. These triggers
-- were defined in 20260128_profile_features.sql but that migration never ran
-- against the live DB, so updated_at currently never auto-bumps on these
-- tables. Idempotent via DROP TRIGGER IF EXISTS so it's safe to re-run.

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_rewards_updated_at ON public.rewards;
CREATE TRIGGER update_rewards_updated_at
  BEFORE UPDATE ON public.rewards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
