// ─────────────────────── REVS Master Tutorial — page interne ───────────────────────
//
// ⚠️ TEMPORAIRE — V1 : réservé au créateur / compte administrateur.
// À remplacer ultérieurement par un vrai système de rôles/permissions si
// d'autres comptes doivent y accéder.
//
// Le contenu n'est PAS embarqué dans le bundle : il vient de /api/tutorial,
// qui vérifie la session avant de répondre. Cette page ne fait qu'afficher ce
// que le serveur a bien voulu lui donner — elle ne contient aucune règle
// d'autorisation, et n'a donc rien à contourner.
//
// Le rendu Markdown est volontairement fait maison plutôt qu'avec une
// bibliothèque : le sous-ensemble utilisé par le document est connu et fermé
// (titres, listes, tableaux, blocs de code, citations, gras, code en ligne),
// et ajouter une dépendance de rendu Markdown pour un seul écran interne
// alourdirait le bundle de tout le monde.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, X } from 'lucide-react'
import {
  fetchTutorial,
  TutorialDenied,
  type TutorialChapter,
  type TutorialDoc,
} from '../lib/tutorial'

// ─────────────────────── Rendu Markdown ───────────────────────

/** Gras, code en ligne et italique. Le texte est découpé puis réassemblé en
 *  nœuds React — jamais injecté en HTML, donc rien à échapper. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-i${i++}`
    if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-bold text-fg">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded-md px-1.5 py-0.5 font-mono text-[0.85em] text-accent"
          style={{ background: 'var(--color-glass-mid)' }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else {
      out.push(
        <em key={key} className="italic text-fg2">
          {tok.slice(1, -1)}
        </em>,
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

const isSeparatorRow = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line)

/**
 * Convertit un bloc Markdown en nœuds React.
 * `heading3` permet au chapitre des annexes de rendre ses `###` autrement
 * (accordéons) sans dupliquer tout le moteur de rendu.
 */
function renderMarkdown(
  md: string,
  heading3?: (title: string, body: ReactNode, key: string) => ReactNode,
): ReactNode[] {
  const lines = md.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const key = () => `b${k++}`

  // Tampon des blocs qui suivent un `###`, quand l'appelant veut les grouper.
  let pendingTitle: string | null = null
  let pending: ReactNode[] = []
  const flushPending = () => {
    if (pendingTitle !== null && heading3) {
      out.push(heading3(pendingTitle, pending, key()))
    }
    pendingTitle = null
    pending = []
  }
  const push = (node: ReactNode) => {
    if (pendingTitle !== null && heading3) pending.push(node)
    else out.push(node)
  }

  while (i < lines.length) {
    const line = lines[i]

    // Ligne vide
    if (!line.trim()) {
      i++
      continue
    }

    // Bloc de code
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i++
      }
      i++ // ferme la clôture
      push(
        <pre
          key={key()}
          className="my-4 overflow-x-auto rounded-2xl p-4 text-[12px] leading-relaxed text-fg2"
          style={{
            background: 'var(--color-glass-mid)',
            border: '1px solid var(--color-border)',
          }}
        >
          <code className="font-mono whitespace-pre">{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Tableau
    if (line.trimStart().startsWith('|')) {
      const rows: string[][] = []
      let hasHeader = false
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        if (isSeparatorRow(lines[i])) {
          hasHeader = rows.length === 1
          i++
          continue
        }
        rows.push(splitRow(lines[i]))
        i++
      }
      const head = hasHeader ? rows[0] : null
      const bodyRows = hasHeader ? rows.slice(1) : rows
      push(
        <div key={key()} className="my-4 -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-full border-collapse text-[13px]">
            {head && (
              <thead>
                <tr>
                  {head.map((c, ci) => (
                    <th
                      key={ci}
                      className="label-up whitespace-nowrap px-3 py-2 text-left text-[10px] text-fg2"
                      style={{ borderBottom: '1px solid var(--color-divider)' }}
                    >
                      {inline(c, `th${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-2 align-top text-fg2"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    >
                      {inline(c, `td${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Citation — l'encadré « à retenir » du document
    if (line.trimStart().startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      push(
        <blockquote
          key={key()}
          className="my-4 rounded-2xl px-4 py-3 text-[14px] leading-relaxed text-fg2"
          style={{
            background: 'var(--color-glass-mid)',
            borderLeft: '3px solid rgb(var(--color-accent))',
          }}
        >
          {body
            .join('\n')
            .split(/\n{2,}/)
            .map((p, pi) => (
              <p key={pi} className={pi > 0 ? 'mt-2' : undefined}>
                {inline(p.replace(/\n/g, ' '), `q${pi}`)}
              </p>
            ))}
        </blockquote>,
      )
      continue
    }

    // Liste à puces
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      push(
        <ul key={key()} className="my-3 space-y-1.5 pl-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-2.5 text-[14px] leading-relaxed text-fg2">
              <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{inline(it, `li${ii}`)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Liste numérotée
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      push(
        <ol key={key()} className="my-3 space-y-1.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-2.5 text-[14px] leading-relaxed text-fg2">
              <span className="mt-px w-4 shrink-0 text-right font-mono text-[12px] font-bold text-accent">
                {ii + 1}
              </span>
              <span>{inline(it, `oli${ii}`)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // Filet
    if (/^\s*---+\s*$/.test(line)) {
      i++
      push(<div key={key()} className="my-7 h-px bg-fg/10" />)
      continue
    }

    // Titres
    const h = /^(#{3,4})\s+(.*)$/.exec(line)
    if (h) {
      i++
      const title = h[2].trim()
      if (h[1].length === 3) {
        if (heading3) {
          flushPending()
          pendingTitle = title
          continue
        }
        out.push(
          <h3
            key={key()}
            className="mb-2 mt-8 text-[17px] font-extrabold tracking-tighter text-fg"
          >
            {inline(title, 'h3')}
          </h3>,
        )
      } else {
        push(
          <h4
            key={key()}
            className="label-up mb-1.5 mt-6 text-[11px] text-accent"
          >
            {inline(title, 'h4')}
          </h4>,
        )
      }
      continue
    }

    // Paragraphe — les lignes consécutives sont réunies
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([-*]\s|\d+\.\s|>|\||#{3,4}\s|---+\s*$|```)/.test(lines[i])
    ) {
      para.push(lines[i].trim())
      i++
    }
    if (para.length) {
      push(
        <p key={key()} className="my-3 text-[14px] leading-relaxed text-fg2">
          {inline(para.join(' '), 'p')}
        </p>,
      )
    } else {
      i++ // sécurité : ne jamais boucler sur une ligne non consommée
    }
  }

  flushPending()
  return out
}

// ─────────────────────── Accordéon d'annexe ───────────────────────

function Accordion({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="overflow-hidden rounded-3xl bg-card"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tappable flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-[14px] font-bold text-fg">
          {inline(title, 'acc')}
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-fg2 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div
          className="px-4 pb-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ─────────────────────── Navigation des chapitres ───────────────────────

function ChapterList({
  chapters,
  activeId,
  onPick,
}: {
  chapters: TutorialChapter[]
  activeId: string
  onPick: (id: string) => void
}) {
  return (
    <nav className="space-y-1">
      {chapters.map((c) => {
        const active = c.id === activeId
        return (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            aria-current={active ? 'page' : undefined}
            className="tappable flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors"
            style={{
              background: active ? 'var(--color-glass-mid)' : 'transparent',
              border: `1px solid ${active ? 'rgba(232,32,58,0.35)' : 'transparent'}`,
            }}
          >
            <span
              className={`mt-px w-5 shrink-0 text-right font-mono text-[12px] font-bold ${
                active ? 'text-accent' : 'text-fg2'
              }`}
            >
              {c.num}
            </span>
            <span className="min-w-0">
              <span
                className={`block truncate text-[13px] font-bold ${
                  active ? 'text-fg' : 'text-fg2'
                }`}
              >
                {c.title}
              </span>
              {c.blurb && (
                <span className="mt-0.5 block text-[11px] leading-snug text-fg/35">
                  {c.blurb}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ─────────────────────── Page ───────────────────────

export default function Tutorial() {
  const navigate = useNavigate()
  const [doc, setDoc] = useState<TutorialDoc | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string>('ch-0')
  const [sheet, setSheet] = useState(false)
  const [progress, setProgress] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetchTutorial()
      .then((d) => {
        if (!alive) return
        setDoc(d)
        setActiveId(d.chapters[0]?.id ?? 'ch-0')
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof TutorialDenied) setDenied(true)
        else setError(e instanceof Error ? e.message : 'Erreur inconnue.')
      })
    return () => {
      alive = false
    }
  }, [])

  // Progression de lecture — le conteneur de défilement est .stack-overlay
  // (voir src/index.css), pas la fenêtre : on l'écoute donc lui.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.stack-overlay') as HTMLElement | null
    if (!scroller) return
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      setProgress(max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [doc, activeId])

  const goTo = useCallback((id: string) => {
    setActiveId(id)
    setSheet(false)
    const scroller = rootRef.current?.closest('.stack-overlay') as HTMLElement | null
    scroller?.scrollTo({ top: 0 })
  }, [])

  const chapters = doc?.chapters ?? []
  const index = chapters.findIndex((c) => c.id === activeId)
  const current = index >= 0 ? chapters[index] : chapters[0]

  const body = useMemo(() => {
    if (!current) return null
    // Les annexes sont longues et consultées ponctuellement : leurs sections
    // de niveau 3 deviennent des accordéons plutôt qu'un mur de tableaux.
    const asAccordions = /ANNEXES/i.test(current.title)
    return renderMarkdown(
      current.markdown,
      asAccordions
        ? (title, content, k) => (
            <div key={k} className="mt-3">
              <Accordion title={title}>{content}</Accordion>
            </div>
          )
        : undefined,
    )
  }, [current])

  // ── États de sortie ──

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center">
        <h1 className="display-xl text-fg">Introuvable</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg2">
          Cette page n'existe pas, ou ta session a expiré.
        </p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="tappable mt-7 rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
        >
          Retour à l'accueil
        </button>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center">
        <p className="text-sm text-fg2">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="tappable mt-6 rounded-full px-6 py-3 text-sm font-bold text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Retour
        </button>
      </div>
    )
  }

  if (!doc || !current) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-14">
        <div className="mx-auto max-w-md animate-pulse space-y-4">
          <div className="h-7 w-2/3 rounded-lg bg-fg/10" />
          <div className="h-4 w-1/2 rounded bg-fg/10" />
          <div className="mt-6 h-32 w-full rounded-2xl bg-fg/10" />
        </div>
      </div>
    )
  }

  const prev = index > 0 ? chapters[index - 1] : null
  const next = index < chapters.length - 1 ? chapters[index + 1] : null

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-bg px-4 pt-[calc(max(1rem,env(safe-area-inset-top))+15px)] text-fg lg:px-8"
    >
      {/* Barre de progression de lecture du chapitre courant. */}
      <div
        className="fixed inset-x-0 top-0 z-40 h-[2px] origin-left bg-accent"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />

      {/* ── En-tête ── */}
      <header className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3 py-4">
          <button
            onClick={() => navigate(-1)}
            aria-label="Retour"
            className="tappable -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0">
            <h1 className="display-xl truncate text-fg">Master Tutorial</h1>
          </div>
        </div>

        <div
          className="mb-6 rounded-3xl px-4 py-3.5"
          style={{
            background: 'var(--color-glass-mid)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
            <span className="label-up text-accent">Version {doc.version}</span>
            <span className="text-fg2">
              Architecture&nbsp;
              <code className="font-mono text-fg">{doc.referenceCommit}</code>
              &nbsp;· {doc.referenceDate}
            </span>
            <span className="text-fg/35">Vérifié le {doc.lastVerified}</span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-fg/35">
            Document interne. Réservé au compte administrateur pour cette V1.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* ── Sommaire (desktop) ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6 pr-1">
            <h2 className="label-up mb-3 px-3 text-[10px] text-fg2">Sommaire</h2>
            <ChapterList chapters={chapters} activeId={activeId} onPick={goTo} />
          </div>
        </aside>

        {/* ── Chapitre ── */}
        <main className="min-w-0 pb-4">
          {/* Barre de navigation compacte — mobile uniquement. */}
          <button
            onClick={() => setSheet(true)}
            className="tappable mb-5 flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 lg:hidden"
            style={{
              background: 'var(--color-glass-mid)',
              border: '1px solid var(--color-border)',
            }}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="font-mono text-[12px] font-bold text-accent">
                {current.num}
              </span>
              <span className="truncate text-[13px] font-bold text-fg">
                {current.title}
              </span>
            </span>
            <List className="h-4 w-4 shrink-0 text-fg2" />
          </button>

          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[28px] font-extrabold leading-none text-accent">
              {current.num}
            </span>
            <h2 className="text-[24px] font-extrabold leading-tight tracking-tighter text-fg">
              {current.title}
            </h2>
          </div>
          {current.blurb && (
            <p className="mt-2 text-[13px] leading-relaxed text-fg/45">
              {current.blurb}
            </p>
          )}
          <div className="my-5 h-px bg-fg/10" />

          <article>{body}</article>

          {/* ── Chapitre précédent / suivant ── */}
          <div className="mt-10 flex gap-3">
            {prev ? (
              <button
                onClick={() => goTo(prev.id)}
                className="tappable flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-4 py-3 text-left"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <ChevronLeft className="h-4 w-4 shrink-0 text-fg2" />
                <span className="min-w-0">
                  <span className="label-up block text-[9px] text-fg/35">
                    Précédent
                  </span>
                  <span className="block truncate text-[13px] font-bold text-fg2">
                    {prev.title}
                  </span>
                </span>
              </button>
            ) : (
              <span className="flex-1" />
            )}
            {next ? (
              <button
                onClick={() => goTo(next.id)}
                className="tappable flex min-w-0 flex-1 items-center justify-end gap-2.5 rounded-2xl px-4 py-3 text-right"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="min-w-0">
                  <span className="label-up block text-[9px] text-fg/35">
                    Suivant
                  </span>
                  <span className="block truncate text-[13px] font-bold text-fg2">
                    {next.title}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-fg2" />
              </button>
            ) : (
              <span className="flex-1" />
            )}
          </div>
        </main>
      </div>

      {/* ── Sommaire (mobile, feuille plein écran) ──
          Rendu dans <body> par portail : la barre de navigation basse est en
          z-index 40 à la racine, alors que cette page vit dans .stack-overlay
          (z-index 30), qui forme son propre contexte d'empilement. Sans le
          portail, aucune valeur de z-index locale ne peut passer devant la
          barre — la feuille apparaîtrait sous elle. */}
      {sheet &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex flex-col bg-bg lg:hidden">
            <div className="flex items-center justify-between px-4 pb-3 pt-[calc(max(1rem,env(safe-area-inset-top))+15px)]">
              <h2 className="display-xl text-fg">Sommaire</h2>
              <button
                onClick={() => setSheet(false)}
                aria-label="Fermer"
                className="tappable -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-fg2"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
              <ChapterList chapters={chapters} activeId={activeId} onPick={goTo} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
