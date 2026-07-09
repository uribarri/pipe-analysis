# Pipe Stress Analyzer: Standalone Executable & User Guide

Welcome to the **Pipe Stress Analyzer**, a lightweight 3D Finite Element Analysis (FEA) software engineered to replicate the static structural analysis and ASME B31.3 code-compliance checking capabilities of **CAEPIPE**.

---

## 1. Compiling the Standalone Executable

Since macOS and Windows utilize different binary execution models, the standalone binary must be compiled on the operating system you intend to use. We have provided an automated build script: [build_executable.py](file:///Users/uribarri/Documents/GitHub/pipe_analysis/build_executable.py).

### How to Compile on Windows (To get `.exe`)
To package the tool into a standalone `pipe_stress_analyzer.exe` that you can run on any Windows machine without installing Python:
1. Open **Command Prompt** or **PowerShell** on a Windows machine.
2. Navigate to the project root directory:
   ```cmd
   cd path\to\pipe_analysis
   ```
3. Run the build script using Python:
   ```cmd
   python build_executable.py
   ```
   *This script automatically installs `pyinstaller` and builds the standalone binary.*
4. Retrieve your executable inside the newly created `dist/` directory:
   ```cmd
   dist\pipe_stress_analyzer.exe --help
   ```

### How to Compile on macOS
Similarly, to package it for macOS, run the script from your terminal:
```bash
python3 build_executable.py
```
*The compiled binary will be placed inside `dist/pipe_stress_analyzer`.*

---

## 2. Command Line Interface (CLI) Reference

Once compiled, you can run the executable directly from your terminal or command prompt:

```bash
pipe_stress_analyzer <input_file.json> [flags]
```

### Supported Flags
* `--output_json <filename>`: Path to save the numeric results JSON (default: `results_summary.json`).
* `--output_image <filename>`: Path to save the PyVista 3D deflection/stress heatmap (default: `deformation_heatmap.png`).
* `--output_html <filename>`: Path to save the interactive HTML dashboard report (default: `stress_report.html`).
* `--output_pdf <filename>`: Path to save the printable PDF stress compliance sheet (default: `stress_report.pdf`).
* `--scale <factor>`: Scale factor to exaggerate the deformed geometry rendering in the heatmap (default: `50.0`).
* `--no_show`: Run headlessly (disables interactive 3D popup window, writing directly to files instead).

---

## 3. Input JSON Schema Reference

The analyzer reads system descriptions in JSON format. The schema has six root blocks:

### 1. `materials`
Defines physical and design properties of the piping metals.
```json
"materials": {
  "mat_id": {
    "E": 2.0e11,              // Young's Modulus (Pa)
    "G": 7.7e10,              // Shear Modulus (Pa)
    "alpha": 1.2e-5,          // Coefficient of Thermal Expansion (1/°C)
    "yield_strength": 2.5e8,  // Yield strength (Pa)
    "Sc": 1.379e8,            // Cold allowable stress (Pa)
    "Sh": 1.379e8,            // Hot/operating allowable stress (Pa)
    "density": 7850.0         // Metal mass density (kg/m³)
  }
}
```

### 2. `sections`
Defines geometric properties of the piping sections, including insulation and fluid.
```json
"sections": {
  "sec_id": {
    "OD": 0.1143,               // Outer Diameter (m) - e.g. 4" NPS is 0.1143m
    "wall_thickness": 0.00602,  // Wall thickness (m) - e.g. Sch 40 is 0.00602m
    "type": "pipe",             // Section type (currently "pipe")
    "fluid_density": 1000.0,    // Density of fluid contents (kg/m³) - 0.0 if empty
    "insulation_thickness": 0.025, // Thickness of insulation layer (m)
    "insulation_density": 200.0  // Density of insulation material (kg/m³)
  }
}
```

### 3. `nodes`
Lists the coordinates $(X, Y, Z)$ of key locations (joints, bends, anchors).
```json
"nodes": {
  "0": [0.0, 0.0, 0.0],
  "1": [3.0, 0.0, 0.0],
  "2": [3.0, 3.0, 0.0]
}
```

### 4. `elements`
Lists the physical segments connecting the nodes. Bends (elbows) are declared here.
```json
"elements": [
  {
    "id": 0,
    "node_A": 0,
    "node_B": 1,
    "type": "pipe",             // "pipe" (straight) or "bend" (curved elbow)
    "material": "mat_id",
    "section": "sec_id"
  },
  {
    "id": 1,
    "node_A": 1,
    "node_B": 2,
    "type": "bend",
    "bend_radius": 0.17145,     // Radius of bend (m). Defaults to 1.5 * OD.
    "material": "mat_id",
    "section": "sec_id"
  }
]
```

### 5. `boundary_conditions`
Specifies nodal restraints. Values can be boolean (rigid fixed/free) or floats (spring hanger stiffness).
```json
"boundary_conditions": {
  "0": { "tx": true, "ty": true, "tz": true, "rx": true, "ry": true, "rz": true }, // Rigid Anchor
  "2": { "ty": 50000.0 } // Vertical spring support (50,000 N/m stiffness)
}
```

### 6. `loads`
Specifies environmental and operating load conditions.
```json
"loads": {
  "global_gravity": [0.0, -9.81, 0.0],     // Gravity vector (m/s²)
  "global_internal_pressure": 2.0e6,        // Internal design pressure (Pa)
  "global_temperature_change": 120.0,       // Temperature delta from installation (°C)
  "occasional_g": [0.1, 0.0, 0.0]           // Optional uniform seismic g-loads (m/s²)
}
```

---

## 4. Step-by-Step Tutorial: Analyzing a 3D Loop

In this tutorial, we will evaluate the stress compliance of a standard 3D piping loop under weight, pressure, and thermal expansion.

### Step 1: Prepare the Input File
Save the following model description as `loop_test.json`:
```json
{
  "materials": {
    "carbon_steel": {
      "E": 2.0e11,
      "G": 7.7e10,
      "alpha": 1.2e-5,
      "yield_strength": 2.5e8,
      "Sc": 1.379e8,
      "Sh": 1.379e8,
      "density": 7850.0
    }
  },
  "sections": {
    "nps_4_sch40": {
      "OD": 0.1143,
      "wall_thickness": 0.00602,
      "type": "pipe",
      "fluid_density": 1000.0,
      "insulation_thickness": 0.025,
      "insulation_density": 200.0
    }
  },
  "nodes": {
    "0": [0.0, 0.0, 0.0],
    "1": [3.0, 0.0, 0.0],
    "2": [3.0, 3.0, 0.0],
    "3": [5.0, 3.0, 0.0],
    "4": [5.0, 3.0, 2.0]
  },
  "elements": [
    { "id": 0, "node_A": 0, "node_B": 1, "type": "pipe", "material": "carbon_steel", "section": "nps_4_sch40" },
    { "id": 1, "node_A": 1, "node_B": 2, "type": "bend", "bend_radius": 0.17145, "material": "carbon_steel", "section": "nps_4_sch40" },
    { "id": 2, "node_A": 2, "node_B": 3, "type": "pipe", "material": "carbon_steel", "section": "nps_4_sch40" },
    { "id": 3, "node_A": 3, "node_B": 4, "type": "pipe", "material": "carbon_steel", "section": "nps_4_sch40" }
  ],
  "boundary_conditions": {
    "0": { "tx": true, "ty": true, "tz": true, "rx": true, "ry": true, "rz": true },
    "4": { "tx": true, "ty": true, "tz": true, "rx": true, "ry": true, "rz": true }
  },
  "loads": {
    "global_gravity": [0.0, -9.81, 0.0],
    "global_internal_pressure": 2.0e6,
    "global_temperature_change": 130.0
  }
}
```

### Step 2: Run the Executable
Open your terminal and run the compiled executable:
```bash
pipe_stress_analyzer loop_test.json
```
*Or on Windows:*
```cmd
pipe_stress_analyzer.exe loop_test.json
```

### Step 3: Review the Reports
Upon execution, the terminal prints a summary report, and four output files are created:
1. **`stress_report.html`**: Open this in any web browser to view the interactive dashboard. You can click on column headers (e.g. ID, Sustained Ratio) to sort the elements or switch to the **Node Displacements** tab to verify structural movement.
2. **`stress_report.pdf`**: A clean, printable PDF containing stress ratios and compliance tags ready for sharing.
3. **`deformation_heatmap.png`**: A PyVista-generated rendering showing the exaggerated deformation of the pipeline, color-mapped based on the stress-to-allowable ratio.
4. **`results_summary.json`**: An structured JSON containing the precise numbers for further programming integrations.

## 5. Excel Spreadsheet Integration

The analyzer provides two distinct ways to utilize spreadsheets for piping stress analysis:

### A. Interactive L-Bend Analyzer (100% Native Formulas)

We provide a self-contained, fully interactive workbook: **`L_bend_analyzer.xlsx`** (located in the project root).
* **Zero External Dependencies**: All calculations are performed by Excel’s native formula engine. You do not need to run Python, macros, or terminal commands.
* **Instant Recalculation**: Open the sheet in Microsoft Excel, Google Sheets, or Apple Numbers. Edit any values in the **Design Inputs** section (shaded in light yellow), and the cross-sectional properties, thermal expansion, compatibility matrix, reaction forces (solved using `=MMULT(MINVERSE(...), ...)`), displacements, and ASME B31.3 stress compliance reports will update **instantly**.
* **Visual Formatting**: Built-in conditional formatting automatically highlights any stress ratios exceeding $1.0$ or failed nodes in red.

---

### B. Interactive Multi-Element 3D Solver (100% Native Formulas)

We provide a general-purpose interactive workbook for wireframe piping networks: **`piping_fea_solver.xlsx`** (located in the project root).
* **Zero External Dependencies**: All 3D stiffness matrices, rotation transformations, global assembly summing, boundary condition penalties, matrix inversions, and displacement solvers run on Excel's native formula engine.
* **Instant Recalculation**: Open the sheet in Microsoft Excel or Google Sheets. Modify the coordinate values, elements connectivity, fixity constraints, or load parameters in the yellow-shaded input tables on the `Inputs` tab, and the full structural analysis updates automatically across all sheets.
* **Flexible Capacity**: Supports up to **8 nodes** and **7 elements** (accommodating standard loops, branches, or runs).
* **Worksheets**:
  - `Inputs`: Material lists, section shapes, XYZ coordinates, elements, boundary conditions, and loads.
  - `Element_Stiffness`: For each element, calculates length $L$, rotation matrix $\lambda$, $12\times12$ local stiffness, and transforms it to the global coordinate block $T^T k_{local} T$.
  - `Global_Solver`: Assembles the $48\times48$ global stiffness matrix $K_{global}$, applies boundary condition penalties ($10^{15}$ N/m stiffness addition to diagonal nodes), handles the load vectors, and solves for displacements using `=MMULT(MINVERSE(K_global), Load_Vector)`.
  - `Stress_Report`: Decouples displacement values into local element forces, calculates ASME B31.3 SIFs, sustained/expansion stresses, and displays color-coded **PASS/FAIL** tags.

---

### C. Command-Line Excel Automation (For Arbitrary Pipelines)

For dynamic or larger piping systems defined inside Excel, the analyzer includes Python utilities to automate reading and writing spreadsheets:

#### Step 1: Generate a Clean Excel Template
To generate a pre-formatted Excel workbook template:
```bash
python3 excel_interface.py --generate my_system.xlsx
```
This generates `my_system.xlsx` with input tabs (`Materials`, `Sections`, `Nodes`, `Elements`, `Boundary_Conditions`, `Loads`) pre-loaded with sample loop data.

#### Step 2: Edit Inputs in Excel
You can open this file and modify the tables:
* **Grid lines** are kept visible for easy editing.
* **Boundary Conditions**: Enter `TRUE` (rigidly fixed), `FALSE`/blank (free), or a number (spring stiffness in N/m).
* **Loads**: Simple key-value rows specify individual parameters (pressure, temperature, gravity components).

#### Step 3: Solve the Model
Run the analyzer directly on the Excel workbook using the CLI:
```bash
python3 fea_engine.py my_system.xlsx
```
*Or using the interface script directly:*
```bash
python3 excel_interface.py --solve my_system.xlsx
```

#### Step 4: View Numerical Results in Excel
Upon execution, two new sheets are appended to your Excel workbook:
1. **`Displacements_Report`**: Displacements and rotations at each node for Weight, Thermal, and Operating conditions.
2. **`Stress_Compliance_Report`**: In-plane/out-of-plane SIFs, flexibility factors, sustained stresses, thermal expansion stresses, occasional stresses, allowable stress compliance check, and a **Pass/Fail** status tag.
   - **Conditional Formatting**: Stress ratios exceeding $1.0$ and elements labeled `FAIL` are automatically highlighted in red.
   - **Zebra striping**: Alternating light blue-grey rows are applied automatically for optimal legibility.
