import os
import json
import numpy as np
from fea_engine import FEAEngine

def generate_verification_folder():
    base_dir = "/Users/uribarri/Documents/GitHub/pipe_analysis/verification_results"
    os.makedirs(base_dir, exist_ok=True)
    
    print(f"Generating verification results in: {base_dir}\n")
    
    # -------------------------------------------------------------
    # CASE 1: Cantilever Beam Point Load
    # -------------------------------------------------------------
    case1_dir = os.path.join(base_dir, "case1_cantilever")
    os.makedirs(case1_dir, exist_ok=True)
    print("Running Case 1: Cantilever Point Load...")
    
    c1_input = {
        "materials": {
            "mat1": { "E": 2.0e11, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": 0.1143, "wall_thickness": 0.00602, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [2.0, 0.0, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "nodes": {
                "1": { "Fx": 0.0, "Fy": -5000.0, "Fz": 0.0, "Mx": 0.0, "My": 0.0, "Mz": 0.0 }
            },
            "global_internal_pressure": 0.0,
            "global_temperature_change": 0.0
        }
    }
    run_and_save_case(c1_input, case1_dir)
    
    # -------------------------------------------------------------
    # CASE 2: Constrained Thermal Expansion
    # -------------------------------------------------------------
    case2_dir = os.path.join(base_dir, "case2_thermal_expansion")
    os.makedirs(case2_dir, exist_ok=True)
    print("Running Case 2: Constrained Thermal Expansion...")
    
    c2_input = {
        "materials": {
            "mat1": { "E": 2.0e11, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": 0.1143, "wall_thickness": 0.00602, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [2.0, 0.0, 0.0]
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
            "global_temperature_change": 100.0
        }
    }
    run_and_save_case(c2_input, case2_dir)

    # -------------------------------------------------------------
    # CASE 3: Bend Flexibility factor and SIF
    # -------------------------------------------------------------
    case3_dir = os.path.join(base_dir, "case3_bend_flexibility")
    os.makedirs(case3_dir, exist_ok=True)
    print("Running Case 3: Bend SIF and Flexibility...")
    
    c3_input = {
        "materials": {
            "mat1": { "E": 2.0e11, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": 0.1143, "wall_thickness": 0.00602, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [1.0, 0.0, 0.0]
        },
        "elements": [
            { "id": 0, "node_A": 0, "node_B": 1, "type": "bend", "bend_radius": 0.17145, "material": "mat1", "section": "sec1" }
        ],
        "boundary_conditions": {
            "0": { "tx": True, "ty": True, "tz": True, "rx": True, "ry": True, "rz": True }
        },
        "loads": {
            "global_internal_pressure": 0.0,
            "global_temperature_change": 0.0
        }
    }
    run_and_save_case(c3_input, case3_dir)

    # -------------------------------------------------------------
    # CASE 4: L-bend reactions
    # -------------------------------------------------------------
    case4_dir = os.path.join(base_dir, "case4_lbend_reactions")
    os.makedirs(case4_dir, exist_ok=True)
    print("Running Case 4: L-Bend Thermal Reactions...")
    
    c4_input = {
        "materials": {
            "mat1": { "E": 2.0e11, "G": 7.7e10, "alpha": 1.2e-5, "yield_strength": 2.5e8, "Sc": 1.379e8, "Sh": 1.379e8, "density": 0.0 }
        },
        "sections": {
            "sec1": { "OD": 0.1143, "wall_thickness": 0.00602, "type": "pipe" }
        },
        "nodes": {
            "0": [0.0, 0.0, 0.0],
            "1": [5.0, 0.0, 0.0],
            "2": [5.0, 4.0, 0.0]
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
            "global_temperature_change": 150.0
        }
    }
    run_and_save_case(c4_input, case4_dir)
    
    print(f"\nVerification folders successfully generated under: {base_dir}")

def run_and_save_case(input_data: dict, target_dir: str):
    from report_generator import generate_html_report, generate_pdf_report
    
    # 1. Save input file
    input_path = os.path.join(target_dir, "input_model.json")
    with open(input_path, 'w') as f:
        json.dump(input_data, f, indent=4)
        
    # 2. Run solver
    engine = FEAEngine(input_data)
    engine.solve()
    summary = engine.get_summary()
    
    # 3. Save JSON output summary
    json_path = os.path.join(target_dir, "results_summary.json")
    with open(json_path, 'w') as f:
        json.dump(summary, f, indent=4)
        
    # 4. Save HTML Report
    html_path = os.path.join(target_dir, "stress_report.html")
    generate_html_report(summary, html_path)
    
    # 5. Save PDF Report
    pdf_path = os.path.join(target_dir, "stress_report.pdf")
    generate_pdf_report(summary, pdf_path)
    
    # 6. Save Heatmap PNG
    png_path = os.path.join(target_dir, "deformation_heatmap.png")
    engine.visualize(scale_factor=50.0, show=False, save_path=png_path)

if __name__ == "__main__":
    generate_verification_folder()
