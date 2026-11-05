import type { Component } from 'vue'
import {
  Footprints, Route, Signpost, Map, MountainSnow, ChartSpline,
  Backpack, Grip, Mountain, Gauge, TreePine, ShieldCheck,
} from 'lucide-vue-next'

/** Icono de cada motor de rutas */
export const ENGINE_ICONS: Record<string, Component> = {
  tracks: Footprints, // por donde ya has pasado
  brouter: Route,
  ors: Signpost,
  graphhopper: Map,
  mapbox: Map,
}

/** Icono de cada fuente de altitud */
export const ELEVATION_ICONS: Record<string, Component> = {
  dem: MountainSnow,
  engine: ChartSpline,
}

/** Insignia de cada perfil de bici (va sobre el icono de la bici, ver ProfileIcon) */
export const PROFILE_BADGES: Record<string, Component> = {
  'trekking': Backpack, // cicloturismo: con alforjas
  'gravel': Grip, // gravilla
  'mtb': Mountain,
  'fastbike': Gauge, // carretera: velocidad
  'fastbike-verylowtraffic': TreePine, // carretera tranquila
  'safety': ShieldCheck,
}
