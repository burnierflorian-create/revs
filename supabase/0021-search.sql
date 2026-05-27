-- ─────────────────────── Global search ───────────────────────
-- One RPC returning a heterogeneous list of hits with a discriminator
-- column. The frontend dispatches navigation based on `kind`:
--   'car'     → /spot/:ref_id   (most-recent spot for brand+model)
--   'spotter' → /u/:ref_id
--   'city'    → /classement?city=…    (could be a future filtered view)
--   'brand'   → /brand/:slug
-- Results are ranked by a simple substring match score with a per-kind
-- cap so no single kind crowds the list.

create or replace function public.global_search(
  p_q text,
  p_limit int default 20
) returns table (
  kind     text,    -- 'car' | 'spotter' | 'city' | 'brand'
  label    text,    -- display string ("Ferrari 488 GTB", "@bobcars", "Annecy", "Lamborghini")
  sublabel text,    -- secondary (count, city, etc.)
  ref_id   text,    -- target id/slug for navigation
  rank     int
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(trim(p_q)) as needle
  ),
  -- Cars: distinct (brand, model) ranked by spot count
  cars as (
    select
      'car'::text as kind,
      s.brand || ' ' || s.model as label,
      count(*)::text || ' spot' || case when count(*) > 1 then 's' else '' end as sublabel,
      (
        select id::text from public.spots s2
        where s2.brand = s.brand and s2.model = s.model
        order by created_at desc limit 1
      ) as ref_id,
      (case when lower(s.brand || ' ' || s.model) like (select needle from q) || '%' then 10 else 5 end) as rank
    from public.spots s
    where lower(s.brand || ' ' || s.model) like '%' || (select needle from q) || '%'
    group by s.brand, s.model
    order by count(*) desc
    limit 8
  ),
  -- Spotters: pseudo match, public profiles only
  spotters as (
    select
      'spotter'::text as kind,
      coalesce(p.pseudo, 'Spotter') as label,
      coalesce(p.ville, '') as sublabel,
      p.user_id::text as ref_id,
      (case when lower(coalesce(p.pseudo, '')) like (select needle from q) || '%' then 9 else 4 end) as rank
    from public.profiles p
    where p.is_public = true
      and p.pseudo is not null
      and lower(p.pseudo) like '%' || (select needle from q) || '%'
    limit 8
  ),
  -- Cities: distinct profile.ville matching, ranked by spot count
  cities as (
    select
      'city'::text as kind,
      p.ville as label,
      count(s.id)::text || ' spot' || case when count(s.id) > 1 then 's' else '' end as sublabel,
      p.ville as ref_id,
      (case when lower(p.ville) like (select needle from q) || '%' then 8 else 3 end) as rank
    from public.profiles p
    join public.spots s on s.user_id = p.user_id
    where p.ville is not null and trim(p.ville) <> ''
      and lower(p.ville) like '%' || (select needle from q) || '%'
    group by p.ville
    order by count(s.id) desc
    limit 5
  ),
  -- Brand hits are computed client-side from the hardcoded BRANDS
  -- list (src/lib/brands.ts) — no canonical brand table in the DB to
  -- query against, and the client list is the source of truth.
  combined as (
    select * from cars
    union all select * from spotters
    union all select * from cities
  )
  select * from combined all_hits
  where length((select needle from q)) >= 2
  order by rank desc, label asc
  limit p_limit;
$$;

grant execute on function public.global_search(text, int) to authenticated, anon;
