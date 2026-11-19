-- Round 8: teacher and admin roles. Own migration: a new enum value cannot be
-- used in the same transaction that adds it.

alter type public.user_role add value if not exists 'teacher';
alter type public.user_role add value if not exists 'admin';
