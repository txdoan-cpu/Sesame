-- Round 1: accounts, family links, Row Level Security.
-- Synthetic demo data only.

-- ---------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('parent', 'learner');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  -- Learners sign in with a username; parents sign in with email.
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  constraint learner_has_username check ((role = 'learner') = (username is not null))
);

create table public.family_links (
  parent_id uuid not null references public.profiles (id) on delete cascade,
  learner_id uuid not null references public.profiles (id) on delete cascade,
  relationship text not null default 'parent' check (char_length(relationship) between 1 and 30),
  created_at timestamptz not null default now(),
  primary key (parent_id, learner_id)
);

create index family_links_learner_id_idx on public.family_links (learner_id);

-- A link must go from a parent profile to a learner profile.
create function public.check_family_link_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select role from public.profiles where id = new.parent_id) is distinct from 'parent' then
    raise exception 'family_links.parent_id must be a parent profile';
  end if;
  if (select role from public.profiles where id = new.learner_id) is distinct from 'learner' then
    raise exception 'family_links.learner_id must be a learner profile';
  end if;
  return new;
end;
$$;

create trigger family_links_check_roles
  before insert or update on public.family_links
  for each row execute function public.check_family_link_roles();

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up.
-- Role comes from app_metadata, which only the service role can set.
-- Public sign-up therefore always creates a parent; learner accounts are
-- created by the server (on behalf of a signed-in parent) with the admin API.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_role public.user_role :=
    coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'parent')::public.user_role;
begin
  insert into public.profiles (id, role, display_name, username)
  values (
    new.id,
    new_role,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  split_part(new.email, '@', 1)), 60),
    case when new_role = 'learner' then new.raw_app_meta_data ->> 'username' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Clients can only read. All writes go through server code (service role).
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.family_links enable row level security;

create policy "profiles: read own row"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "family_links: read own links"
  on public.family_links for select to authenticated
  using (parent_id = (select auth.uid()) or learner_id = (select auth.uid()));

revoke all on public.profiles, public.family_links from anon, authenticated;
grant select on public.profiles, public.family_links to authenticated;
grant all on public.profiles, public.family_links to service_role;

-- ---------------------------------------------------------------------------
-- Parent access goes through views only (CLAUDE.md §6).
-- This view runs with the owner's rights, and filters to the caller's
-- linked children itself.
-- ---------------------------------------------------------------------------

create view public.parent_children_v
with (security_invoker = false)
as
select
  p.id as learner_id,
  p.display_name,
  p.username,
  fl.relationship,
  fl.created_at as linked_at
from public.family_links fl
join public.profiles p on p.id = fl.learner_id
where fl.parent_id = (select auth.uid());

revoke all on public.parent_children_v from anon, authenticated, public;
grant select on public.parent_children_v to authenticated;
