import json
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
import pyvista as pv
from typing import Dict, Any, Tuple, List
from sif_calculator import calculate_bend_sif_and_k, calculate_tee_sif
from report_generator import generate_html_report, generate_pdf_report

class FEAEngine:
    def __init__(self, input_data: Dict[str, Any]):
        self.data = input_data
        self.materials = self.data.get('materials', {})
        self.sections = self.data.get('sections', {})
        self.nodes = self.data.get('nodes', {})
        self.elements = self.data.get('elements', [])
        self.bcs = self.data.get('boundary_conditions', {})
        self.loads = self.data.get('loads', {})
        
        self.num_nodes = len(self.nodes)
        self.num_dofs = self.num_nodes * 6
        
        # Maps node string ID to integer index
        self.node_id_to_idx = {str(nid): i for i, nid in enumerate(self.nodes.keys())}
        self.idx_to_node_id = {i: str(nid) for nid, i in self.node_id_to_idx.items()}
        
        self.node_coords = np.zeros((self.num_nodes, 3))
        for nid, coords in self.nodes.items():
            self.node_coords[self.node_id_to_idx[str(nid)]] = np.array(coords)
            
        self.global_K = sp.lil_matrix((self.num_dofs, self.num_dofs))
        
        # Solver results dictionary
        self.results = {}
        
        self._calculate_section_properties()
        self._calculate_element_properties()

    def _calculate_section_properties(self):
        for sec_id, sec_data in self.sections.items():
            if sec_data.get('type') == 'pipe':
                od = sec_data['OD']
                t = sec_data['wall_thickness']
                ro = od / 2.0
                ri = ro - t
                A = np.pi * (ro**2 - ri**2)
                I = (np.pi / 4.0) * (ro**4 - ri**4)
                J = I * 2.0 # Polar moment of inertia J = Iy + Iz = 2I for pipe
                Z = I / ro # Section modulus
                
                # Mass density and weight properties
                # Default steel density if not provided in materials: 7850 kg/m^3
                sec_data['ro'] = ro
                sec_data['ri'] = ri
                sec_data['A'] = A
                sec_data['Iy'] = I
                sec_data['Iz'] = I
                sec_data['J'] = J
                sec_data['Z'] = Z
                
                # Area of fluid (internal area)
                sec_data['A_fluid'] = np.pi * ri**2
                
                # Area of insulation
                t_ins = sec_data.get('insulation_thickness', 0.0)
                sec_data['A_insulation'] = np.pi * ((ro + t_ins)**2 - ro**2)

    def _calculate_element_properties(self):
        # Scan nodes for branch connections (tees) to assign SIFs
        node_elem_count = {nid: 0 for nid in self.nodes.keys()}
        for elem in self.elements:
            node_elem_count[str(elem['node_A'])] += 1
            node_elem_count[str(elem['node_B'])] += 1
            
        for elem in self.elements:
            elem_type = elem.get('type', 'pipe')
            sec = self.sections[elem['section']]
            
            # SIFs default to 1.0 (straight pipe)
            k_factor = 1.0
            i_i = 1.0
            i_o = 1.0
            
            # Calculate chord length and actual arc/structural length
            idx_A = self.node_id_to_idx[str(elem['node_A'])]
            idx_B = self.node_id_to_idx[str(elem['node_B'])]
            p1 = self.node_coords[idx_A]
            p2 = self.node_coords[idx_B]
            L_chord = np.linalg.norm(p2 - p1)
            
            if elem_type == 'bend':
                # Curved bend element
                R = elem.get('bend_radius', 1.5 * sec['OD'])
                elem['bend_radius'] = R
                k_factor, i_i, i_o = calculate_bend_sif_and_k(sec['OD'], sec['wall_thickness'], R)
                
                # Calculate bend angle theta
                if L_chord < 2.0 * R:
                    theta = 2.0 * np.arcsin(L_chord / (2.0 * R))
                else:
                    theta = np.pi / 2.0 # Assume 90 degree bend
                L_arc = R * theta
                elem['L'] = L_arc
            else:
                # Check if this element attaches to a branch node (Tee)
                # If a node is shared by 3 or more elements, it's a branch connection
                is_branch_A = node_elem_count[str(elem['node_A'])] >= 3
                is_branch_B = node_elem_count[str(elem['node_B'])] >= 3
                if is_branch_A or is_branch_B:
                    i_i, i_o = calculate_tee_sif(sec['OD'], sec['wall_thickness'], "welding_tee")
                elem['L'] = L_chord
                
            elem['k_factor'] = k_factor
            elem['i_i'] = i_i
            elem['i_o'] = i_o

    def _get_element_stiffness(self, E: float, G: float, A: float, Iy: float, Iz: float, J: float, L: float, k_factor: float = 1.0) -> np.ndarray:
        # 12x12 Euler-Bernoulli 3D beam element local stiffness matrix
        k = np.zeros((12, 12))
        
        # Axial (x)
        EA_L = E * A / L
        k[0, 0] = EA_L; k[0, 6] = -EA_L; k[6, 0] = -EA_L; k[6, 6] = EA_L
        
        # Torsion (x-axis rotation)
        GJ_L = G * J / L
        k[3, 3] = GJ_L; k[3, 9] = -GJ_L; k[9, 3] = -GJ_L; k[9, 9] = GJ_L
        
        # Bending in xy plane (v translation, thz rotation)
        # Bending stiffness Iz is divided by the flexibility factor k_factor
        Iz_eff = Iz / k_factor
        a_z = 12 * E * Iz_eff / L**3
        b_z = 6 * E * Iz_eff / L**2
        c_z = 4 * E * Iz_eff / L
        d_z = 2 * E * Iz_eff / L
        
        k[1, 1] = a_z; k[1, 5] = b_z; k[1, 7] = -a_z; k[1, 11] = b_z
        k[5, 1] = b_z; k[5, 5] = c_z; k[5, 7] = -b_z; k[5, 11] = d_z
        k[7, 1] = -a_z; k[7, 5] = -b_z; k[7, 7] = a_z; k[7, 11] = -b_z
        k[11, 1] = b_z; k[11, 5] = d_z; k[11, 7] = -b_z; k[11, 11] = c_z
        
        # Bending in xz plane (w translation, thy rotation)
        # Bending stiffness Iy is divided by the flexibility factor k_factor
        Iy_eff = Iy / k_factor
        a_y = 12 * E * Iy_eff / L**3
        b_y = 6 * E * Iy_eff / L**2
        c_y = 4 * E * Iy_eff / L
        d_y = 2 * E * Iy_eff / L
        
        k[2, 2] = a_y; k[2, 4] = -b_y; k[2, 8] = -a_y; k[2, 10] = -b_y
        k[4, 2] = -b_y; k[4, 4] = c_y; k[4, 8] = b_y; k[4, 10] = d_y
        k[8, 2] = -a_y; k[8, 4] = b_y; k[8, 8] = a_y; k[8, 10] = b_y
        k[10, 2] = -b_y; k[10, 4] = d_y; k[10, 8] = b_y; k[10, 10] = c_y
        
        return k

    def _get_transformation_matrix(self, p1: np.ndarray, p2: np.ndarray) -> Tuple[np.ndarray, float]:
        dx, dy, dz = p2 - p1
        L = np.linalg.norm(p2 - p1)
        lx, mx, nx = dx/L, dy/L, dz/L
        
        if np.isclose(lx, 0) and np.isclose(mx, 0):
            if nx > 0:
                ly, my, ny = 0, 1, 0
                lz, mz, nz = -1, 0, 0
            else:
                ly, my, ny = 0, -1, 0
                lz, mz, nz = 1, 0, 0
        else:
            D = np.sqrt(lx**2 + mx**2)
            ly, my, ny = -mx/D, lx/D, 0
            lz, mz, nz = -lx*nx/D, -mx*nx/D, D
            
        lambda_mat = np.array([
            [lx, mx, nx],
            [ly, my, ny],
            [lz, mz, nz]
        ])
        
        T = np.zeros((12, 12))
        T[0:3, 0:3] = lambda_mat
        T[3:6, 3:6] = lambda_mat
        T[6:9, 6:9] = lambda_mat
        T[9:12, 9:12] = lambda_mat
        
        return T, L

    def assemble(self):
        self.global_K = sp.lil_matrix((self.num_dofs, self.num_dofs))
        for elem in self.elements:
            n_A_id = str(elem['node_A'])
            n_B_id = str(elem['node_B'])
            mat_id = elem['material']
            sec_id = elem['section']
            
            mat = self.materials[mat_id]
            sec = self.sections[sec_id]
            
            idx_A = self.node_id_to_idx[n_A_id]
            idx_B = self.node_id_to_idx[n_B_id]
            
            p1 = self.node_coords[idx_A]
            p2 = self.node_coords[idx_B]
            
            T, _ = self._get_transformation_matrix(p1, p2)
            elem['T'] = T
            
            L = elem['L']
            k_factor = elem['k_factor']
            
            k_local = self._get_element_stiffness(mat['E'], mat['G'], sec['A'], sec['Iy'], sec['Iz'], sec['J'], L, k_factor)
            elem['k_local'] = k_local
            
            k_global = T.T @ k_local @ T
            elem['k_global'] = k_global
            
            dof_indices = []
            for idx in [idx_A, idx_B]:
                dof_indices.extend([idx*6+i for i in range(6)])
                
            elem['dofs'] = dof_indices
            
            for i in range(12):
                for j in range(12):
                    self.global_K[dof_indices[i], dof_indices[j]] += k_global[i, j]
                    
    def apply_boundary_conditions(self):
        penalty = 1e15
        dof_map = {'tx': 0, 'ty': 1, 'tz': 2, 'rx': 3, 'ry': 4, 'rz': 5}
        for nid, bcs in self.bcs.items():
            idx = self.node_id_to_idx[str(nid)]
            for dof_name, boundary in bcs.items():
                dof_idx = idx * 6 + dof_map[dof_name]
                if isinstance(boundary, bool) and boundary:
                    self.global_K[dof_idx, dof_idx] += penalty
                elif isinstance(boundary, (int, float)):
                    # Translational spring support
                    self.global_K[dof_idx, dof_idx] += boundary
                    
    def _get_fixed_end_forces_weight(self, q_local: np.ndarray, L: float) -> np.ndarray:
        qx, qy, qz = q_local
        f_fe = np.zeros(12)
        
        # Node A
        f_fe[0] = qx * L / 2.0
        f_fe[1] = qy * L / 2.0
        f_fe[2] = qz * L / 2.0
        f_fe[3] = 0.0
        f_fe[4] = -qz * L**2 / 12.0
        f_fe[5] = qy * L**2 / 12.0
        
        # Node B
        f_fe[6] = qx * L / 2.0
        f_fe[7] = qy * L / 2.0
        f_fe[8] = qz * L / 2.0
        f_fe[9] = 0.0
        f_fe[10] = qz * L**2 / 12.0
        f_fe[11] = -qy * L**2 / 12.0
        
        return f_fe

    def _get_fixed_end_forces_thermal(self, E: float, A: float, alpha: float, dT: float) -> np.ndarray:
        f_fe = np.zeros(12)
        F_th = E * A * alpha * dT
        f_fe[0] = -F_th
        f_fe[6] = F_th
        return f_fe

    def _solve_case(self, case_type: str) -> Tuple[np.ndarray, Dict[int, np.ndarray]]:
        """
        Solves a single load case.
        case_type: 'W' (Weight), 'T' (Thermal), or 'U' (Occasional/Seismic)
        """
        F_case = np.zeros(self.num_dofs)
        f_fe_elements = {}
        
        # Apply nodal point loads (only to mechanical weight case W)
        if case_type == 'W':
            node_loads = self.loads.get('nodes', {})
            for nid, loads in node_loads.items():
                idx = self.node_id_to_idx[str(nid)]
                F_case[idx*6 + 0] += loads.get('Fx', 0.0)
                F_case[idx*6 + 1] += loads.get('Fy', 0.0)
                F_case[idx*6 + 2] += loads.get('Fz', 0.0)
                F_case[idx*6 + 3] += loads.get('Mx', 0.0)
                F_case[idx*6 + 4] += loads.get('My', 0.0)
                F_case[idx*6 + 5] += loads.get('Mz', 0.0)
                
        # Calculate element equivalent nodal loads (fixed-end forces)
        for elem in self.elements:
            sec = self.sections[elem['section']]
            mat = self.materials[elem['material']]
            T = elem['T']
            L = elem['L']
            
            f_fe = np.zeros(12)
            
            if case_type == 'W':
                # Compute weight per unit length
                rho_steel = mat.get('density', 7850.0)
                rho_fluid = sec.get('fluid_density', 0.0)
                rho_ins = sec.get('insulation_density', 0.0)
                
                m_pipe = rho_steel * sec['A']
                m_fluid = rho_fluid * sec['A_fluid']
                m_ins = rho_ins * sec['A_insulation']
                
                m_total = m_pipe + m_fluid + m_ins
                
                # Gravity vector: default [0.0, -9.81, 0.0]
                g_global = np.array(self.loads.get('global_gravity', [0.0, -9.81, 0.0]))
                q_global = m_total * g_global
                
                # Transform distributed load to local coordinate system
                R_mat = T[0:3, 0:3]
                q_local = R_mat @ q_global
                
                f_fe = self._get_fixed_end_forces_weight(q_local, L)
                
            elif case_type == 'T':
                # Compute thermal forces
                dT = self.loads.get('global_temperature_change', 0.0)
                f_fe = self._get_fixed_end_forces_thermal(mat['E'], sec['A'], mat.get('alpha', 0.0), dT)
                
            elif case_type == 'U':
                # Seismic occasional load: acceleration * mass
                seismic_g = np.array(self.loads.get('occasional_g', [0.0, 0.0, 0.0]))
                if np.linalg.norm(seismic_g) > 0:
                    rho_steel = mat.get('density', 7850.0)
                    rho_fluid = sec.get('fluid_density', 0.0)
                    rho_ins = sec.get('insulation_density', 0.0)
                    
                    m_total = (rho_steel * sec['A']) + (rho_fluid * sec['A_fluid']) + (rho_ins * sec['A_insulation'])
                    q_global = m_total * seismic_g
                    
                    R_mat = T[0:3, 0:3]
                    q_local = R_mat @ q_global
                    f_fe = self._get_fixed_end_forces_weight(q_local, L)
                    
            f_fe_elements[elem['id']] = f_fe
            
            # Transform element fixed-end forces to global and assemble in F_case
            f_fe_global = T.T @ f_fe
            for i, dof_idx in enumerate(elem['dofs']):
                F_case[dof_idx] += f_fe_global[i]
                
        # Solve equations K_global * u = F_case
        K_csr = self.global_K.tocsr()
        u_case = spla.spsolve(K_csr, F_case)
        
        # Calculate local forces for each element
        f_local_elements = {}
        for elem in self.elements:
            u_elem_global = u_case[elem['dofs']]
            u_elem_local = elem['T'] @ u_elem_global
            
            f_elem_local = elem['k_local'] @ u_elem_local - f_fe_elements[elem['id']]
            f_local_elements[elem['id']] = f_elem_local
            
        return u_case, f_local_elements

    def solve(self):
        # 1. Assemble K matrix and apply boundary conditions
        self.assemble()
        self.apply_boundary_conditions()
        
        # 2. Solve individual cases
        u_W, f_W = self._solve_case('W')
        u_T, f_T = self._solve_case('T')
        
        # Check if occasional loading is requested
        has_occasional = np.linalg.norm(self.loads.get('occasional_g', [0.0, 0.0, 0.0])) > 0
        if has_occasional:
            u_U, f_U = self._solve_case('U')
        else:
            u_U, f_U = np.zeros(self.num_dofs), {elem['id']: np.zeros(12) for elem in self.elements}
            
        self.results = {
            'displacements_W': u_W,
            'f_local_W': f_W,
            'displacements_T': u_T,
            'f_local_T': f_T,
            'displacements_U': u_U,
            'f_local_U': f_U,
            'has_occasional': has_occasional
        }
        
        # 3. Perform code compliance evaluations
        self._calculate_code_compliance()

    def _calculate_code_compliance(self):
        P = self.loads.get('global_internal_pressure', 0.0)
        
        f_W = self.results['f_local_W']
        f_T = self.results['f_local_T']
        f_U = self.results['f_local_U']
        
        for elem in self.elements:
            sec = self.sections[elem['section']]
            mat = self.materials[elem['material']]
            
            # SIFs and geometric properties
            i_i = elem['i_i']
            i_o = elem['i_o']
            ro = sec['ro']
            t = sec['wall_thickness']
            A = sec['A']
            Z = sec['Z']
            OD = sec['OD']
            
            # Longitudinal pressure stress: P * D_o / (4 * t)
            sigma_pr = (P * OD) / (4.0 * t) if t > 0 else 0.0
            
            # 1. SUSTAINED CASE (SUS)
            # Evaluate at Node A (indices 0, 4, 5) and Node B (indices 6, 10, 11)
            # Weight forces and moments
            f_w_el = f_W[elem['id']]
            
            # Node A
            Fx_w_A = f_w_el[0]
            My_w_A = f_w_el[4]
            Mz_w_A = f_w_el[5]
            S_b_w_A = (np.sqrt((i_i * Mz_w_A)**2 + (i_o * My_w_A)**2)) / Z
            S_a_w_A = abs(Fx_w_A) / A
            S_L_A = S_b_w_A + S_a_w_A + sigma_pr
            
            # Node B
            Fx_w_B = f_w_el[6]
            My_w_B = f_w_el[10]
            Mz_w_B = f_w_el[11]
            S_b_w_B = (np.sqrt((i_i * Mz_w_B)**2 + (i_o * My_w_B)**2)) / Z
            S_a_w_B = abs(Fx_w_B) / A
            S_L_B = S_b_w_B + S_a_w_B + sigma_pr
            
            S_L = max(S_L_A, S_L_B)
            
            # 2. EXPANSION CASE (EXP)
            # Thermal moments and torsion
            f_t_el = f_T[elem['id']]
            
            # Node A
            Mx_t_A = f_t_el[3] # Torsion
            My_t_A = f_t_el[4]
            Mz_t_A = f_t_el[5]
            S_b_t_A = (np.sqrt((i_i * Mz_t_A)**2 + (i_o * My_t_A)**2)) / Z
            S_t_t_A = abs(Mx_t_A) / (2.0 * Z)
            S_E_A = np.sqrt(S_b_t_A**2 + 4.0 * S_t_t_A**2)
            
            # Node B
            Mx_t_B = f_t_el[9]
            My_t_B = f_t_el[10]
            Mz_t_B = f_t_el[11]
            S_b_t_B = (np.sqrt((i_i * Mz_t_B)**2 + (i_o * My_t_B)**2)) / Z
            S_t_t_B = abs(Mx_t_B) / (2.0 * Z)
            S_E_B = np.sqrt(S_b_t_B**2 + 4.0 * S_t_t_B**2)
            
            S_E = max(S_E_A, S_E_B)
            
            # 3. OCCASIONAL CASE (OCC)
            # Sustained + absolute occasional seismic moments
            if self.results['has_occasional']:
                f_u_el = f_U[elem['id']]
                
                # Node A
                My_u_A = f_u_el[4]
                Mz_u_A = f_u_el[5]
                Fx_u_A = f_u_el[0]
                M_i_occ_A = abs(Mz_w_A) + abs(Mz_u_A)
                M_o_occ_A = abs(My_w_A) + abs(My_u_A)
                S_b_occ_A = (np.sqrt((i_i * M_i_occ_A)**2 + (i_o * M_o_occ_A)**2)) / Z
                S_a_occ_A = (abs(Fx_w_A) + abs(Fx_u_A)) / A
                S_OL_A = S_b_occ_A + S_a_occ_A + sigma_pr
                
                # Node B
                My_u_B = f_u_el[10]
                Mz_u_B = f_u_el[11]
                Fx_u_B = f_u_el[6]
                M_i_occ_B = abs(Mz_w_B) + abs(Mz_u_B)
                M_o_occ_B = abs(My_w_B) + abs(My_u_B)
                S_b_occ_B = (np.sqrt((i_i * M_i_occ_B)**2 + (i_o * M_o_occ_B)**2)) / Z
                S_a_occ_B = (abs(Fx_w_B) + abs(Fx_u_B)) / A
                S_OL_B = S_b_occ_B + S_a_occ_B + sigma_pr
                
                S_OL = max(S_OL_A, S_OL_B)
            else:
                S_OL = 0.0
                
            # Allowable stresses
            Sc = mat.get('Sc', mat['yield_strength'] / 1.5)
            Sh = mat.get('Sh', mat['yield_strength'] / 1.5)
            
            # Allowable expansion stress range S_A = 1.25 * S_c + 0.25 * S_h
            S_A = 1.25 * Sc + 0.25 * Sh
            
            # Allowable occasional stress = 1.33 * S_h
            S_OL_allowable = 1.33 * Sh
            
            elem['compliance'] = {
                'S_L': float(S_L),
                'S_L_allowable': float(Sh),
                'S_L_ratio': float(S_L / Sh) if Sh > 0 else 0.0,
                'S_E': float(S_E),
                'S_E_allowable': float(S_A),
                'S_E_ratio': float(S_E / S_A) if S_A > 0 else 0.0,
                'S_OL': float(S_OL),
                'S_OL_allowable': float(S_OL_allowable),
                'S_OL_ratio': float(S_OL / S_OL_allowable) if (self.results['has_occasional'] and S_OL_allowable > 0) else 0.0
            }

    def get_summary(self) -> Dict[str, Any]:
        # Displacements output (for Operating case = Weight + Thermal)
        u_W = self.results['displacements_W']
        u_T = self.results['displacements_T']
        u_OPE = u_W + u_T
        
        node_displacements = {}
        for nid, idx in self.node_id_to_idx.items():
            node_displacements[nid] = {
                'Weight': u_W[idx*6 : idx*6+6].tolist(),
                'Thermal': u_T[idx*6 : idx*6+6].tolist(),
                'Operating': u_OPE[idx*6 : idx*6+6].tolist()
            }
            
        element_stresses = {}
        compliance_warning = False
        
        for elem in self.elements:
            eid = elem['id']
            comp = elem['compliance']
            
            max_ratio = max(comp['S_L_ratio'], comp['S_E_ratio'])
            if self.results['has_occasional']:
                max_ratio = max(max_ratio, comp['S_OL_ratio'])
                
            if max_ratio > 1.0:
                compliance_warning = True
                
            element_stresses[eid] = {
                'type': elem.get('type', 'pipe'),
                'k_factor': float(elem['k_factor']),
                'SIF_in': float(elem['i_i']),
                'SIF_out': float(elem['i_o']),
                'sustained_stress': float(comp['S_L']),
                'sustained_allowable': float(comp['S_L_allowable']),
                'sustained_ratio': float(comp['S_L_ratio']),
                'expansion_stress': float(comp['S_E']),
                'expansion_allowable': float(comp['S_E_allowable']),
                'expansion_ratio': float(comp['S_E_ratio']),
                'occasional_stress': float(comp['S_OL']),
                'occasional_allowable': float(comp['S_OL_allowable']),
                'occasional_ratio': float(comp['S_OL_ratio']),
                'max_stress_ratio': float(max_ratio),
                'compliance_pass': bool(max_ratio <= 1.0)
            }
            
        return {
            'nodes': node_displacements,
            'elements': element_stresses,
            'compliance_warning': bool(compliance_warning),
            'has_occasional': bool(self.results['has_occasional'])
        }
        
    def visualize(self, scale_factor: float = 50.0, show: bool = True, save_path: str = None):
        """
        Visualizes the original and deformed pipeline using pyvista, colored by stress compliance ratio.
        """
        plotter = pv.Plotter(off_screen=not show)
        
        # Original mesh
        lines_orig = []
        points_orig = []
        point_idx = 0
        for elem in self.elements:
            idx_A = self.node_id_to_idx[str(elem['node_A'])]
            idx_B = self.node_id_to_idx[str(elem['node_B'])]
            p1 = self.node_coords[idx_A]
            p2 = self.node_coords[idx_B]
            points_orig.append(p1)
            points_orig.append(p2)
            lines_orig.append([2, point_idx, point_idx+1])
            point_idx += 2
            
        mesh_orig = pv.PolyData(np.array(points_orig))
        mesh_orig.lines = np.hstack(lines_orig)
        plotter.add_mesh(mesh_orig, color='gray', opacity=0.2, line_width=1, label="Original")
        
        # Deformed mesh (Operating case: Weight + Thermal)
        u_W = self.results['displacements_W']
        u_T = self.results['displacements_T']
        u_OPE = u_W + u_T
        
        lines_def = []
        points_def = []
        scalars = [] # Store stress compliance ratio for heatmap
        point_idx = 0
        
        for elem in self.elements:
            idx_A = self.node_id_to_idx[str(elem['node_A'])]
            idx_B = self.node_id_to_idx[str(elem['node_B'])]
            
            p1 = self.node_coords[idx_A]
            p2 = self.node_coords[idx_B]
            
            u_A = u_OPE[idx_A*6 : idx_A*6+3]
            u_B = u_OPE[idx_B*6 : idx_B*6+3]
            
            p1_def = p1 + u_A * scale_factor
            p2_def = p2 + u_B * scale_factor
            
            points_def.append(p1_def)
            points_def.append(p2_def)
            lines_def.append([2, point_idx, point_idx+1])
            
            # Map coloring to max stress ratio
            comp = elem['compliance']
            ratio = max(comp['S_L_ratio'], comp['S_E_ratio'])
            if self.results['has_occasional']:
                ratio = max(ratio, comp['S_OL_ratio'])
                
            scalars.append(ratio)
            scalars.append(ratio)
            
            point_idx += 2
            
        mesh_def = pv.PolyData(np.array(points_def))
        mesh_def.lines = np.hstack(lines_def)
        mesh_def.point_data["Stress Compliance Ratio"] = np.array(scalars)
        
        plotter.add_mesh(mesh_def, scalars="Stress Compliance Ratio", cmap="turbo", line_width=5, label="Operating Case")
        
        plotter.add_axes()
        plotter.add_legend()
        
        if save_path:
            plotter.screenshot(save_path)
            
        if show:
            plotter.show()

if __name__ == "__main__":
    import argparse
    import sys
    import os
 
    parser = argparse.ArgumentParser(description="Run 3D Frame/Beam Piping FEA Stress Analysis from a JSON or Excel input file.")
    parser.add_argument("input_file", help="Path to the JSON or Excel input file (.json or .xlsx).")
    parser.add_argument("--output_json", help="Path to save the numerical results JSON.", default="results_summary.json")
    parser.add_argument("--output_image", help="Path to save the PyVista visualization image.", default="deformation_heatmap.png")
    parser.add_argument("--output_html", help="Path to save the interactive HTML report.", default="stress_report.html")
    parser.add_argument("--output_pdf", help="Path to save the printable PDF report.", default="stress_report.pdf")
    parser.add_argument("--output_excel", help="Path to save the Excel results report (defaults to input file if it is Excel).", default=None)
    parser.add_argument("--scale", type=float, help="Deformation exaggeration scale factor.", default=50.0)
    parser.add_argument("--no_show", action="store_true", help="Do not open the interactive 3D window.")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input_file):
        print(f"Error: Input file '{args.input_file}' not found.")
        sys.exit(1)
        
    is_excel = args.input_file.endswith('.xlsx')
    
    if is_excel:
        try:
            from excel_interface import read_excel_inputs
            print(f"Reading Excel inputs from: {args.input_file} ...")
            data = read_excel_inputs(args.input_file)
        except ImportError:
            print("Error: 'openpyxl' is required to process Excel files. Please install it or use JSON input.")
            sys.exit(1)
        except Exception as e:
            print(f"Error reading Excel input file: {e}")
            sys.exit(1)
    else:
        with open(args.input_file, 'r') as f:
            data = json.load(f)
        
    engine = FEAEngine(data)
    print("Running multi-case structural analysis and SIF compliance checks...")
    engine.solve()
    
    summary = engine.get_summary()
    with open(args.output_json, 'w') as f:
        json.dump(summary, f, indent=4)
    print(f"Compliance results saved to {args.output_json}")
    
    # Save results to Excel if applicable
    output_excel = args.output_excel if args.output_excel else (args.input_file if is_excel else None)
    if output_excel:
        try:
            from excel_interface import write_excel_results
            print(f"Writing Excel results to: {output_excel} ...")
            write_excel_results(output_excel, summary)
        except Exception as e:
            print(f"Error writing Excel results: {e}")
    
    # Generate HTML and PDF Reports
    print("Generating HTML and PDF reports...")
    generate_html_report(summary, args.output_html)
    print(f"Interactive HTML report saved to {args.output_html}")
    generate_pdf_report(summary, args.output_pdf)
    print(f"Printable PDF report saved to {args.output_pdf}")
    
    # Format and display terminal report summary
    print("\n--- PIPING STRESS COMPLIANCE REPORT ---")
    print(f"Compliance Warning (Any Stress Ratio > 1.0): {summary['compliance_warning']}")
    print("\nElement Stress Summary:")
    print(f"{'ID':<4} {'Type':<6} {'SIF (I/O)':<12} {'SUS Stress (Pa)':<15} {'SUS Allow (Pa)':<15} {'SUS Ratio':<10} {'EXP Stress (Pa)':<15} {'EXP Allow (Pa)':<15} {'EXP Ratio':<10}")
    for eid, el_res in summary['elements'].items():
        sif_str = f"{el_res['SIF_in']:.2f}/{el_res['SIF_out']:.2f}"
        print(f"{eid:<4} {el_res['type']:<6} {sif_str:<12} {el_res['sustained_stress']:<15.2e} {el_res['sustained_allowable']:<15.2e} {el_res['sustained_ratio']:<10.2f} {el_res['expansion_stress']:<15.2e} {el_res['expansion_allowable']:<15.2e} {el_res['expansion_ratio']:<10.2f}")
    print("---------------------------------------")
    
    print(f"\nRendering stress compliance heatmap to {args.output_image}...")
    engine.visualize(
        scale_factor=args.scale, 
        show=not args.no_show, 
        save_path=args.output_image
    )
