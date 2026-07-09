import numpy as np
from typing import Dict, Any, Tuple

def calculate_bend_sif_and_k(OD: float, t: float, R: float) -> Tuple[float, float, float]:
    """
    Calculates the flexibility factor k, in-plane SIF (i_i), and out-of-plane SIF (i_o)
    for a curved pipe elbow/bend per ASME B31.3 Appendix D.
    
    Parameters:
    - OD: Outer diameter of the pipe (m)
    - t: Nominal wall thickness (m)
    - R: Bend radius (m)
    
    Returns:
    - k: Flexibility factor (>= 1.0)
    - i_i: In-plane stress intensification factor (>= 1.0)
    - i_o: Out-of-plane stress intensification factor (>= 1.0)
    """
    r_m = (OD - t) / 2.0
    if r_m <= 0 or R <= 0 or t <= 0:
        return 1.0, 1.0, 1.0
        
    h = (t * R) / (r_m ** 2)
    
    # Flexibility factor k
    k = 1.65 / h
    if k < 1.0:
        k = 1.0
        
    # In-plane SIF
    i_i = 0.9 / (h ** (2.0/3.0))
    if i_i < 1.0:
        i_i = 1.0
        
    # Out-of-plane SIF
    i_o = 0.75 / (h ** (2.0/3.0))
    if i_o < 1.0:
        i_o = 1.0
        
    return k, i_i, i_o

def calculate_tee_sif(OD: float, t: float, tee_type: str = "welding_tee") -> Tuple[float, float]:
    """
    Calculates the SIF for a tee (branch connection) per ASME B31.3 Appendix D.
    
    Parameters:
    - OD: Outer diameter of the run pipe (m)
    - t: Nominal wall thickness of the run pipe (m)
    - tee_type: Type of tee (default: "welding_tee")
    
    Returns:
    - i_i: In-plane SIF (>= 1.0)
    - i_o: Out-of-plane SIF (>= 1.0)
    """
    r_m = (OD - t) / 2.0
    if r_m <= 0 or t <= 0:
        return 1.0, 1.0
        
    if tee_type == "welding_tee":
        h = 4.4 * t / OD
    elif tee_type == "reinforced_tee":
        # Assume some typical reinforcement for reinforced tee
        h = 8.0 * t / OD
    else:
        # Unreinforced branch connection
        h = t / r_m
        
    i_i = 0.9 / (h ** (2.0/3.0))
    if i_i < 1.0:
        i_i = 1.0
        
    i_o = 0.9 / (h ** (2.0/3.0))
    # For some branch connections, out-of-plane SIF is higher, e.g. i_o = 0.9/h^(2/3) + 1.0 (sometimes capped)
    # We will use 0.9 / h^(2/3) for in-plane and out-of-plane as a baseline, matching standard Appendix D
    if i_o < 1.0:
        i_o = 1.0
        
    return i_i, i_o
