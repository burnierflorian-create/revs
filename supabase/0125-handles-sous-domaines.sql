-- ═══════ PSEUDOS SOCIAUX : N'IMPORTE QUEL SOUS-DOMAINE ═══════
--
-- `normalize_social_handles()` ne retirait que `www.`. Coller une URL mobile
-- — `m.instagram.com/revs_officiel` — donnait donc le pseudo
-- « m.instagram.com » : la chaîne était tronquée au premier « / », et il ne
-- restait que le nom d'hôte. Le lien menait alors à un profil inexistant.
--
-- Le client applique la même règle (src/lib/social.ts). Les deux doivent
-- rester d'accord : la base est la garantie, le client est le confort.
create or replace function public.normalize_social_handles()
returns trigger
language plpgsql
as $$
begin
  if new.instagram is not null then
    new.instagram := nullif(
      regexp_replace(
        regexp_replace(lower(trim(new.instagram)),
          '^(https?://)?([a-z0-9-]+\.)*instagram\.com/', ''),
        '^@+|/.*$|\s', '', 'g'),
      '');
  end if;
  if new.tiktok is not null then
    new.tiktok := nullif(
      regexp_replace(
        regexp_replace(lower(trim(new.tiktok)),
          '^(https?://)?([a-z0-9-]+\.)*tiktok\.com/', ''),
        '^@+|/.*$|\s', '', 'g'),
      '');
  end if;
  return new;
end
$$;

notify pgrst, 'reload schema';
