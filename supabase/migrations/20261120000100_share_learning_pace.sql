-- Owner decision (Round 9): learning pace (slow / medium / fast) is a new sharing
-- item. The learner chooses; private by default, like misconceptions. Additive:
-- the live demo (main) ignores sharing items it does not know.
insert into public.sharing_defaults (item, default_shared, locked)
values ('learning_pace', false, false)
on conflict (item) do nothing;

insert into public.sharing_settings (learner_id, item, shared, locked)
select p.id, 'learning_pace', false, false
from public.profiles p
where p.role = 'learner'
on conflict do nothing;

-- Parents read only the pace level, and only when the child shares it.
create view public.parent_learning_pace_v with (security_invoker = false) as
select lp.learner_id,
       lp.learning_rate ->> 'level' as level,
       lp.updated_at
from public.learner_profiles lp
where lp.learning_rate ? 'level'
  and public.can_view_learner(lp.learner_id)
  and public.is_shared(lp.learner_id, 'learning_pace');

revoke all on public.parent_learning_pace_v from anon, public;
grant select on public.parent_learning_pace_v to authenticated;
