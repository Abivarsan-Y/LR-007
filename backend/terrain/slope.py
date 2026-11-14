"""
Terrain Slope & Landing Touchdown Safety Engine.
Evaluates local slopes against CLPS / Artemis landing gear stability constraints.
"""

from typing import Dict, Any, Tuple
import numpy as np


def compute_slope_grid(heights_2d: np.ndarray, step_m: float) -> np.ndarray:
    """
    Compute 2D slope angle in degrees across a height grid using central differences.
    """
    # Gradient in y (rows) and x (cols)
    grad_y, grad_x = np.gradient(heights_2d, step_m, step_m)
    slope_rad = np.arctan(np.hypot(grad_x, grad_y))
    return np.degrees(slope_rad)


def classify_slope(slope_deg: float) -> Dict[str, Any]:
    """
    Classify landing site slope into touchdown safety categories.
    - Safe: < 8.0° (nominal landing gear stability envelope)
    - Caution: 8.0° to 15.0° (risk of slippage or high tilt)
    - Hazard: > 15.0° (severe tip-over hazard)
    """
    if slope_deg < 8.0:
        return {
            "slope_deg": round(float(slope_deg), 2),
            "status": "SAFE",
            "tip_over_risk": "LOW",
            "color": "#10b981", # Emerald green
            "recommendation": "Nominal touchdown conditions. Stable landing gear envelope."
        }
    elif slope_deg <= 15.0:
        return {
            "slope_deg": round(float(slope_deg), 2),
            "status": "CAUTION",
            "tip_over_risk": "MODERATE",
            "color": "#f59e0b", # Amber
            "recommendation": "Marginal slope. Landing gear requires leveling thrusters or tilt damping."
        }
    else:
        return {
            "slope_deg": round(float(slope_deg), 2),
            "status": "HAZARD",
            "tip_over_risk": "HIGH",
            "color": "#ef4444", # Red
            "recommendation": "Severe tip-over risk. Exceeds standard landing gear limits. Recommend diversion."
        }
