import { useEffect, useState } from 'react'
import {
  Camera,
  Car,
  MapPin,
  Tag,
  Users,
  RefreshCcw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton } from './Skeleton'

type Stats = {
  total_spots: number
  top_car: string | null
  top_car_count: number
  top_city: string | null
  top_city_count: number
  top_brand: string | null
  top_brand_count: number
  weekly_active_spotters: number
  refreshed_at: string | null
}

function timeAgoLite(iso: string | null): string {
  if (!iso) return ''
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  return `il y a ${d} j`
}

export default function GlobalStats() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let active = true
    supabase
      .rpc('global_stats')
      .maybeSingle()
      .then(({ data }) => {
        if (active) setStats((data as Stats) ?? null)
      })
    return () => {
      active = false
    }
  }, [])

  if (stats === null) {
    return (
      <div className="space-y-3 px-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    )
  }

  const fmt = new Intl.NumberFormat('fr-FR').format

  return (
    <div className="space-y-4 px-4 pb-12">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-fg/40">
          REVS en chiffres
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold text-fg">
          La communauté en temps réel
        </h2>
      </div>

      {/* Hero — total spots */}
      <div className="overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/15 to-card p-6 text-center">
        <div className="flex items-center justify-center gap-2 text-fg/60">
          <Camera className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">Spots totaux</span>
        </div>
        <p className="mt-2 font-display text-5xl font-extrabold text-accent">
          {fmt(stats.total_spots)}
        </p>
        <p className="mt-1 text-xs text-fg/40">
          {fmt(stats.weekly_active_spotters)} spotteurs actifs cette semaine
        </p>
      </div>

      {/* Top voiture */}
      <div className="rounded-2xl border border-fg/5 bg-card p-5">
        <div className="flex items-center gap-2 text-fg/50">
          <Car className="h-4 w-4 text-accent" />
          <span className="text-xs uppercase tracking-wider">
            Voiture la plus spottée
          </span>
        </div>
        <p className="mt-2 font-display text-2xl font-bold text-fg">
          {stats.top_car || '—'}
        </p>
        {stats.top_car && (
          <p className="mt-0.5 text-xs text-fg/40">
            {fmt(stats.top_car_count)} apparitions
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Top ville */}
        <div className="rounded-2xl border border-fg/5 bg-card p-4">
          <div className="flex items-center gap-2 text-fg/50">
            <MapPin className="h-4 w-4 text-accent" />
            <span className="text-xs uppercase tracking-wider">Ville n°1</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-fg">
            {stats.top_city || '—'}
          </p>
          {stats.top_city && (
            <p className="mt-0.5 text-xs text-fg/40">
              {fmt(stats.top_city_count)} spots
            </p>
          )}
        </div>

        {/* Top marque */}
        <div className="rounded-2xl border border-fg/5 bg-card p-4">
          <div className="flex items-center gap-2 text-fg/50">
            <Tag className="h-4 w-4 text-accent" />
            <span className="text-xs uppercase tracking-wider">
              Marque n°1
            </span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-fg">
            {stats.top_brand || '—'}
          </p>
          {stats.top_brand && (
            <p className="mt-0.5 text-xs text-fg/40">
              {fmt(stats.top_brand_count)} spots
            </p>
          )}
        </div>
      </div>

      {/* Spotteurs actifs */}
      <div className="rounded-2xl border border-fg/5 bg-card p-4">
        <div className="flex items-center gap-2 text-fg/50">
          <Users className="h-4 w-4 text-accent" />
          <span className="text-xs uppercase tracking-wider">
            Spotteurs actifs (7 jours)
          </span>
        </div>
        <p className="mt-1 font-display text-3xl font-bold text-fg">
          {fmt(stats.weekly_active_spotters)}
        </p>
      </div>

      <p className="flex items-center justify-center gap-1 pt-2 text-[11px] text-fg/30">
        <RefreshCcw className="h-3 w-3" />
        Mis à jour {timeAgoLite(stats.refreshed_at)}
      </p>
    </div>
  )
}
