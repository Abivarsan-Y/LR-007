import analysis from '../../../data/fixtures/mock_analysis.json'
import setup from './fixtures/dashboard.json'
import type { DashboardPreview } from './types'

const preview: DashboardPreview = {
  ...setup,
  source: 'synthetic',
  metrics: {
    sunlightPercent: analysis.metrics.sunlight_fraction * 100,
    maxDarknessHours: analysis.metrics.max_darkness_hours,
    dtePercent: analysis.metrics.earth_visible_fraction * 100,
  },
}

// Keep fixture access behind this asynchronous boundary for the Phase 4 API handoff.
export const api = {
  async getDashboardPreview(): Promise<DashboardPreview> {
    return structuredClone(preview)
  },
}
