import os
import sys
import json
import numpy as np
import openpyxl

from excel_interface import generate_template, read_excel_inputs
from fea_engine import FEAEngine

def run_verification():
    print("=== STARTING EXCEL SOLVER INTEGRATION VERIFICATION ===")
    
    # 1. Generate excel template
    excel_path = "test_template.xlsx"
    if os.path.exists(excel_path):
        os.remove(excel_path)
    generate_template(excel_path)
    
    # 2. Load the excel file inputs
    print("Reading inputs from generated Excel file...")
    excel_inputs = read_excel_inputs(excel_path)
    
    # 3. Load reference JSON inputs
    json_path = "sample_piping_system.json"
    print(f"Reading reference inputs from {json_path}...")
    with open(json_path, 'r') as f:
        json_inputs = json.load(f)
        
    # Check that inputs match structurally
    assert len(excel_inputs['nodes']) == len(json_inputs['nodes']), "Nodes mismatch"
    assert len(excel_inputs['elements']) == len(json_inputs['elements']), "Elements mismatch"
    assert len(excel_inputs['materials']) == len(json_inputs['materials']), "Materials mismatch"
    assert len(excel_inputs['sections']) == len(json_inputs['sections']), "Sections mismatch"
    
    print("Excel input parsing matches sample JSON inputs successfully.")
    
    # 4. Solve the model using both routes
    print("Solving via direct FEAEngine (JSON path)...")
    engine_json = FEAEngine(json_inputs)
    engine_json.solve()
    summary_json = engine_json.get_summary()
    
    print("Solving via Excel-loaded FEAEngine (Excel path)...")
    engine_excel = FEAEngine(excel_inputs)
    engine_excel.solve()
    summary_excel = engine_excel.get_summary()
    
    # Compare summary_json and summary_excel
    # A. Check displacements
    for nid, cases in summary_json['nodes'].items():
        for case, disp in cases.items():
            ref_disp = np.array(disp)
            test_disp = np.array(summary_excel['nodes'][nid][case])
            diff = np.linalg.norm(ref_disp - test_disp)
            assert diff < 1e-9, f"Displacement mismatch at node {nid} case {case}: diff={diff}"
            
    # B. Check stresses
    for eid, stress_data in summary_json['elements'].items():
        ref_max_ratio = stress_data['max_stress_ratio']
        test_max_ratio = summary_excel['elements'][eid]['max_stress_ratio']
        diff = abs(ref_max_ratio - test_max_ratio)
        assert diff < 1e-9, f"Stress ratio mismatch at element {eid}: diff={diff}"
        
    print("FEA results from Excel inputs match reference JSON results perfectly!")
    
    # 5. Write Excel results back to workbook and check output sheets
    print("Writing results back to Excel...")
    from excel_interface import write_excel_results
    write_excel_results(excel_path, summary_excel)
    
    # Verify the values written to sheets are correct
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    
    # Check Displacements sheet
    ws_disp = wb['Displacements_Report']
    # Check that header is correct
    assert ws_disp['A3'].value == "Node ID", "Displacements sheet header A3 incorrect"
    assert ws_disp['C4'].value is not None, "Displacement value at C4 is empty"
    
    # Check Stresses sheet
    ws_stress = wb['Stress_Compliance_Report']
    assert ws_stress['A3'].value == "Element ID", "Stress sheet header A3 incorrect"
    assert ws_stress['P4'].value in ("PASS", "FAIL"), "Status column value is incorrect"
    
    print("Excel report sheet generation verified successfully.")
    
    # Clean up test file
    if os.path.exists(excel_path):
        os.remove(excel_path)
        print(f"Cleaned up temporary file: {excel_path}")
        
    print("=== EXCEL SOLVER VERIFICATION SUCCESSFUL! ===")

if __name__ == "__main__":
    run_verification()
