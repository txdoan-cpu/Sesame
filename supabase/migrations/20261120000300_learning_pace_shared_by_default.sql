-- Owner decision (Round 10 review): learning pace is shared by default; the learner
-- can still turn it off (not locked). The item is one day old and no learner has
-- chosen yet, so existing rows follow the new default too.
update public.sharing_defaults set default_shared = true where item = 'learning_pace';
update public.sharing_settings set shared = true where item = 'learning_pace' and shared = false;
