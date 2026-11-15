import { useEffect, useRef, useState } from 'react'
import type { AnalysisSample, ContractHorizonPoint } from '../../api/types'

interface Props {
  horizon: ContractHorizonPoint[]
  currentSample: AnalysisSample | null
  highlightAzimuthDeg?: number | null
  onHoverChange?: (hoverText: string | null) => void
}

export function HorizonProfileCanvas({
  horizon,
  currentSample,
  highlightAzimuthDeg = null,
  onHoverChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.parentElement) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      ctx.clearRect(0, 0, w, h)

      const padLeft = 26
      const padRight = 10
      const padTop = 10
      const padBottom = 16
      const plotW = w - padLeft - padRight
      const plotH = h - padTop - padBottom

      const minEl = -6
      const maxEl = 20
      const elToY = (el: number) => {
        const clamped = Math.max(0, Math.min(1, (el - minEl) / (maxEl - minEl)))
        return padTop + plotH * (1 - clamped)
      }
      const azToX = (az: number) => padLeft + (((az % 360) + 360) % 360 / 360) * plotW

      // 0 deg & 15 deg horizontal dashed reference lines
      const yZero = elToY(0)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padLeft, yZero)
      ctx.lineTo(w - padRight, yZero)
      ctx.stroke()

      const y15 = elToY(12)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.beginPath()
      ctx.moveTo(padLeft, y15)
      ctx.lineTo(w - padRight, y15)
      ctx.stroke()
      ctx.setLineDash([])

      // Y-axis ticks
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)'
      ctx.font = '9px "Geist", "Segoe UI", sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText('0°', padLeft - 4, yZero + 3)
      ctx.fillText('12°', padLeft - 4, y15 + 3)

      // X-axis cardinal ticks
      ctx.textAlign = 'center'
      ;[
        { az: 0, x: padLeft, label: '0°N' },
        { az: 90, x: padLeft + plotW * 0.25, label: '90°E' },
        { az: 180, x: padLeft + plotW * 0.5, label: '180°' },
        { az: 270, x: padLeft + plotW * 0.75, label: '270°W' },
        { az: 360, x: padLeft + plotW, label: '360°' },
      ].forEach(t => {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)'
        ctx.fillText(t.label, t.x, h - 3)
      })

      if (horizon.length > 0) {
        // Fill under valid skyline segments
        ctx.beginPath()
        ctx.moveTo(padLeft, padTop + plotH)
        for (let i = 0; i <= horizon.length; i++) {
          const pt = horizon[i % horizon.length]
          const az = i === horizon.length ? 360 : pt.azimuth_deg
          const x = i === horizon.length ? padLeft + plotW : azToX(az)
          const el = pt.elevation_deg ?? minEl
          ctx.lineTo(x, elToY(el))
        }
        ctx.lineTo(padLeft + plotW, padTop + plotH)
        ctx.closePath()

        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH)
        grad.addColorStop(0, 'rgba(226, 232, 240, 0.22)')
        grad.addColorStop(1, 'rgba(15, 23, 42, 0.35)')
        ctx.fillStyle = grad
        ctx.fill()

        // Horizon curve
        ctx.beginPath()
        let drawing = false
        for (let i = 0; i <= horizon.length; i++) {
          const pt = horizon[i % horizon.length]
          if (pt.elevation_deg === null) {
            drawing = false
            continue
          }
          const x = i === horizon.length ? padLeft + plotW : azToX(pt.azimuth_deg)
          const y = elToY(pt.elevation_deg)
          if (!drawing) {
            ctx.moveTo(x, y)
            drawing = true
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.strokeStyle = 'rgba(241, 245, 249, 0.8)'
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      // Causal highlight azimuth line (from LunaDiff interval click)
      if (highlightAzimuthDeg !== null && Number.isFinite(highlightAzimuthDeg)) {
        const hx = azToX(highlightAzimuthDeg)
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.7)'
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(hx, padTop)
        ctx.lineTo(hx, padTop + plotH)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Live Sun & Earth Dots
      if (currentSample) {
        const sunAz = ((currentSample.sun.azimuth_deg % 360) + 360) % 360
        const sunX = azToX(sunAz)
        const sunY = elToY(currentSample.sun.elevation_deg)
        const sunLit = currentSample.sun.visible === true

        ctx.beginPath()
        ctx.arc(sunX, sunY, 5.2, 0, Math.PI * 2)
        ctx.fillStyle = sunLit ? 'rgba(251, 191, 36, 0.25)' : 'rgba(148, 163, 184, 0.16)'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(sunX, sunY, 2.6, 0, Math.PI * 2)
        ctx.fillStyle = sunLit ? '#fbbf24' : '#94a3b8'
        ctx.fill()

        const earthAz = ((currentSample.earth.azimuth_deg % 360) + 360) % 360
        const earthX = azToX(earthAz)
        const earthY = elToY(currentSample.earth.elevation_deg)
        const earthVis = currentSample.earth.visible === true
        const earthColor = earthVis ? '#34d399' : '#fb7185'

        ctx.strokeStyle = earthVis ? 'rgba(52, 211, 153, 0.26)' : 'rgba(251, 113, 133, 0.26)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(earthX, padTop)
        ctx.lineTo(earthX, padTop + plotH)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(earthX, earthY, 5.5, 0, Math.PI * 2)
        ctx.fillStyle = earthVis ? 'rgba(52, 211, 153, 0.24)' : 'rgba(251, 113, 133, 0.24)'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(earthX, earthY, 2.7, 0, Math.PI * 2)
        ctx.fillStyle = earthColor
        ctx.fill()
      }

      // Pointer Hover Crosshair
      if (hoverIdx !== null && horizon[hoverIdx]) {
        const pt = horizon[hoverIdx]
        const px = azToX(pt.azimuth_deg)
        const py = elToY(pt.elevation_deg ?? 0)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, padTop)
        ctx.lineTo(px, padTop + plotH)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(px, py, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas.parentElement)
    return () => observer.disconnect()
  }, [horizon, currentSample, hoverIdx, highlightAzimuthDeg])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block cursor-crosshair"
      onPointerMove={e => {
        if (!horizon.length) return
        const rect = e.currentTarget.getBoundingClientRect()
        const padLeft = 26
        const padRight = 10
        const plotW = Math.max(rect.width - padLeft - padRight, 1)
        const relX = Math.max(0, Math.min(plotW, e.clientX - rect.left - padLeft))
        const idx = Math.min(horizon.length - 1, Math.floor((relX / plotW) * horizon.length))
        setHoverIdx(idx)
        const pt = horizon[idx]
        if (pt && onHoverChange) {
          const azStr = String(Math.round(pt.azimuth_deg)).padStart(3, '0')
          const elStr =
            pt.elevation_deg === null
              ? 'UNKNOWN'
              : `${pt.elevation_deg >= 0 ? '+' : ''}${pt.elevation_deg.toFixed(1)}°`
          onHoverChange(`AZ ${azStr}° · RIM ${elStr}`)
        }
      }}
      onPointerLeave={() => {
        setHoverIdx(null)
        onHoverChange?.(null)
      }}
    />
  )
}
