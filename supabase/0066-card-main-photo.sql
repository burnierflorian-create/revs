-- Phase 3: let a user pick the hero photo of one of their cards.
-- Takes a spot id; the server derives the card (brand,model,base colour) and
-- verifies the spot belongs to the caller, then pins its photo as main_photo_url.
create or replace function public.set_card_main_photo(p_spot_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot public.spots%rowtype;
begin
  select * into v_spot from public.spots where id = p_spot_id;
  if not found or v_spot.user_id <> auth.uid() then
    raise exception 'not allowed';
  end if;
  update public.card_progress set
    main_photo_url = v_spot.photo_url,
    updated_at     = now()
  where user_id  = auth.uid()
    and brand_key = public.card_norm(v_spot.brand)
    and model_key = public.card_norm(v_spot.model)
    and color_key = public.color_key(v_spot.color);
  return v_spot.photo_url;
end; $$;

grant execute on function public.set_card_main_photo(uuid) to authenticated;
