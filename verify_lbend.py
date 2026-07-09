import numpy as np
from fea_engine import FEAEngine

def run_lbend_verification():
    print("--- 2D L-BEND THERMAL EXPANSION VERIFICATION ---")
    
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
    
    # 1. ANALYTICAL SOLUTION USING FLEXIBILITY MATRIX
    # Free thermal expansion at Node 2 if released
    dx_th = alpha * L1 * dT
    dy_th = alpha * L2 * dT
    
    # Build compatibility equations: f * F = d
    # Flexibility coefficients including bending and axial elasticity
    f_mm = L1 + L2
    f_xm = -L2 * (L1 + L2 / 2.0)
    f_ym = L1**2 / 2.0
    f_xy = -L1**2 * L2 / 2.0
    
    # Diagonal flexibility terms (bending + axial terms I/A)
    f_xx = (L2**3 / 3.0 + L1 * L2**2) + (I / A) * L1
    f_yy = (L1**3 / 3.0) + (I / A) * L2
    
    f_matrix = np.array([
        [f_xx, f_xy, f_xm],
        [f_xy, f_yy, f_ym],
        [f_xm, f_ym, f_mm]
    ])
    
    d_vector = np.array([
        -E * I * dx_th,
        -E * I * dy_th,
        0.0
    ])
    
    # Solve for Fx, Fy, Mz at Node 2
    F_analytical = np.linalg.solve(f_matrix, d_vector)
    
    print("\nAnalytical Results at Anchor Node 2 (Castigliano + Axial):")
    print(f"Fx: {F_analytical[0]:.4e} N")
    print(f"Fy: {F_analytical[1]:.4e} N")
    print(f"Mz: {F_analytical[2]:.4e} N-m")
    
    # 2. RUN FEA SOLVER
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
    
    # Extract reaction forces at Node 2 from the stiffness equation: R = K*u - F_th
    # For Node 2 (index 2), DOFs are 12 to 17
    # Note: K_global is lil_matrix, convert to csr to do matrix-vector product
    K_csr = engine.global_K.tocsr()
    u_T = engine.results['displacements_T']
    
    # The solver uses equivalent forces, so the external force vector was created inside _solve_case.
    # To get reaction forces, we can compute K_csr @ u_T - F_case.
    # Let's rebuild the force vector F_case for Thermal:
    # (Since there are no boundary condition penalties applied to the equivalent load vector,
    # K_csr @ u_T gives the total structural internal forces, and at the anchored node,
    # the reaction is exactly the force computed here).
    # Since boundary condition penalty 1e15 is added to diagonal, we must calculate the reaction
    # as the penalty stiffness times the displacement: R_i = K_bc * u_i
    # Wait, penalty * displacement is exactly the reaction force in the penalty method!
    penalty = 1e15
    u_node2 = u_T[12:18]
    Fx_fea = u_node2[0] * penalty
    Fy_fea = u_node2[1] * penalty
    Mz_fea = u_node2[5] * penalty
    
    print("\nFEA Engine Results at Anchor Node 2:")
    print(f"Fx: {Fx_fea:.4e} N")
    print(f"Fy: {Fy_fea:.4e} N")
    print(f"Mz: {Mz_fea:.4e} N-m")
    
    # Compare magnitudes
    diff_Fx = abs((abs(Fx_fea) - abs(F_analytical[0])) / F_analytical[0]) * 100
    diff_Fy = abs((abs(Fy_fea) - abs(F_analytical[1])) / F_analytical[1]) * 100
    diff_Mz = abs((abs(Mz_fea) - abs(F_analytical[2])) / F_analytical[2]) * 100
    
    print(f"\nDiscrepancy Metrics:")
    print(f"Fx Difference: {diff_Fx:.4f}%")
    print(f"Fy Difference: {diff_Fy:.4f}%")
    print(f"Mz Difference: {diff_Mz:.4f}%")
    
    # Assert they are close (well within 0.1%)
    assert diff_Fx < 0.1, "Fx verification failed"
    assert diff_Fy < 0.1, "Fy verification failed"
    assert diff_Mz < 0.1, "Mz verification failed"
    
    print("\nL-bend verification successful! FEA matches exact analytical solution.")

if __name__ == "__main__":
    run_lbend_verification()
