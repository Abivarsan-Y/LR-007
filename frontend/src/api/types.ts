// View models for the dashboard and its mission controls.
export interface Site {
  id: string
  name: string
}

export interface MissionSetup {
  siteId: string
  startDateUtc: string
  observerHeightM: number
  durationDays: number
  delayHours: 0 | 24 | 48
}

export interface DashboardPreview {
  source: 'synthetic'
  sites: Site[]
  defaults: MissionSetup
  metrics: {
    sunlightPercent: number
    maxDarknessHours: number
    dtePercent: number
  }
}
