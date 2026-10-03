-- ═══════ LE PSEUDO GARDAIT LA CHAÎNE DE REQUÊTE ═══════
--
-- `normalize_social_handles()` retirait tout ce qui suit un « / », mais pas
-- ce qui suit un « ? » ni un « # ». Or le bouton « Partager » d'Instagram
-- produit exactement cela :
--
--   https://www.instagram.com/revs_officiel?igsh=MXx...
--
-- Le pseudo stocké devenait donc `revs_officiel?igsh=mxx...`, et le lien
-- construit par-dessus menait à un profil inexistant. Vérifié :
--
--   entrée : https://instagram.com/revs_officiel?hl=fr
--   base   : revs_officiel?hl=fr      ← corrompu
--   client : revs_officiel            ← correct
--
-- C'est très probablement la raison pour laquelle « certains pseudos
-- fonctionnent et d'autres non » : ceux saisis à la main passaient, ceux
-- collés depuis le partage Instagram non.
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
        -- « @ » en tête, puis TOUT ce qui suit un /, un ? ou un #, puis les
        -- espaces. L'ancienne version oubliait ? et #.
        '^@+|[/?#].*$|\s', '', 'g'),
      '');
  end if;
  if new.tiktok is not null then
    new.tiktok := nullif(
      regexp_replace(
        regexp_replace(lower(trim(new.tiktok)),
          '^(https?://)?([a-z0-9-]+\.)*tiktok\.com/', ''),
        '^@+|[/?#].*$|\s', '', 'g'),
      '');
  end if;
  return new;
end
$$;

-- ── NORMALISATION DES DONNÉES EXISTANTES ──
-- Uniquement ce qui est manifestement corrompu : un pseudo contenant /, ?, #,
-- @ ou un espace ne peut pas être un pseudo Instagram valide. Les autres ne
-- sont pas touchés — on ne réécrit pas la donnée de quelqu'un « pour faire
-- propre ». Le UPDATE repasse par le déclencheur, qui fait le nettoyage.
update public.profiles
   set instagram = instagram
 where instagram is not null and instagram ~ '[/?#@[:space:]]';

update public.profiles
   set tiktok = tiktok
 where tiktok is not null and tiktok ~ '[/?#@[:space:]]';

notify pgrst, 'reload schema';
