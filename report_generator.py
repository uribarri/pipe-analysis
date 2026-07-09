import json
import os
from typing import Dict, Any
from fpdf import FPDF

def generate_html_report(summary: Dict[str, Any], output_path: str):
    """
    Generates a premium, highly aesthetic, and interactive HTML stress report.
    """
    elements = summary.get('elements', {})
    nodes = summary.get('nodes', {})
    warning = summary.get('compliance_warning', False)
    
    # Calculate stats
    total_elements = len(elements)
    max_ratio = 0.0
    failed_elements = 0
    
    for el_id, el in elements.items():
        ratio = el.get('max_stress_ratio', 0.0)
        max_ratio = max(max_ratio, ratio)
        if not el.get('compliance_pass', True):
            failed_elements += 1
            
    status_class = "pass-badge" if failed_elements == 0 else "fail-badge"
    status_text = "PASSED" if failed_elements == 0 else f"FAILED ({failed_elements} points)"

    # HTML Templates
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Piping Stress Analysis Compliance Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-color: #0f172a;
            --panel-bg: #1e293b;
            --border-color: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-indigo: #6366f1;
            --accent-violet: #8b5cf6;
            --color-pass: #10b981;
            --color-warning: #f59e0b;
            --color-fail: #ef4444;
        }}

        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}

        body {{
            font-family: 'Inter', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            line-height: 1.6;
            padding: 40px 20px;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}

        /* Header Card */
        header {{
            background: linear-gradient(135deg, var(--accent-indigo), var(--accent-violet));
            border-radius: 16px;
            padding: 40px;
            margin-bottom: 30px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
            position: relative;
            overflow: hidden;
        }}

        header::before {{
            content: '';
            position: absolute;
            top: -50%;
            left: -20%;
            width: 80%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 80%);
            transform: rotate(30deg);
            pointer-events: none;
        }}

        .header-title {{
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }}

        .header-subtitle {{
            font-size: 16px;
            color: rgba(255, 255, 255, 0.8);
            font-weight: 400;
        }}

        /* KPI Dashboard Grid */
        .kpi-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}

        .kpi-card {{
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            transition: transform 0.2s, border-color 0.2s;
        }}

        .kpi-card:hover {{
            transform: translateY(-4px);
            border-color: var(--accent-indigo);
        }}

        .kpi-title {{
            font-size: 13px;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }}

        .kpi-value {{
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 4px;
        }}

        .kpi-desc {{
            font-size: 12px;
            color: var(--text-secondary);
        }}

        .pass-badge {{
            color: var(--color-pass);
        }}

        .fail-badge {{
            color: var(--color-fail);
        }}

        /* Navigation Tabs */
        .tabs {{
            display: flex;
            border-bottom: 2px solid var(--border-color);
            margin-bottom: 24px;
            gap: 8px;
        }}

        .tab-btn {{
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 12px 24px;
            font-size: 15px;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
            position: relative;
            bottom: -2px;
            border-bottom: 2px solid transparent;
        }}

        .tab-btn:hover {{
            color: var(--text-primary);
        }}

        .tab-btn.active {{
            color: var(--accent-indigo);
            border-bottom-color: var(--accent-indigo);
            font-weight: 600;
        }}

        .tab-content {{
            display: none;
        }}

        .tab-content.active {{
            display: block;
            animation: fadeIn 0.3s ease;
        }}

        @keyframes fadeIn {{
            from {{ opacity: 0; transform: translateY(8px); }}
            to {{ opacity: 1; transform: translateY(0); }}
        }}

        /* Table Styles */
        .table-container {{
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }}

        th, td {{
            padding: 16px;
            border-bottom: 1px solid var(--border-color);
            font-size: 14px;
        }}

        th {{
            background-color: rgba(255,255,255,0.02);
            font-weight: 600;
            color: var(--text-primary);
            cursor: pointer;
            user-select: none;
        }}

        th:hover {{
            background-color: rgba(255,255,255,0.05);
        }}

        tr:last-child td {{
            border-bottom: none;
        }}

        tr:hover td {{
            background-color: rgba(255,255,255,0.01);
        }}

        .tag {{
            display: inline-block;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }}

        .tag-pass {{
            background-color: rgba(16, 185, 129, 0.15);
            color: var(--color-pass);
            border: 1px solid rgba(16, 185, 129, 0.3);
        }}

        .tag-fail {{
            background-color: rgba(239, 68, 68, 0.15);
            color: var(--color-fail);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }}

        /* Progress Bar for Stress Ratios */
        .ratio-wrapper {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .ratio-bar-bg {{
            width: 80px;
            height: 8px;
            background-color: rgba(255,255,255,0.1);
            border-radius: 4px;
            overflow: hidden;
        }}

        .ratio-bar-fill {{
            height: 100%;
            border-radius: 4px;
        }}

        .ratio-val {{
            font-weight: 600;
            width: 32px;
            font-size: 13px;
        }}

        /* Responsive Design */
        @media (max-width: 768px) {{
            header {{ padding: 24px; }}
            .header-title {{ font-size: 24px; }}
            th, td {{ padding: 12px 8px; }}
            .tab-btn {{ padding: 10px 16px; font-size: 13px; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1 class="header-title">ASME B31.3 Stress Compliance Report</h1>
            <p class="header-subtitle">Static Frame FEA Piping System Verification</p>
        </header>

        <div class="kpi-grid">
            <div class="kpi-card">
                <p class="kpi-title">Overall Status</p>
                <p class="kpi-value {status_class}">{status_text}</p>
                <p class="kpi-desc">ASME B31.3 Stress Compliance Check</p>
            </div>
            <div class="kpi-card">
                <p class="kpi-title">Max Stress Ratio</p>
                <p class="kpi-value" style="color: {var_ratio_color(max_ratio)}">{max_ratio:.2f}</p>
                <p class="kpi-desc">Peak Stress / Code Allowable Limit</p>
            </div>
            <div class="kpi-card">
                <p class="kpi-title">Total Checked Elements</p>
                <p class="kpi-value">{total_elements}</p>
                <p class="kpi-desc">Pipes and Bends Evaluated</p>
            </div>
        </div>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab(event, 'stresses')">Element Stress Analysis</button>
            <button class="tab-btn" onclick="switchTab(event, 'displacements')">Node Displacements</button>
        </div>

        <!-- STRESS TAB -->
        <div id="stresses" class="tab-content active">
            <div class="table-container">
                <table id="stressTable">
                    <thead>
                        <tr>
                            <th onclick="sortTable(0)">ID</th>
                            <th onclick="sortTable(1)">Type</th>
                            <th onclick="sortTable(2)">SIF (In/Out)</th>
                            <th onclick="sortTable(3)">Sustained Stress (Pa)</th>
                            <th onclick="sortTable(4)">Sustained Ratio</th>
                            <th onclick="sortTable(5)">Expansion Stress (Pa)</th>
                            <th onclick="sortTable(6)">Expansion Ratio</th>
                            <th onclick="sortTable(7)">Compliance</th>
                        </tr>
                    </thead>
                    <tbody>
        """

    for eid, el in elements.items():
        sif_in = el.get('SIF_in', 1.0)
        sif_out = el.get('SIF_out', 1.0)
        sus_s = el.get('sustained_stress', 0.0)
        sus_r = el.get('sustained_ratio', 0.0)
        exp_s = el.get('expansion_stress', 0.0)
        exp_r = el.get('expansion_ratio', 0.0)
        
        status_tag = '<span class="tag tag-pass">Pass</span>' if el.get('compliance_pass', True) else '<span class="tag tag-fail">Fail</span>'
        
        html_content += f"""
                        <tr>
                            <td>{eid}</td>
                            <td>{el.get('type', 'pipe').capitalize()}</td>
                            <td>{sif_in:.2f} / {sif_out:.2f}</td>
                            <td>{sus_s:.3e}</td>
                            <td>
                                <div class="ratio-wrapper">
                                    <div class="ratio-bar-bg">
                                        <div class="ratio-bar-fill" style="width: {min(sus_r*100, 100):.1f}%; background-color: {var_ratio_color(sus_r)}"></div>
                                    </div>
                                    <span class="ratio-val" style="color: {var_ratio_color(sus_r)}">{sus_r:.2f}</span>
                                </div>
                            </td>
                            <td>{exp_s:.3e}</td>
                            <td>
                                <div class="ratio-wrapper">
                                    <div class="ratio-bar-bg">
                                        <div class="ratio-bar-fill" style="width: {min(exp_r*100, 100):.1f}%; background-color: {var_ratio_color(exp_r)}"></div>
                                    </div>
                                    <span class="ratio-val" style="color: {var_ratio_color(exp_r)}">{exp_r:.2f}</span>
                                </div>
                            </td>
                            <td>{status_tag}</td>
                        </tr>
        """

    html_content += """
                    </tbody>
                </table>
            </div>
        </div>

        <!-- DISPLACEMENTS TAB -->
        <div id="displacements" class="tab-content">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Node ID</th>
                            <th>Case</th>
                            <th>Dx (m)</th>
                            <th>Dy (m)</th>
                            <th>Dz (m)</th>
                            <th>Rx (rad)</th>
                            <th>Ry (rad)</th>
                            <th>Rz (rad)</th>
                        </tr>
                    </thead>
                    <tbody>
    """

    for nid, disp in nodes.items():
        for case_name in ['Weight', 'Thermal', 'Operating']:
            c_disp = disp.get(case_name, [0.0]*6)
            html_content += f"""
                        <tr>
                            <td><strong>{nid}</strong></td>
                            <td style="color: var(--text-secondary); font-weight: 500;">{case_name}</td>
                            <td>{c_disp[0]:.4e}</td>
                            <td>{c_disp[1]:.4e}</td>
                            <td>{c_disp[2]:.4e}</td>
                            <td>{c_disp[3]:.4e}</td>
                            <td>{c_disp[4]:.4e}</td>
                            <td>{c_disp[5]:.4e}</td>
                        </tr>
            """

    html_content += """
                    </tbody>
                </table>
            </div>
        </div>

    </div>

    <script>
        function switchTab(evt, tabId) {
            const contents = document.getElementsByClassName("tab-content");
            for (let i = 0; i < contents.length; i++) {
                contents[i].classList.remove("active");
            }
            const buttons = document.getElementsByClassName("tab-btn");
            for (let i = 0; i < buttons.length; i++) {
                buttons[i].classList.remove("active");
            }
            document.getElementById(tabId).classList.add("active");
            evt.currentTarget.classList.add("active");
        }

        function sortTable(n) {
            const table = document.getElementById("stressTable");
            let rows, switching, i, x, y, shouldSwitch, dir, switchcount = 0;
            switching = true;
            dir = "asc";
            while (switching) {
                switching = false;
                rows = table.rows;
                for (i = 1; i < (rows.length - 1); i++) {
                    shouldSwitch = false;
                    x = rows[i].getElementsByTagName("TD")[n];
                    y = rows[i + 1].getElementsByTagName("TD")[n];
                    
                    let xVal = x.innerText;
                    let yVal = y.innerText;
                    
                    // Parse values
                    let xNum = parseFloat(xVal.replace(/[^0-9eE.+-]/g, ''));
                    let yNum = parseFloat(yVal.replace(/[^0-9eE.+-]/g, ''));
                    
                    if (!isNaN(xNum) && !isNaN(yNum)) {
                        if (dir == "asc") {
                            if (xNum > yNum) { shouldSwitch = true; break; }
                        } else if (dir == "desc") {
                            if (xNum < yNum) { shouldSwitch = true; break; }
                        }
                    } else {
                        if (dir == "asc") {
                            if (xVal.toLowerCase() > yVal.toLowerCase()) { shouldSwitch = true; break; }
                        } else if (dir == "desc") {
                            if (xVal.toLowerCase() < yVal.toLowerCase()) { shouldSwitch = true; break; }
                        }
                    }
                }
                if (shouldSwitch) {
                    rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
                    switching = true;
                    switchcount++;
                } else {
                    if (switchcount == 0 && dir == "asc") {
                        dir = "desc";
                        switching = true;
                    }
                }
            }
        }
    </script>
</body>
</html>
"""
    with open(output_path, 'w') as f:
        f.write(html_content)

def var_ratio_color(ratio: float) -> str:
    if ratio < 0.5:
        return "#10b981" # Emerald-500
    elif ratio < 0.9:
        return "#f59e0b" # Amber-500
    else:
        return "#ef4444" # Red-500


class PipingPDF(FPDF):
    def header(self):
        # Draw background color banner
        self.set_fill_color(79, 70, 229) # Indigo
        self.rect(0, 0, 210, 35, 'F')
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 16)
        self.cell(0, 10, "ASME B31.3 Piping Stress Analysis Report", align='C', ln=True)
        self.set_font('Helvetica', 'I', 10)
        self.cell(0, 5, "Static Frame FEA Stress Verification Engine Output", align='C', ln=True)
        self.ln(12)
        
    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}} | Confidential & Proprietary", align='C')

def generate_pdf_report(summary: Dict[str, Any], output_path: str):
    """
    Generates a formal, print-ready PDF report using fpdf2.
    """
    elements = summary.get('elements', {})
    nodes = summary.get('nodes', {})
    warning = summary.get('compliance_warning', False)
    
    # Calculate stats
    total_elements = len(elements)
    max_ratio = 0.0
    failed_elements = 0
    
    for el_id, el in elements.items():
        ratio = el.get('max_stress_ratio', 0.0)
        max_ratio = max(max_ratio, ratio)
        if not el.get('compliance_pass', True):
            failed_elements += 1

    pdf = PipingPDF(orientation='P', unit='mm', format='A4')
    pdf.alias_nb_pages()
    pdf.add_page()
    
    # Overview Summary Section
    pdf.set_y(40)
    pdf.set_font('Helvetica', 'B', 12)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 8, "1. Executive Summary & KPIs", ln=True)
    pdf.set_draw_color(226, 232, 240)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)
    
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(71, 85, 105)
    
    status_str = "PASSED" if failed_elements == 0 else f"FAILED ({failed_elements} points failed)"
    status_col = (16, 185, 129) if failed_elements == 0 else (239, 68, 68)
    
    pdf.cell(50, 6, "Overall Status:")
    pdf.set_font('Helvetica', 'B', 10)
    pdf.set_text_color(*status_col)
    pdf.cell(0, 6, status_str, ln=True)
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(71, 85, 105)
    
    pdf.cell(50, 6, "Maximum Stress Ratio:")
    pdf.set_font('Helvetica', 'B', 10)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 6, f"{max_ratio:.2f}", ln=True)
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(71, 85, 105)
    
    pdf.cell(50, 6, "Checked Piping Elements:")
    pdf.cell(0, 6, f"{total_elements}", ln=True)
    pdf.cell(50, 6, "Code Standard Checked:")
    pdf.cell(0, 6, "ASME B31.3 (Process Piping)", ln=True)
    pdf.ln(6)
    
    # Element Stress Table
    pdf.set_font('Helvetica', 'B', 12)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 8, "2. Element Stress Compliance Summary", ln=True)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)
    
    # Table Header
    pdf.set_fill_color(241, 245, 249)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(10, 6, "ID", border=1, fill=True)
    pdf.cell(15, 6, "Type", border=1, fill=True)
    pdf.cell(18, 6, "SIF (I/O)", border=1, fill=True)
    pdf.cell(32, 6, "Sustained Stress (Pa)", border=1, fill=True)
    pdf.cell(20, 6, "SUS Ratio", border=1, fill=True)
    pdf.cell(32, 6, "Expansion Stress (Pa)", border=1, fill=True)
    pdf.cell(20, 6, "EXP Ratio", border=1, fill=True)
    pdf.cell(20, 6, "Status", border=1, fill=True, ln=True)
    
    # Table Content
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(71, 85, 105)
    for eid, el in elements.items():
        sif_in = el.get('SIF_in', 1.0)
        sif_out = el.get('SIF_out', 1.0)
        sus_s = el.get('sustained_stress', 0.0)
        sus_r = el.get('sustained_ratio', 0.0)
        exp_s = el.get('expansion_stress', 0.0)
        exp_r = el.get('expansion_ratio', 0.0)
        pass_str = "PASS" if el.get('compliance_pass', True) else "FAIL"
        
        pdf.cell(10, 6, f"{eid}", border=1)
        pdf.cell(15, 6, f"{el.get('type', 'pipe').capitalize()}", border=1)
        pdf.cell(18, 6, f"{sif_in:.2f}/{sif_out:.2f}", border=1)
        pdf.cell(32, 6, f"{sus_s:.3e}", border=1)
        pdf.cell(20, 6, f"{sus_r:.2f}", border=1)
        pdf.cell(32, 6, f"{exp_s:.3e}", border=1)
        pdf.cell(20, 6, f"{exp_r:.2f}", border=1)
        
        # Color code status column
        if pass_str == "PASS":
            pdf.set_text_color(16, 185, 129)
        else:
            pdf.set_text_color(239, 68, 68)
        pdf.cell(20, 6, pass_str, border=1, ln=True)
        pdf.set_text_color(71, 85, 105)
        
    pdf.ln(6)
    
    # Node Displacements Section
    pdf.set_font('Helvetica', 'B', 12)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(0, 8, "3. Node Operating Displacements", ln=True)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)
    
    # Displacements Header
    pdf.set_fill_color(241, 245, 249)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(30, 41, 59)
    pdf.cell(15, 6, "Node ID", border=1, fill=True)
    pdf.cell(20, 6, "Case", border=1, fill=True)
    pdf.cell(25, 6, "Dx (m)", border=1, fill=True)
    pdf.cell(25, 6, "Dy (m)", border=1, fill=True)
    pdf.cell(25, 6, "Dz (m)", border=1, fill=True)
    pdf.cell(25, 6, "Rx (rad)", border=1, fill=True)
    pdf.cell(25, 6, "Ry (rad)", border=1, fill=True)
    pdf.cell(25, 6, "Rz (rad)", border=1, fill=True, ln=True)
    
    pdf.set_font('Helvetica', '', 7.5)
    pdf.set_text_color(71, 85, 105)
    for nid, disp in nodes.items():
        # Write only the Operating case for layout size reasons, or weight/thermal too
        # Let's write the Operating case as it's the design envelope
        c_disp = disp.get('Operating', [0.0]*6)
        pdf.cell(15, 5, f"{nid}", border=1)
        pdf.cell(20, 5, "Operating", border=1)
        pdf.cell(25, 5, f"{c_disp[0]:.4e}", border=1)
        pdf.cell(25, 5, f"{c_disp[1]:.4e}", border=1)
        pdf.cell(25, 5, f"{c_disp[2]:.4e}", border=1)
        pdf.cell(25, 5, f"{c_disp[3]:.4e}", border=1)
        pdf.cell(25, 5, f"{c_disp[4]:.4e}", border=1)
        pdf.cell(25, 5, f"{c_disp[5]:.4e}", border=1, ln=True)

    pdf.output(output_path)
