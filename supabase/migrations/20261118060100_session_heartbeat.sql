-- Heartbeats can arrive together (slow network, a tab waking up). Add time
-- atomically instead of read-then-write, so no seconds are lost.

create function public.session_heartbeat(
  p_session uuid,
  p_active int,
  p_idle int,
  p_slide int,
  p_paused boolean
)
returns table (active_seconds int, idle_seconds int)
language sql
set search_path = ''
as $$
  update public.sessions s
     set active_seconds = s.active_seconds + greatest(p_active, 0),
         idle_seconds = s.idle_seconds + greatest(p_idle, 0),
         slide_no = p_slide,
         last_heartbeat_at = now(),
         paused_at = case when p_paused then coalesce(s.paused_at, now()) else null end
   where s.id = p_session and s.ended_at is null
  returning s.active_seconds, s.idle_seconds;
$$;

-- Server code only (service role).
revoke execute on function public.session_heartbeat(uuid, int, int, int, boolean) from public, anon, authenticated;
grant execute on function public.session_heartbeat(uuid, int, int, int, boolean) to service_role;

-- Set the away-alert flag once, atomically: returns true only for the caller that set it.
create function public.claim_away_alert(p_session uuid)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    update public.sessions set away_alert_sent_at = now()
     where id = p_session and away_alert_sent_at is null
    returning id
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_away_alert(uuid) from public, anon, authenticated;
grant execute on function public.claim_away_alert(uuid) to service_role;
