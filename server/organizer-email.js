// ═══════════ GABARITS D'E-MAIL — CANDIDATURE ORGANISATEUR ═══════════
//
// Pourquoi ce fichier vit dans `server/` et non dans `api/` : il est importé
// par DEUX appelants — la fonction edge `api/organizer-request.ts` et le
// script de rattrapage `scripts/organizer-notify-pending.mjs`. Deux copies du
// même gabarit finiraient par diverger, et c'est le courriel de rattrapage,
// celui qu'on relit le moins, qui se serait dégradé en silence.
//
// (Même motif que `server/tutorial-content.js`, importé par `api/tutorial.ts`.)
//
// ── POURQUOI DES TABLEAUX ET DES STYLES EN LIGNE ──
// Gmail retire les blocs <style>, et Outlook ignore flexbox, grid et les
// variables CSS. Une mise en page « moderne » arriverait en colonne unique
// chez une bonne partie des destinataires. Ce code a l'air daté ; il est
// simplement compatible.

export const APP_ORIGIN = 'https://revs-ten.vercel.app'
export const ADMIN_SUBJECT = 'REVS — Nouvelle demande pour devenir organisateur'
export const USER_SUBJECT = 'REVS — Ta demande d\u2019organisateur a bien été reçue'

/** Échappement HTML — les champs viennent d'un formulaire public. */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}


const LABEL_FR = {
  cars_coffee: 'Cars & Coffee', meetup: 'Rassemblements', drive: 'Balades',
  track: 'Sorties circuit', show: 'Salons / Expositions',
  private: 'Événements privés', other: 'Autre',
  beginner: 'Je débute', under_1y: 'Moins d’un an', '1_3y': '1 à 3 ans',
  '3_5y': '3 à 5 ans', over_5y: 'Plus de 5 ans',
  lt20: 'Moins de 20', '20_50': '20 à 50', '50_100': '50 à 100',
  '100_250': '100 à 250', gt250: 'Plus de 250',
  unknown: 'Je ne sais pas encore',
}
const lab = (k) => LABEL_FR[k] ?? k

export const RED = '#E8203A'
const INK = '#111113'

function shell(title, intro, body) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0b0b0c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0b0c;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${INK};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <tr><td style="padding:26px 28px 20px;border-bottom:1px solid #26262a;">
    <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">REVS</div>
    <div style="font-size:10px;letter-spacing:3px;color:${RED};font-weight:700;margin-top:4px;">CARS. SPOTS. PASSION.</div>
  </td></tr>

  <tr><td style="padding:26px 28px 8px;">
    <h1 style="margin:0;font-size:21px;line-height:1.25;color:#ffffff;font-weight:800;">${esc(title)}</h1>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.55;color:#a3a3ab;">${esc(intro)}</p>
  </td></tr>

  ${body}

  <tr><td style="padding:20px 28px 28px;border-top:1px solid #26262a;">
    <p style="margin:0;font-size:11px;line-height:1.6;color:#6b6b73;">
      REVS · message automatique. Ne pas répondre à cette adresse.
    </p>
  </td></tr>
</table></td></tr></table></body></html>`
}

/** Un bloc « SECTION » avec ses lignes label / valeur. */
function section(heading, rows) {
  const visible = rows.filter(([, v]) => v && v.trim() !== '')
  if (!visible.length) return ''
  return `<tr><td style="padding:18px 28px 0;">
  <div style="font-size:10px;letter-spacing:2px;color:${RED};font-weight:700;margin-bottom:10px;">${esc(heading)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#17171a;border:1px solid #26262a;border-radius:10px;">
  ${visible
    .map(
      ([k, v], i) => `<tr>
      <td style="padding:11px 14px;${i ? 'border-top:1px solid #26262a;' : ''}width:42%;font-size:12px;color:#8a8a93;vertical-align:top;">${esc(k)}</td>
      <td style="padding:11px 14px;${i ? 'border-top:1px solid #26262a;' : ''}font-size:13px;color:#ffffff;font-weight:600;vertical-align:top;">${v}</td>
    </tr>`,
    )
    .join('')}
  </table></td></tr>`
}

export function adminEmail(d) {
  const link = (u) =>
    u ? `<a href="${esc(u)}" style="color:#ffffff;">${esc(u.replace(/^https?:\/\//, ''))}</a>` : null
  const profileUrl = `${APP_ORIGIN}/u/${d.userId}`

  const body =
    section('IDENTITÉ', [
      ['Prénom', esc(d.firstName)],
      ['Nom', esc(d.lastName)],
      ['Pseudo REVS', esc(d.displayName)],
      ['Email', `<a href="mailto:${esc(d.email)}" style="color:#ffffff;">${esc(d.email)}</a>`],
      ['Téléphone', `<a href="tel:${esc(d.phone.replace(/\s/g, ''))}" style="color:#ffffff;">${esc(d.phone)}</a>`],
      ['Ville / région', esc(d.cityRegion)],
    ]) +
    section('PRÉSENCE', [
      ['Instagram', link(d.instagram)],
      ['Site web', link(d.website)],
      ['Club / association / entreprise', esc(d.organization)],
    ]) +
    section('PROJET', [
      ['Types d’événements', esc(d.eventTypes.map(lab).join(' · '))],
      ['Expérience', esc(lab(d.experience))],
      ['Région des événements', esc(d.eventRegion)],
      ['Participants estimés', d.attendance ? esc(lab(d.attendance)) : ''],
    ]) +
    `<tr><td style="padding:18px 28px 0;">
      <div style="font-size:10px;letter-spacing:2px;color:${RED};font-weight:700;margin-bottom:10px;">DESCRIPTION DU PROJET</div>
      <div style="background:#17171a;border:1px solid #26262a;border-radius:10px;padding:14px;font-size:13px;line-height:1.65;color:#dcdce2;white-space:pre-wrap;">${esc(d.description)}</div>
    </td></tr>` +
    section('INFORMATIONS REVS', [
      ['Date de la demande', esc(d.createdAt)],
      ['User ID', `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;">${esc(d.userId)}</span>`],
      ['Statut', `<span style="color:${RED};">EN ATTENTE</span>`],
    ]) +
    `<tr><td style="padding:22px 28px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${RED};border-radius:999px;">
          <a href="${esc(profileUrl)}" style="display:inline-block;padding:13px 24px;font-size:13px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:0.4px;">Voir le profil REVS</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:11px;line-height:1.6;color:#6b6b73;">
        Il n’existe pas encore de back-office : l’instruction se fait dans Supabase
        (table <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">organizer_requests</span>),
        en passant <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">status</span> à
        <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">approved</span> ou
        <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">rejected</span>.
        Le rôle et la notification suivent automatiquement.
      </p>
    </td></tr>`

  return shell(
    'Nouvelle demande pour devenir organisateur',
    'Un utilisateur souhaite rejoindre les organisateurs REVS.',
    body,
  )
}

export function userEmail(firstName) {
  const body =
    `<tr><td style="padding:18px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#17171a;border:1px solid #26262a;border-radius:10px;">
        <tr><td style="padding:16px;">
          <div style="font-size:13px;color:#ffffff;font-weight:700;">Statut : en cours d’examen</div>
          <div style="font-size:12px;color:#8a8a93;margin-top:6px;line-height:1.6;">
            Notre équipe va examiner ta demande et reviendra vers toi une fois la décision prise.
          </div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <div style="font-size:10px;letter-spacing:2px;color:${RED};font-weight:700;margin-bottom:10px;">PROCHAINES ÉTAPES</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:6px 0;font-size:13px;color:#dcdce2;">✓&nbsp;&nbsp;Demande envoyée</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#8a8a93;">○&nbsp;&nbsp;En cours d’examen</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#8a8a93;">○&nbsp;&nbsp;Réponse</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#8a8a93;">○&nbsp;&nbsp;Statut organisateur activé</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 28px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${RED};border-radius:999px;">
          <a href="${APP_ORIGIN}/events" style="display:inline-block;padding:13px 24px;font-size:13px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:0.4px;">Découvrir les événements REVS</a>
        </td>
      </tr></table>
    </td></tr>`

  return shell(
    'Ta demande d’organisateur a bien été reçue',
    `${firstName ? firstName + ', nous' : 'Nous'} avons bien reçu ta demande pour devenir organisateur REVS.`,
    body,
  )
}

