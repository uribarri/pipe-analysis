import numpy as np
from fea_engine import FEAEngine

def test_cantilever_beam():
    # Define simple cantilever beam:
    # Length L = 2.0 m
    # Fixed at node 0, load Fy = -5000 N at node 1
    
    L = 2.0
    P = -5000.0
    
    E = 2.0e11
    OD = 0.1143
    t = 0.00602
    
    input_data = {
        "materials": {
            "mat1": { "E": E, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": OD, "wall_thickness": t, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [L, 0.0, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "nodes": {
                "1": { "Fx": 0.0, "Fy": P, "Fz": 0.0, "Mx": 0.0, "My": 0.0, "Mz": 0.0 }
            },
            "global_internal_pressure": 0.0,
            "global_temperature_change": 0.0
        }
    }
    
    engine = FEAEngine(input_data)
    engine.solve()
    
    res = engine.get_summary()
    
    # Calculate analytical solutions
    ro = OD / 2.0
    ri = ro - t
    I = (np.pi / 4.0) * (ro**4 - ri**4)
    
    analytical_deflection = (P * L**3) / (3.0 * E * I)
    analytical_max_stress = (abs(P) * L * ro) / I
    
    computed_deflection = res['nodes']['1']['Weight'][1]  # ty at node 1 (Weight case)
    computed_stress = res['elements'][0]['sustained_stress']
    
    print(f"Analytical Deflection: {analytical_deflection:.6e}")
    print(f"Computed Deflection:   {computed_deflection:.6e}")
    print(f"Analytical Max Stress: {analytical_max_stress:.6e}")
    print(f"Computed Max Stress:   {computed_stress:.6e}")
    
    assert np.isclose(analytical_deflection, computed_deflection, rtol=1e-3), "Deflection mismatch"
    assert np.isclose(analytical_max_stress, computed_stress, rtol=1e-3), "Stress mismatch"
    
    print("Cantilever test passed!")

def test_thermal_expansion():
    # Test constrained thermal expansion:
    # A straight pipe of length L = 2.0 m, fixed at both ends (fixed-fixed).
    # Subject to temperature change dT = 100.0 C.
    # Analytical compressive axial force: F = E * A * alpha * dT
    
    L = 2.0
    dT = 100.0
    E = 2.0e11
    alpha = 1.2e-5
    OD = 0.1143
    t = 0.00602
    
    input_data = {
        "materials": {
            "mat1": { "E": E, "G": 7.7e10, "alpha": alpha, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8 }
        },
        "sections": {
            "sec1": { "OD": OD, "wall_thickness": t, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [L, 0.0, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True },
            "1": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "global_internal_pressure": 0.0,
            "global_temperature_change": dT
        }
    }
    
    engine = FEAEngine(input_data)
    engine.solve()
    
    # Calculate cross-sectional area
    ro = OD / 2.0
    ri = ro - t
    A = np.pi * (ro**2 - ri**2)
    
    analytical_force = -E * A * alpha * dT  # Negative due to compression
    
    # Access local force from the Thermal case
    computed_force = engine.results['f_local_T'][0][6] # Axial force (Fx) at Node B of element 0
    
    print(f"Analytical Thermal Force: {analytical_force:.6e}")
    print(f"Computed Thermal Force:   {computed_force:.6e}")
    
    assert np.isclose(analytical_force, computed_force, rtol=1e-3), "Thermal force mismatch"
    print("Thermal expansion test passed!")

def test_bend_flexibility():
    # Test elbow/bend properties:
    # A simple pipe bend of radius R = 0.5 m, outer diameter 0.1143 m, wall thickness 0.00602 m.
    # Checks that SIF and flexibility factors are computed and greater than 1.0.
    
    E = 2.0e11
    OD = 0.1143
    t = 0.00602
    R = 0.17145
    
    input_data = {
        "materials": {
            "mat1": { "E": E, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8 }
        },
        "sections": {
            "sec1": { "OD": OD, "wall_thickness": t, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [1.0, 0.0, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "type": "bend", "bend_radius": R, "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "global_internal_pressure": 0.0,
            "global_temperature_change": 0.0
        }
    }
    
    engine = FEAEngine(input_data)
    
    elem = engine.elements[0]
    k_factor = elem['k_factor']
    i_i = elem['i_i']
    i_o = elem['i_o']
    
    print(f"Bend Flexibility factor k: {k_factor:.4f}")
    print(f"Bend In-plane SIF i_i:      {i_i:.4f}")
    print(f"Bend Out-of-plane SIF i_o:  {i_o:.4f}")
    
    assert k_factor > 1.0, "Flexibility factor should be greater than 1.0 for bends"
    assert i_i > 1.0, "In-plane SIF should be greater than 1.0 for bends"
    assert i_o > 1.0, "Out-of-plane SIF should be greater than 1.0 for bends"
    print("Bend flexibility test passed!")

def test_lbend_thermal_reactions():
    # Geometry and design inputs
    L1 = 5.0  # Horizontal leg length (m)
    L2 = 4.0  # Vertical leg length (m)
    dT = 150.0  # Temp change (C)
    E = 2.0e11  # Modulus of elasticity (Pa)
    G = 7.7e10
    alpha = 1.2e-5  # Expansion coefficient (1/C)
    OD = 0.1143  # Outer diameter (m)
    t = 0.00602  # Wall thickness (m)
    
    # Calculate section properties
    ro = OD / 2.0
    ri = ro - t
    A = np.pi * (ro**2 - ri**2)
    I = (np.pi / 4.0) * (ro**4 - ri**4)
    
    # Bending + axial terms flexibility coefficients
    f_mm = L1 + L2
    f_xm = -L2 * (L1 + L2 / 2.0)
    f_ym = L1**2 / 2.0
    f_xy = -L1**2 * L2 / 2.0
    f_xx = (L2**3 / 3.0 + L1 * L2**2) + (I / A) * L1
    f_yy = (L1**3 / 3.0) + (I / A) * L2
    
    f_matrix = np.array([
        [f_xx, f_xy, f_xm],
        [f_xy, f_yy, f_ym],
        [f_xm, f_ym, f_mm]
    ])
    
    d_vector = np.array([
        -E * I * alpha * L1 * dT,
        -E * I * alpha * L2 * dT,
        0.0
    ])
    
    F_analytical = np.linalg.solve(f_matrix, d_vector)
    
    input_data = {
        "materials": {
            "mat1": { "E": E, "G": G, "alpha": alpha, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": OD, "wall_thickness": t, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [L1, 0.0, 0.0],
            "2": [L1, L2, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "type": "pipe", "material": "mat1", "section": "sec1" },
            { "id": 1, "node_A": 1, "node_B": 2, "type": "pipe", "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True },
            "2": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "global_internal_pressure": 0.0,
            "global_temperature_change": dT
        }
    }
    
    engine = FEAEngine(input_data)
    engine.solve()
    
    # Extract reaction forces at Node 2 via penalty method reactions
    penalty = 1e15
    u_node2 = engine.results['displacements_T'][12:18]
    Fx_fea = u_node2[0] * penalty
    Fy_fea = u_node2[1] * penalty
    Mz_fea = u_node2[5] * penalty
    
    diff_Fx = abs((abs(Fx_fea) - abs(F_analytical[0])) / F_analytical[0]) * 100
    diff_Fy = abs((abs(Fy_fea) - abs(F_analytical[1])) / F_analytical[1]) * 100
    diff_Mz = abs((abs(Mz_fea) - abs(F_analytical[2])) / F_analytical[2]) * 100
    
    print(f"L-bend Fx error: {diff_Fx:.4f}% | Fy error: {diff_Fy:.4f}% | Mz error: {diff_Mz:.4f}%")
    
    assert diff_Fx < 0.1, "Fx verification failed"
    assert diff_Fy < 0.1, "Fy verification failed"
    assert diff_Mz < 0.1, "Mz verification failed"
    print("L-bend thermal reactions test passed!")

if __name__ == "__main__":
    test_cantilever_beam()
    test_thermal_expansion()
    test_bend_flexibility()
    test_lbend_thermal_reactions()
    print("All verification tests passed successfully!")
