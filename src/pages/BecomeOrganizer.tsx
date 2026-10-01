// ═══════════════ DEVENIR ORGANISATEUR REVS ═══════════════
//
// Phase 1 du parcours organisateur : la CANDIDATURE. La création d'événement
// n'est pas développée ici — elle existe déjà (`/new-event`) et reste gardée
// par la policy INSERT de `events`, qui exige `role in ('organizer','admin')`.
//
// ── CE QUE LA PAGE PROMET ──
// Rien qui n'existe pas. Les bénéfices annoncés à l'étape 1 décrivent ce que
// le rôle permet (proposer ses événements au sein de REVS), pas des
// fonctionnalités à venir. Aucune promesse de délai non plus : REVS n'a pas
// de SLA, l'écrire en inventerait un.
//
// ── AUCUNE DEMANDE N'EST CRÉÉE AVANT L'ENVOI ──
// Le formulaire vit en mémoire. Revenir en arrière ne perd rien, quitter ne
// laisse aucune ligne orpheline en base.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Eye,
  Loader2,
  MapPin,
  Share2,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { hapticSuccess } from '../lib/haptic'
import {
  ATTENDANCE_RANGES,
  DESCRIPTION_MAX,
  EMPTY_FORM,
  EVENT_TYPES,
  EXPERIENCE_LEVELS,
  fetchMyOrganizerRequest,
  stepIdentityErrors,
  stepProjectErrors,
  submitOrganizerRequest,
  type EventType,
  type OrganizerForm,
  type OrganizerRequestState,
} from '../lib/organizer'

const ACCENT = '#E8203A'
const BENEFITS = [
  { key: 'create', Icon: Calendar },
  { key: 'gather', Icon: Users },
  { key: 'share', Icon: Share2 },
  { key: 'visibility', Icon: Eye },
] as const

/** Étapes : 0 présentation · 1 informations · 2 projet · 3 récapitulatif · 4 confirmation. */
type Step = 0 | 1 | 2 | 3 | 4

export default function BecomeOrganizer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(0)
  const [form, setForm] = useState<OrganizerForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [existing, setExisting] = useState<OrganizerRequestState | null>(null)
  const [isOrganizer, setIsOrganizer] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [emailed, setEmailed] = useState(true)
  const [email, setEmail] = useState('')
  const paneRef = useRef<HTMLDivElement>(null)

  const set = useCallback(
    <K extends keyof OrganizerForm>(k: K, v: OrganizerForm[K]) => {
      setForm((f) => ({ ...f, [k]: v }))
      setErrors((e) => (e[k] ? { ...e, [k]: '' } : e))
    },
    [],
  )

  // Préremplissage : tout ce que le compte sait déjà. Redemander son pseudo à
  // quelqu'un qui l'a choisi il y a six mois n'apporte aucune information.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !alive) {
        setLoading(false)
        return
      }
      setEmail(user.email ?? '')
      const [{ data: prof }, req] = await Promise.all([
        supabase
          .from('profiles')
          .select('pseudo, ville, instagram, role')
          .eq('user_id', user.id)
          .maybeSingle(),
        fetchMyOrganizerRequest(),
      ])
      if (!alive) return
      const p = prof as {
        pseudo?: string | null
        ville?: string | null
        instagram?: string | null
        role?: string | null
      } | null
      setForm((f) => ({
        ...f,
        display_name: p?.pseudo ?? '',
        city_region: p?.ville ?? '',
        event_region: p?.ville ?? '',
        instagram_url: p?.instagram ? `@${p.instagram}` : '',
      }))
      setIsOrganizer(p?.role === 'organizer' || p?.role === 'admin')
      setExisting(req)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  // Chaque changement d'étape repart en haut : garder la position du
  // précédent écran donnerait l'impression que rien ne s'est passé.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [step])

  const back = () => {
    if (step === 0) navigate(-1)
    else if (step === 4) navigate('/settings')
    else setStep((s) => (s - 1) as Step)
  }

  function next() {
    if (step === 1) {
      const e = stepIdentityErrors(form)
      if (Object.keys(e).length) {
        setErrors(e)
        return
      }
    }
    if (step === 2) {
      const e = stepProjectErrors(form)
      if (Object.keys(e).length) {
        setErrors(e)
        return
      }
    }
    setStep((s) => (s + 1) as Step)
  }

  async function send() {
    if (sending) return
    if (!form.consent_contact) {
      setErrors({ consent_contact: 'required' })
      return
    }
    setSending(true)
    setSendError(null)
    const res = await submitOrganizerRequest(form)
    setSending(false)
    if (!res.ok) {
      setSendError(res.error)
      return
    }
    hapticSuccess()
    setEmailed(res.emailed)
    setStep(4)
  }

  const toggleType = (k: EventType) =>
    setForm((f) => ({
      ...f,
      event_types: f.event_types.includes(k)
        ? f.event_types.filter((x) => x !== k)
        : [...f.event_types, k],
    }))

  const descLeft = DESCRIPTION_MAX - form.project_description.length

  // ── États qui court-circuitent le formulaire ──
  const blocked = useMemo(() => {
    if (isOrganizer) return 'approved' as const
    if (existing?.status === 'pending') return 'pending' as const
    if (existing?.status === 'approved') return 'approved' as const
    return null
  }, [isOrganizer, existing])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="h-6 w-6 animate-spin text-fg2" />
      </div>
    )
  }

  // PLEIN ÉCRAN, comme le questionnaire et le tutoriel — et pour la même
  // raison. Dans le conteneur de pile ordinaire, l'en-tête et sa barre de
  // progression défilaient hors de vue dès le deuxième écran, et le bouton
  // collant recouvrait la dernière carte. Ici le défilement est interne :
  // l'en-tête reste, le pied reste dans le flux, rien ne se chevauche.
  //
  // PORTAIL OBLIGATOIRE : `.stack-overlay` a `z-index: 30`, donc il crée un
  // contexte d'empilement. Un `z-[60]` écrit à l'intérieur reste prisonnier de
  // ce contexte et passe quand même SOUS la barre de navigation (z-40) — elle
  // réapparaissait au-dessus du pied de page. Monté sur `document.body`, le
  // z-index redevient global. (Même raison que `TutorialTour`.)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg text-fg">
      {/* ── EN-TÊTE ── */}
      <div
        className="flex items-center gap-2 px-4"
        style={{ paddingTop: 'calc(max(0.75rem, env(safe-area-inset-top)) + 6px)' }}
      >
        <button
          onClick={back}
          aria-label={t('organizer.back')}
          className="tappable -ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-fg2"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-[17px] font-black tracking-tight">
          {t('organizer.pageTitle')}
        </h1>
      </div>

      {/* Indicateur 1—2—3—4. Absent de la confirmation : à ce moment-là il
          n'y a plus d'étapes, et le laisser suggérerait qu'il en reste. */}
      {step < 4 && (
        <div className="flex items-center gap-1.5 px-4 pt-3" aria-hidden>
          {[0, 1, 2, 3].map((n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: n <= step ? ACCENT : 'rgba(255,255,255,0.13)' }}
            />
          ))}
        </div>
      )}

      <div ref={paneRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-5">
        {blocked ? (
          <StatusPanel
            status={blocked}
            createdAt={existing?.created_at ?? null}
            onEvents={() => navigate('/events')}
            onSettings={() => navigate('/settings')}
          />
        ) : step === 0 ? (
          /* ══════════ ÉTAPE 1 — PRÉSENTATION ══════════ */
          <>
            <div
              className="relative isolate -mx-4 -mt-5 overflow-hidden px-4 pb-7 pt-8"
              style={{
                background:
                  'radial-gradient(130% 80% at 50% 0%, rgba(232,32,58,0.26), transparent 66%)',
              }}
            >
              <h2
                className="font-display font-black uppercase tracking-tight text-fg"
                style={{ fontSize: 'clamp(29px, 8.6vw, 40px)', lineHeight: 1.03 }}
              >
                {t('organizer.intro.title')}
              </h2>
              <p className="mt-4 text-[15px] font-semibold leading-snug text-fg/90">
                {t('organizer.intro.subtitle')}
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-fg2">
                {t('organizer.intro.body')}
              </p>
            </div>

            <div className="mt-5 grid gap-2.5">
              {BENEFITS.map(({ key, Icon }) => (
                <div
                  key={key}
                  className="flex items-start gap-3 rounded-2xl bg-card p-4"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                    style={{
                      background: 'rgba(232,32,58,0.13)',
                      border: '1px solid rgba(232,32,58,0.3)',
                      color: ACCENT,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-bold text-fg">
                      {t(`organizer.benefits.${key}.title`)}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-snug text-fg2">
                      {t(`organizer.benefits.${key}.body`)}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {existing?.status === 'rejected' && (
              <p
                className="mt-5 rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed text-fg2"
                style={{
                  background: 'var(--color-glass-mid)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {t('organizer.status.rejectedCanReapply')}
              </p>
            )}
          </>
        ) : step === 1 ? (
          /* ══════════ ÉTAPE 2 — TES INFORMATIONS ══════════ */
          <>
            <StepHead
              title={t('organizer.identity.title')}
              sub={t('organizer.identity.subtitle')}
            />
            <div className="mt-5 grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t('organizer.fields.firstName')}
                  value={form.first_name}
                  onChange={(v) => set('first_name', v)}
                  error={errors.first_name && t('organizer.errors.required')}
                  autoComplete="given-name"
                  maxLength={80}
                  required
                />
                <Field
                  label={t('organizer.fields.lastName')}
                  value={form.last_name}
                  onChange={(v) => set('last_name', v)}
                  error={errors.last_name && t('organizer.errors.required')}
                  autoComplete="family-name"
                  maxLength={80}
                  required
                />
              </div>
              <Field
                label={t('organizer.fields.displayName')}
                value={form.display_name}
                onChange={(v) => set('display_name', v)}
                error={errors.display_name && t('organizer.errors.required')}
                maxLength={80}
                required
              />
              {/* L'adresse n'est pas modifiable : le serveur prend de toute
                  façon celle du jeton. Un champ libre laisserait croire le
                  contraire. */}
              <ReadOnlyField label={t('organizer.fields.email')} value={email} hint={t('organizer.fields.emailHint')} />
              <Field
                label={t('organizer.fields.phone')}
                value={form.phone}
                onChange={(v) => set('phone', v)}
                error={
                  errors.phone === 'phone'
                    ? t('organizer.errors.phone')
                    : errors.phone && t('organizer.errors.required')
                }
                hint={t('organizer.fields.phoneHint')}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={24}
                required
              />
              <Field
                label={t('organizer.fields.cityRegion')}
                value={form.city_region}
                onChange={(v) => set('city_region', v)}
                error={errors.city_region && t('organizer.errors.required')}
                placeholder={t('organizer.fields.cityRegionPlaceholder')}
                maxLength={120}
                required
              />
              <Field
                label={t('organizer.fields.instagram')}
                value={form.instagram_url}
                onChange={(v) => set('instagram_url', v)}
                error={errors.instagram_url && t('organizer.errors.url')}
                placeholder="@revs"
                maxLength={200}
              />
              <Field
                label={t('organizer.fields.website')}
                value={form.website_url}
                onChange={(v) => set('website_url', v)}
                error={errors.website_url && t('organizer.errors.url')}
                placeholder="exemple.fr"
                type="url"
                inputMode="url"
                maxLength={200}
              />
              <Field
                label={t('organizer.fields.organization')}
                value={form.organization_name}
                onChange={(v) => set('organization_name', v)}
                hint={t('organizer.fields.organizationHint')}
                maxLength={120}
              />
            </div>
          </>
        ) : step === 2 ? (
          /* ══════════ ÉTAPE 3 — EXPÉRIENCE ET PROJET ══════════ */
          <>
            <StepHead
              title={t('organizer.project.title')}
              sub={t('organizer.project.subtitle')}
            />
            <div className="mt-5 grid gap-6">
              <div>
                <Legend
                  text={t('organizer.project.typesLabel')}
                  required
                  error={errors.event_types && t('organizer.errors.pickOne')}
                />
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {EVENT_TYPES.map((k) => {
                    const on = form.event_types.includes(k)
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          toggleType(k)
                          setErrors((e) => (e.event_types ? { ...e, event_types: '' } : e))
                        }}
                        className="tappable flex items-center gap-2 rounded-2xl px-3 py-3 text-left text-[13px] font-semibold transition-all active:scale-[0.98]"
                        style={{
                          background: on ? 'rgba(232,32,58,0.14)' : 'var(--color-card)',
                          border: `1.5px solid ${on ? ACCENT : 'var(--color-border)'}`,
                          color: on ? 'rgb(var(--color-fg))' : 'rgb(var(--color-fg-2))',
                        }}
                      >
                        {/* L'état ne tient pas qu'à la couleur : une coche le
                            dit aussi, pour qui ne distingue pas le rouge. */}
                        <span
                          className="flex h-4 w-4 flex-none items-center justify-center rounded-[5px]"
                          style={{
                            background: on ? ACCENT : 'transparent',
                            border: `1.5px solid ${on ? ACCENT : 'var(--color-border)'}`,
                          }}
                        >
                          {on && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <span className="min-w-0 truncate">
                          {t(`organizer.types.${k}`)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Legend
                  text={t('organizer.project.experienceLabel')}
                  required
                  error={errors.experience_level && t('organizer.errors.required')}
                />
                <div className="mt-2.5 grid gap-2">
                  {EXPERIENCE_LEVELS.map((k) => (
                    <Radio
                      key={k}
                      label={t(`organizer.experience.${k}`)}
                      checked={form.experience_level === k}
                      onSelect={() => set('experience_level', k)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Legend
                  text={t('organizer.project.descriptionLabel')}
                  required
                  error={
                    errors.project_description === 'too_long'
                      ? t('organizer.errors.tooLong')
                      : errors.project_description && t('organizer.errors.required')
                  }
                />
                <textarea
                  value={form.project_description}
                  onChange={(e) => set('project_description', e.target.value.slice(0, DESCRIPTION_MAX))}
                  rows={6}
                  maxLength={DESCRIPTION_MAX}
                  placeholder={t('organizer.project.descriptionPlaceholder')}
                  className="mt-2.5 w-full resize-none rounded-2xl bg-card px-4 py-3.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg2/50 focus:ring-2 focus:ring-accent/45"
                  style={{ border: '1px solid var(--color-border)' }}
                />
                <p
                  className="mt-1.5 text-right text-[11px]"
                  style={{ color: descLeft < 60 ? ACCENT : 'rgb(var(--color-fg-2))' }}
                >
                  {t('organizer.project.charsLeft', { count: descLeft })}
                </p>
              </div>

              <div>
                <Legend text={t('organizer.project.attendanceLabel')} />
                <div className="mt-2.5 grid gap-2">
                  {ATTENDANCE_RANGES.map((k) => (
                    <Radio
                      key={k}
                      label={t(`organizer.attendance.${k}`)}
                      checked={form.expected_attendance === k}
                      onSelect={() => set('expected_attendance', k)}
                    />
                  ))}
                </div>
              </div>

              <Field
                label={t('organizer.project.regionLabel')}
                value={form.event_region}
                onChange={(v) => set('event_region', v)}
                hint={t('organizer.project.regionHint')}
                maxLength={120}
              />
            </div>
          </>
        ) : step === 3 ? (
          /* ══════════ ÉTAPE 4 — RÉCAPITULATIF ══════════ */
          <>
            <StepHead
              title={t('organizer.recap.title')}
              sub={t('organizer.recap.subtitle')}
            />

            <RecapSection
              title={t('organizer.recap.identity')}
              onEdit={() => setStep(1)}
              editLabel={t('organizer.recap.edit')}
              rows={[
                [t('organizer.fields.firstName'), form.first_name],
                [t('organizer.fields.lastName'), form.last_name],
                [t('organizer.fields.displayName'), form.display_name],
                [t('organizer.fields.email'), email],
                [t('organizer.fields.phone'), form.phone],
                [t('organizer.fields.cityRegion'), form.city_region],
                [t('organizer.fields.instagram'), form.instagram_url],
                [t('organizer.fields.website'), form.website_url],
                [t('organizer.fields.organization'), form.organization_name],
              ]}
            />

            <RecapSection
              title={t('organizer.recap.project')}
              onEdit={() => setStep(2)}
              editLabel={t('organizer.recap.edit')}
              rows={[
                [
                  t('organizer.project.typesLabel'),
                  form.event_types.map((k) => t(`organizer.types.${k}`)).join(' · '),
                ],
                [
                  t('organizer.project.experienceLabel'),
                  form.experience_level ? t(`organizer.experience.${form.experience_level}`) : '',
                ],
                [t('organizer.project.regionLabel'), form.event_region],
                [
                  t('organizer.project.attendanceLabel'),
                  form.expected_attendance ? t(`organizer.attendance.${form.expected_attendance}`) : '',
                ],
                [t('organizer.project.descriptionLabel'), form.project_description],
              ]}
            />

            <button
              type="button"
              role="checkbox"
              aria-checked={form.consent_contact}
              onClick={() => {
                set('consent_contact', !form.consent_contact)
                setErrors((e) => ({ ...e, consent_contact: '' }))
              }}
              className="tappable mt-5 flex w-full items-start gap-3 rounded-2xl p-4 text-left"
              style={{
                background: 'var(--color-card)',
                border: `1px solid ${errors.consent_contact ? ACCENT : 'var(--color-border)'}`,
              }}
            >
              <span
                className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md"
                style={{
                  background: form.consent_contact ? ACCENT : 'transparent',
                  border: `1.5px solid ${form.consent_contact ? ACCENT : 'var(--color-border)'}`,
                }}
              >
                {form.consent_contact && <Check className="h-3.5 w-3.5 text-white" />}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg2">
                {t('organizer.recap.consent')}
              </span>
            </button>
            {errors.consent_contact && (
              <p className="mt-2 text-[12px] font-semibold" style={{ color: ACCENT }}>
                {t('organizer.errors.consent')}
              </p>
            )}

            {sendError && (
              <p
                className="mt-4 rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed"
                style={{
                  background: 'rgba(232,32,58,0.1)',
                  border: '1px solid rgba(232,32,58,0.35)',
                  color: ACCENT,
                }}
              >
                {t(
                  sendError === 'request_already_open' || sendError === 'already_organizer'
                    ? `organizer.errors.${sendError}`
                    : 'organizer.errors.sendFailed',
                )}
              </p>
            )}
          </>
        ) : (
          /* ══════════ ÉTAPE 5 — CONFIRMATION ══════════ */
          <div className="pt-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background: 'rgba(232,32,58,0.14)',
                border: '1px solid rgba(232,32,58,0.34)',
              }}
            >
              <Check className="h-7 w-7" style={{ color: ACCENT }} />
            </div>
            <h2
              className="mt-5 font-display font-black tracking-tight text-fg"
              style={{ fontSize: 'clamp(26px, 7.4vw, 34px)', lineHeight: 1.08 }}
            >
              {t('organizer.done.title')}
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-fg2">
              {t('organizer.done.body')}
            </p>

            <div className="mt-7 grid gap-3">
              {(['sent', 'review', 'answer', 'activated'] as const).map((k, i) => (
                <div key={k} className="flex items-center gap-3">
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-black"
                    style={
                      i === 0
                        ? { background: ACCENT, color: '#fff' }
                        : {
                            border: '1.5px solid var(--color-border)',
                            color: 'rgb(var(--color-fg-2))',
                          }
                    }
                  >
                    {i === 0 ? <Check className="h-3.5 w-3.5" /> : ''}
                  </span>
                  <span
                    className="text-[13.5px]"
                    style={{
                      color: i === 0 ? 'rgb(var(--color-fg))' : 'rgb(var(--color-fg-2))',
                      fontWeight: i === 0 ? 700 : 500,
                    }}
                  >
                    {t(`organizer.done.timeline.${k}`)}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-6 text-[12.5px] leading-relaxed text-fg2">
              {t('organizer.done.note')}
            </p>

            {/* Si l'alerte à REVS n'est pas partie, on le dit. Une confirmation
                qui tairait cela serait fausse — le dossier est bien
                enregistré, mais il n'a été signalé à personne. */}
            {!emailed && (
              <p
                className="mt-4 rounded-2xl px-4 py-3 text-[12px] leading-relaxed"
                style={{
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.32)',
                  color: '#F59E0B',
                }}
              >
                {t('organizer.done.emailPending')}
              </p>
            )}

            <div className="mt-8 grid gap-2.5">
              <button
                onClick={() => navigate('/settings')}
                className="tappable w-full rounded-full py-3.5 text-[13px] font-extrabold tracking-wider text-white"
                style={{ background: ACCENT, boxShadow: '0 10px 28px rgba(232,32,58,0.4)' }}
              >
                {t('organizer.done.backToSettings')}
              </button>
              <button
                onClick={() => navigate('/events')}
                className="tappable w-full rounded-full py-3.5 text-[13px] font-bold text-fg2"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {t('organizer.done.discoverEvents')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── CTA COLLANT ──
          `sticky` et non `fixed` : il reste visible pendant le défilement,
          mais il garde sa place dans le flux, donc il ne recouvre jamais le
          dernier champ — y compris quand le clavier réduit la fenêtre. */}
      {!blocked && step < 4 && (
        <div
          className="flex-none px-4 pt-3"
          style={{
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            background: 'rgb(var(--color-bg))',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <button
            onClick={step === 3 ? send : next}
            disabled={sending}
            className="tappable flex w-full items-center justify-center gap-2 rounded-full py-4 text-[13.5px] font-extrabold tracking-wider text-white transition-transform active:scale-[0.99] disabled:opacity-60"
            style={{ background: ACCENT, boxShadow: '0 10px 28px rgba(232,32,58,0.4)' }}
          >
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {step === 0
              ? t('organizer.cta.start')
              : step === 3
                ? sending
                  ? t('organizer.cta.sending')
                  : t('organizer.cta.send')
                : t('organizer.cta.next')}
            {!sending && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}

// ─────────────────────── Primitives ───────────────────────

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="font-display text-[23px] font-black tracking-tight text-fg">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-fg2">{sub}</p>
    </div>
  )
}

function Legend({
  text,
  required,
  error,
}: {
  text: string
  required?: boolean
  error?: string | false
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] font-bold text-fg">
        {text}
        {required && <span style={{ color: ACCENT }}> *</span>}
      </span>
      {error && (
        <span className="text-[11.5px] font-semibold" style={{ color: ACCENT }}>
          {error}
        </span>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | false
  hint?: string
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: 'tel' | 'url' | 'text'
  maxLength?: number
  required?: boolean
}) {
  return (
    <label className="block">
      <Legend text={label} required={required} error={error} />
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={!!error}
        className="mt-2 w-full rounded-2xl bg-card px-4 py-3.5 text-[14.5px] text-fg outline-none placeholder:text-fg2/50 focus:ring-2 focus:ring-accent/45"
        // La bordure rouge DOUBLE le message d'erreur, elle ne le remplace
        // pas : la couleur seule ne doit jamais porter l'information.
        style={{ border: `1px solid ${error ? ACCENT : 'var(--color-border)'}` }}
      />
      {hint && !error && (
        <span className="mt-1.5 block text-[11.5px] leading-snug text-fg2">{hint}</span>
      )}
    </label>
  )
}

function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div>
      <Legend text={label} />
      <div
        className="mt-2 flex items-center rounded-2xl px-4 py-3.5 text-[14.5px] text-fg/70"
        style={{ background: 'var(--color-glass-mid)', border: '1px solid var(--color-border)' }}
      >
        <span className="min-w-0 truncate">{value || '—'}</span>
      </div>
      <span className="mt-1.5 block text-[11.5px] leading-snug text-fg2">{hint}</span>
    </div>
  )
}

function Radio({
  label,
  checked,
  onSelect,
}: {
  label: string
  checked: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="tappable flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-[13.5px] font-semibold transition-all active:scale-[0.99]"
      style={{
        background: checked ? 'rgba(232,32,58,0.12)' : 'var(--color-card)',
        border: `1.5px solid ${checked ? ACCENT : 'var(--color-border)'}`,
        color: checked ? 'rgb(var(--color-fg))' : 'rgb(var(--color-fg-2))',
      }}
    >
      <span
        className="flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full"
        style={{
          width: 18,
          height: 18,
          border: `1.5px solid ${checked ? ACCENT : 'var(--color-border)'}`,
        }}
      >
        {checked && (
          <span
            className="block rounded-full"
            style={{ width: 9, height: 9, background: ACCENT }}
          />
        )}
      </span>
      {label}
    </button>
  )
}

function RecapSection({
  title,
  rows,
  onEdit,
  editLabel,
}: {
  title: string
  rows: [string, string][]
  onEdit: () => void
  editLabel: string
}) {
  const visible = rows.filter(([, v]) => v && v.trim() !== '')
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 className="label-up text-[10px] text-fg2">{title}</h3>
        <button
          onClick={onEdit}
          className="tappable rounded-full px-3 py-1.5 text-[11.5px] font-bold"
          style={{ color: ACCENT, border: `1px solid rgba(232,32,58,0.35)` }}
        >
          {editLabel}
        </button>
      </div>
      <div
        className="overflow-hidden rounded-2xl bg-card"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {visible.map(([k, v], i) => (
          <div
            key={k}
            className="flex gap-3 px-4 py-3"
            style={{ borderTop: i ? '1px solid var(--color-border)' : undefined }}
          >
            <span className="w-[38%] flex-none text-[12px] text-fg2">{k}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] font-semibold text-fg">
              {v}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Ce qu'on voit quand un dossier existe déjà, ou que le rôle est acquis. */
function StatusPanel({
  status,
  createdAt,
  onEvents,
  onSettings,
}: {
  status: 'pending' | 'approved'
  createdAt: string | null
  onEvents: () => void
  onSettings: () => void
}) {
  const { t } = useTranslation()
  const approved = status === 'approved'
  return (
    <div className="pt-4">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{
          background: 'rgba(232,32,58,0.14)',
          border: '1px solid rgba(232,32,58,0.34)',
        }}
      >
        {approved ? (
          <Check className="h-7 w-7" style={{ color: ACCENT }} />
        ) : (
          <MapPin className="h-7 w-7" style={{ color: ACCENT }} />
        )}
      </div>
      <h2 className="mt-5 font-display text-[26px] font-black tracking-tight text-fg">
        {t(approved ? 'organizer.status.approvedTitle' : 'organizer.status.pendingTitle')}
      </h2>
      <p className="mt-3 text-[14px] leading-relaxed text-fg2">
        {t(approved ? 'organizer.status.approvedBody' : 'organizer.status.pendingBody')}
      </p>
      {!approved && createdAt && (
        <p className="mt-3 text-[12px] text-fg2">
          {t('organizer.status.sentOn', {
            date: new Date(createdAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </p>
      )}
      <div className="mt-8 grid gap-2.5">
        <button
          onClick={onEvents}
          className="tappable w-full rounded-full py-3.5 text-[13px] font-extrabold tracking-wider text-white"
          style={{ background: ACCENT, boxShadow: '0 10px 28px rgba(232,32,58,0.4)' }}
        >
          {t('organizer.done.discoverEvents')}
        </button>
        <button
          onClick={onSettings}
          className="tappable w-full rounded-full py-3.5 text-[13px] font-bold text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('organizer.done.backToSettings')}
        </button>
      </div>
    </div>
  )
}
