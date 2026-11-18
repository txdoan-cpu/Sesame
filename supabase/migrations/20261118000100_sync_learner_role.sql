-- Supabase Auth's admin createUser inserts the user first and writes
-- app_metadata in a follow-up UPDATE, so the insert trigger sees no role.
-- Keep profiles in sync when app_metadata.role is set later.
-- app_metadata can only be changed with the service role, so this is safe.

create function public.handle_user_app_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_role text := new.raw_app_meta_data ->> 'role';
begin
  if new_role = 'learner'
     and new_role is distinct from (old.raw_app_meta_data ->> 'role') then
    -- Only a fresh account with no family links can become a learner.
    if exists (select 1 from public.family_links where parent_id = new.id) then
      raise exception 'cannot turn a linked parent account into a learner';
    end if;
    update public.profiles
       set role = 'learner',
           username = new.raw_app_meta_data ->> 'username'
     where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_app_metadata_updated
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_user_app_metadata_update();
