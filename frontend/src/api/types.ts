// View models for the dashboard and its mission controls.
export interface Site {
  id: string
  name: string
}

export interface MissionSetup {
  siteId: string
  startDateUtc: string
  observerHeightM: number
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
