-- The teacher guard triggers call is_admin() even when the caller is the
-- service role (SQL "or" does not short-circuit), so server code and scripts
-- could not change curriculum rows. Both functions only look at the caller's
-- own profile; letting the service role run them is safe.
grant execute on function public.is_staff(), public.is_admin() to service_role;
