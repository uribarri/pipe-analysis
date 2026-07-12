// Custom 3D Frame FEA Solver in JavaScript for Piping Stress Analysis

class FEASolver {
    constructor(modelData) {
        this.data = modelData;
        this.materials = modelData.materials || {};
        this.sections = modelData.sections || {};
        this.nodes = modelData.nodes || {};
        this.elements = modelData.elements || [];
        this.bcs = modelData.boundary_conditions || {};
        this.loads = modelData.loads || {};
        
        this.nodeKeys = Object.keys(this.nodes);
        this.numNodes = this.nodeKeys.length;
        this.numDofs = this.numNodes * 6;
        
        // Maps node ID string to integer index
        this.nodeIdToIdx = {};
        this.idxToNodeId = {};
        this.nodeKeys.forEach((nid, i) => {
            this.nodeIdToIdx[String(nid)] = i;
            this.idxToNodeId[i] = String(nid);
        });
        
        this.nodeCoords = [];
        this.nodeKeys.forEach(nid => {
            this.nodeCoords.push(new Float64Array(this.nodes[nid]));
        });
        
        this._calculateSectionProperties();
        this._calculateElementProperties();
    }

    _calculateSectionProperties() {
        for (let secId in this.sections) {
            if (!this.sections.hasOwnProperty(secId)) continue;
            let sec = this.sections[secId];
            if (sec.type === 'pipe') {
                let od = parseFloat(sec.OD);
                let t = parseFloat(sec.wall_thickness);
                let ro = od / 2.0;
                let ri = ro - t;
                let A = Math.PI * (ro**2 - ri**2);
                let I = (Math.PI / 4.0) * (ro**4 - ri**4);
                let J = I * 2.0;
                let Z = I / ro;
                
                sec.ro = ro;
                sec.ri = ri;
                sec.A = A;
                sec.Iy = I;
                sec.Iz = I;
                sec.J = J;
                sec.Z = Z;
                
                sec.A_fluid = Math.PI * (ri**2);
                
                let t_ins = parseFloat(sec.insulation_thickness) || 0.0;
                sec.A_insulation = Math.PI * ((ro + t_ins)**2 - ro**2);
            }
        }
    }

    _calculateElementProperties() {
        // Find point components (Node A === Node B)
        let bendAtNode = {};
        let weightAtNode = {};
        let teeAtNode = {};
        this.elements.forEach(elem => {
            if (String(elem.node_A) === String(elem.node_B)) {
                let sec = this.sections[elem.section];
                let od = sec ? parseFloat(sec.OD) : 0.1143;
                if (elem.type === 'bend') {
                    bendAtNode[String(elem.node_A)] = parseFloat(elem.bend_radius) || (1.5 * od);
                } else if (elem.type === 'valve' || elem.type === 'flange' || elem.type === 'tee') {
                    weightAtNode[String(elem.node_A)] = (weightAtNode[String(elem.node_A)] || 0.0) + parseFloat(elem.weight || 0.0);
                    if (elem.type === 'tee') {
                        teeAtNode[String(elem.node_A)] = true;
                    }
                }
            }
        });
        this.bendAtNode = bendAtNode;
        this.weightAtNode = weightAtNode;
        this.teeAtNode = teeAtNode;

        // Count element connections at each node to identify branches (Tees)
        let nodeElemCount = {};
        this.nodeKeys.forEach(nid => { nodeElemCount[String(nid)] = 0; });
        this.elements.forEach(elem => {
            if (String(elem.node_A) !== String(elem.node_B)) {
                nodeElemCount[String(elem.node_A)]++;
                nodeElemCount[String(elem.node_B)]++;
            }
        });

        this.elements.forEach(elem => {
            let elemType = elem.type || 'pipe';
            let sec = this.sections[elem.section];
            
            // Per-node SIFs
            elem.i_i_A = 1.0;
            elem.i_o_A = 1.0;
            elem.i_i_B = 1.0;
            elem.i_o_B = 1.0;
            elem.k_factor = 1.0;
            
            if (String(elem.node_A) === String(elem.node_B)) {
                elem.L = 0.0;
                return;
            }
            
            let idx_A = this.nodeIdToIdx[String(elem.node_A)];
            let idx_B = this.nodeIdToIdx[String(elem.node_B)];
            let p1 = this.nodeCoords[idx_A];
            let p2 = this.nodeCoords[idx_B];
            
            let dx = p2[0] - p1[0];
            let dy = p2[1] - p1[1];
            let dz = p2[2] - p1[2];
            let L_chord = Math.sqrt(dx*dx + dy*dy + dz*dz);
            elem.L = L_chord;
            
            // Check for adjacent node-based bends
            let R_A = bendAtNode[String(elem.node_A)] || 0.0;
            let R_B = bendAtNode[String(elem.node_B)] || 0.0;
            
            if (R_A > 0) {
                let r_m = (sec.OD - sec.wall_thickness) / 2.0;
                let h = (sec.wall_thickness * R_A) / (r_m ** 2);
                let k = 1.65 / h; if (k < 1.0) k = 1.0;
                let i_i = 0.9 / (h ** (2.0/3.0)); if (i_i < 1.0) i_i = 1.0;
                let i_o = 0.75 / (h ** (2.0/3.0)); if (i_o < 1.0) i_o = 1.0;
                
                elem.k_factor = Math.max(elem.k_factor, k);
                elem.i_i_A = i_i;
                elem.i_o_A = i_o;
            }
            if (R_B > 0) {
                let r_m = (sec.OD - sec.wall_thickness) / 2.0;
                let h = (sec.wall_thickness * R_B) / (r_m ** 2);
                let k = 1.65 / h; if (k < 1.0) k = 1.0;
                let i_i = 0.9 / (h ** (2.0/3.0)); if (i_i < 1.0) i_i = 1.0;
                let i_o = 0.75 / (h ** (2.0/3.0)); if (i_o < 1.0) i_o = 1.0;
                
                elem.k_factor = Math.max(elem.k_factor, k);
                elem.i_i_B = i_i;
                elem.i_o_B = i_o;
            }
            
            // Handle element-based bends
            if (elemType === 'bend') {
                let R = parseFloat(elem.bend_radius) || (1.5 * sec.OD);
                elem.bend_radius = R;
                
                let r_m = (sec.OD - sec.wall_thickness) / 2.0;
                let h = (sec.wall_thickness * R) / (r_m ** 2);
                
                let k = 1.65 / h; if (k < 1.0) k = 1.0;
                let i_i = 0.9 / (h ** (2.0/3.0)); if (i_i < 1.0) i_i = 1.0;
                let i_o = 0.75 / (h ** (2.0/3.0)); if (i_o < 1.0) i_o = 1.0;
                
                elem.k_factor = k;
                elem.i_i_A = i_i; elem.i_o_A = i_o;
                elem.i_i_B = i_i; elem.i_o_B = i_o;
                
                let theta = (L_chord < 2.0 * R) ? 2.0 * Math.asin(L_chord / (2.0 * R)) : Math.PI / 2.0;
                elem.L = R * theta;
            } else if (elemType === 'pipe') {
                // Tee check applies if node connects to 3+ elements OR is marked as a Tee fitting
                let is_branch_A = (nodeElemCount[String(elem.node_A)] >= 3) || (this.teeAtNode[String(elem.node_A)] === true);
                let is_branch_B = (nodeElemCount[String(elem.node_B)] >= 3) || (this.teeAtNode[String(elem.node_B)] === true);
                
                if (is_branch_A && R_A === 0) {
                    let h_tee = 4.4 * sec.wall_thickness / sec.OD;
                    let i = 0.9 / (h_tee ** (2.0/3.0)); if (i < 1.0) i = 1.0;
                    elem.i_i_A = i; elem.i_o_A = i;
                }
                if (is_branch_B && R_B === 0) {
                    let h_tee = 4.4 * sec.wall_thickness / sec.OD;
                    let i = 0.9 / (h_tee ** (2.0/3.0)); if (i < 1.0) i = 1.0;
                    elem.i_i_B = i; elem.i_o_B = i;
                }
            }
        });
    }

    _getHoseStiffness(k_ax, k_lat, k_rot, k_tor) {
        let k = Array.from({ length: 12 }, () => new Float64Array(12));
        
        // Axial stiffness (dof 0, 6)
        k[0][0] = k_ax; k[0][6] = -k_ax; k[6][0] = -k_ax; k[6][6] = k_ax;
        
        // Lateral stiffness local y (dof 1, 7)
        k[1][1] = k_lat; k[1][7] = -k_lat; k[7][1] = -k_lat; k[7][7] = k_lat;
        
        // Lateral stiffness local z (dof 2, 8)
        k[2][2] = k_lat; k[2][8] = -k_lat; k[8][2] = -k_lat; k[8][8] = k_lat;
        
        // Torsional stiffness (dof 3, 9)
        k[3][3] = k_tor; k[3][9] = -k_tor; k[9][3] = -k_tor; k[9][9] = k_tor;
        
        // Bending stiffness local y (dof 4, 10)
        k[4][4] = k_rot; k[4][10] = -k_rot; k[10][4] = -k_rot; k[10][10] = k_rot;
        
        // Bending stiffness local z (dof 5, 11)
        k[5][5] = k_rot; k[5][11] = -k_rot; k[11][5] = -k_rot; k[11][11] = k_rot;
        
        return k;
    }

    _getElementStiffness(E, G, A, Iy, Iz, J, L, k_factor) {
        let k = Array.from({ length: 12 }, () => new Float64Array(12));
        
        // Axial (x)
        let EA_L = E * A / L;
        k[0][0] = EA_L; k[0][6] = -EA_L; k[6][0] = -EA_L; k[6][6] = EA_L;
        
        // Torsion (x-axis rotation)
        let GJ_L = G * J / L;
        k[3][3] = GJ_L; k[3][9] = -GJ_L; k[9][3] = -GJ_L; k[9][9] = GJ_L;
        
        // Bending in xy plane (v translation, thz rotation)
        let Iz_eff = Iz / k_factor;
        let a_z = 12 * E * Iz_eff / (L**3);
        let b_z = 6 * E * Iz_eff / (L**2);
        let c_z = 4 * E * Iz_eff / L;
        let d_z = 2 * E * Iz_eff / L;
        
        k[1][1] = a_z; k[1][5] = b_z; k[1][7] = -a_z; k[1][11] = b_z;
        k[5][1] = b_z; k[5][5] = c_z; k[5][7] = -b_z; k[5][11] = d_z;
        k[7][1] = -a_z; k[7][5] = -b_z; k[7][7] = a_z; k[7][11] = -b_z;
        k[11][1] = b_z; k[11][5] = d_z; k[11][7] = -b_z; k[11][11] = c_z;
        
        // Bending in xz plane (w translation, thy rotation)
        let Iy_eff = Iy / k_factor;
        let a_y = 12 * E * Iy_eff / (L**3);
        let b_y = 6 * E * Iy_eff / (L**2);
        let c_y = 4 * E * Iy_eff / L;
        let d_y = 2 * E * Iy_eff / L;
        
        k[2][2] = a_y; k[2][4] = -b_y; k[2][8] = -a_y; k[2][10] = -b_y;
        k[4][2] = -b_y; k[4][4] = c_y; k[4][8] = b_y; k[4][10] = d_y;
        k[8][2] = -a_y; k[8][4] = b_y; k[8][8] = a_y; k[8][10] = b_y;
        k[10][2] = -b_y; k[10][4] = d_y; k[10][8] = b_y; k[10][10] = c_y;
        
        return k;
    }

    _getTransformationMatrix(p1, p2) {
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        let dz = p2[2] - p1[2];
        let L = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        let lx = dx / L, mx = dy / L, nx = dz / L;
        let ly, my, ny, lz, mz, nz;
        
        if (Math.abs(lx) < 1e-6 && Math.abs(mx) < 1e-6) {
            if (nx > 0) {
                ly = 0; my = 1; ny = 0;
                lz = -1; mz = 0; nz = 0;
            } else {
                ly = 0; my = -1; ny = 0;
                lz = 1; mz = 0; nz = 0;
            }
        } else {
            let D = Math.sqrt(lx**2 + mx**2);
            ly = -mx / D; my = lx / D; ny = 0;
            lz = -lx * nx / D; mz = -mx * nx / D; nz = D;
        }
        
        let lambda = [
            [lx, mx, nx],
            [ly, my, ny],
            [lz, mz, nz]
        ];
        
        let T = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let b = 0; b < 4; b++) {
            let offset = b * 3;
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    T[offset + i][offset + j] = lambda[i][j];
                }
            }
        }
        
        return { T, L };
    }

    solve() {
        // Initialize Global Stiffness Matrix
        let K_global = Array.from({ length: this.numDofs }, () => new Float64Array(this.numDofs));
        
        // Assemble Element Stiffness Matrices
        this.elements.forEach(elem => {
            if (String(elem.node_A) === String(elem.node_B)) {
                return;
            }
            let idx_A = this.nodeIdToIdx[String(elem.node_A)];
            let idx_B = this.nodeIdToIdx[String(elem.node_B)];
            let p1 = this.nodeCoords[idx_A];
            let p2 = this.nodeCoords[idx_B];
            
            let { T } = this._getTransformationMatrix(p1, p2);
            elem.T = T;
            
            let sec = this.sections[elem.section];
            let mat = this.materials[elem.material];
            
            let k_local;
            if (elem.type === 'hose') {
                let k_ax = parseFloat(elem.k_ax || 1e7);
                let k_lat = parseFloat(elem.k_lat || 1e5);
                let k_rot = 100.0;
                let k_tor = 500.0;
                k_local = this._getHoseStiffness(k_ax, k_lat, k_rot, k_tor);
            } else {
                // Scaled rigid stiffness for valve, flange, and tee
                let E_eff = mat.E;
                let G_eff = mat.G;
                if (elem.type === 'valve' || elem.type === 'flange' || elem.type === 'tee') {
                    E_eff *= 100.0;
                    G_eff *= 100.0;
                }
                k_local = this._getElementStiffness(E_eff, G_eff, sec.A, sec.Iy, sec.Iz, sec.J, elem.L, elem.k_factor);
            }
            elem.k_local = k_local;
            
            // k_global = T.T @ k_local @ T
            let k_global = this._multiplyMatrix(this._transposeMatrix(T), this._multiplyMatrix(k_local, T));
            elem.k_global = k_global;
            
            // DOF Index Mapping
            let dofs = [];
            [idx_A, idx_B].forEach(idx => {
                for (let i = 0; i < 6; i++) {
                    dofs.push(idx * 6 + i);
                }
            });
            elem.dofs = dofs;
            
            for (let i = 0; i < 12; i++) {
                for (let j = 0; j < 12; j++) {
                    K_global[dofs[i]][dofs[j]] += k_global[i][j];
                }
            }
        });
        
        // Apply boundary condition constraints directly in K_global
        let penalty = 1e15;
        let dofMap = { tx: 0, ty: 1, tz: 2, rx: 3, ry: 4, rz: 5 };
        
        for (let nid in this.bcs) {
            if (!this.bcs.hasOwnProperty(nid)) continue;
            let idx = this.nodeIdToIdx[String(nid)];
            if (idx === undefined) continue;
            let bc = this.bcs[nid];
            
            if (bc.type === 'rod_hanger') {
                let dofIdx = idx * 6 + 1; // vertical Y
                K_global[dofIdx][dofIdx] += penalty;
            } else if (bc.type === 'variable_spring') {
                let dofIdx = idx * 6 + 1; // vertical Y
                let stiffness = parseFloat(bc.ty) || 0.0;
                K_global[dofIdx][dofIdx] += stiffness;
            } else if (bc.type === 'constant_hanger') {
                // Constant hanger has 0 stiffness in static cases
            } else if (bc.type === 'snubber') {
                // Snubber has 0 stiffness in static cases
            } else {
                // Standard/Custom boundary conditions
                for (let dofName in bc) {
                    if (dofName === 'type') continue;
                    let val = bc[dofName];
                    let dofIdx = idx * 6 + dofMap[dofName];
                    if (val === true) {
                        K_global[dofIdx][dofIdx] += penalty;
                    } else if (typeof val === 'number') {
                        K_global[dofIdx][dofIdx] += val;
                    }
                }
            }
        }
        
        // Solve Cases
        let u_W, f_W = {};
        let u_T, f_T = {};
        let u_U, f_U = {};
        
        let has_occasional = false;
        let occasional_g = this.loads.occasional_g || [0,0,0];
        if (Math.abs(occasional_g[0]) > 0.0 || Math.abs(occasional_g[1]) > 0.0 || Math.abs(occasional_g[2]) > 0.0) {
            has_occasional = true;
        }
        
        // Solve Weight case (W)
        let F_W = this._getGlobalLoadVector('W');
        u_W = this._solveLinearSystem(K_global, F_W);
        f_W = this._calculateElementLocalForces(u_W, 'W');
        
        // Solve Thermal case (T)
        let F_T = this._getGlobalLoadVector('T');
        u_T = this._solveLinearSystem(K_global, F_T);
        f_T = this._calculateElementLocalForces(u_T, 'T');
        
        // Solve Occasional case (U)
        if (has_occasional) {
            // Build K_occ as a deep copy of K_global
            let K_occ = K_global.map(row => new Float64Array(row));
            
            // Add snubber penalties to K_occ
            for (let nid in this.bcs) {
                if (!this.bcs.hasOwnProperty(nid)) continue;
                let idx = this.nodeIdToIdx[String(nid)];
                if (idx === undefined) continue;
                let bc = this.bcs[nid];
                if (bc.type === 'snubber') {
                    let axis = bc.axis || 'y';
                    let dofIdx = idx * 6 + dofMap['t' + axis];
                    K_occ[dofIdx][dofIdx] += penalty;
                }
            }
            
            let F_U = this._getGlobalLoadVector('U');
            u_U = this._solveLinearSystem(K_occ, F_U);
            f_U = this._calculateElementLocalForces(u_U, 'U');
        } else {
            u_U = new Float64Array(this.numDofs);
            this.elements.forEach(elem => {
                f_U[elem.id] = new Float64Array(12);
            });
        }
        
        this.results = {
            displacements_W: u_W,
            f_local_W: f_W,
            displacements_T: u_T,
            f_local_T: f_T,
            displacements_U: u_U,
            f_local_U: f_U,
            has_occasional: has_occasional
        };
        
        this._calculateCodeStresses();
    }

    _getGlobalLoadVector(caseType) {
        let F = new Float64Array(this.numDofs);
        
        // Apply specialized hanger forces (Preloads and Constant Effort supports)
        if (caseType === 'W' || caseType === 'U') {
            for (let nid in this.bcs) {
                if (!this.bcs.hasOwnProperty(nid)) continue;
                let idx = this.nodeIdToIdx[String(nid)];
                if (idx === undefined) continue;
                let bc = this.bcs[nid];
                if (bc.type === 'variable_spring' && typeof bc.preload === 'number') {
                    F[idx*6 + 1] += bc.preload; // Add upward preload (+Y force)
                } else if (bc.type === 'constant_hanger' && typeof bc.force === 'number') {
                    F[idx*6 + 1] += bc.force; // Add upward constant force (+Y force)
                }
            }
        }
        
        // Apply point component masses (valves/flanges at a single node)
        if (caseType === 'W') {
            for (let nid in this.weightAtNode) {
                if (!this.weightAtNode.hasOwnProperty(nid)) continue;
                let idx = this.nodeIdToIdx[nid];
                if (idx === undefined) continue;
                let m_comp = this.weightAtNode[nid];
                let g_global = new Float64Array(this.loads.global_gravity || [0.0, -9.81, 0.0]);
                F[idx*6 + 0] += m_comp * g_global[0];
                F[idx*6 + 1] += m_comp * g_global[1];
                F[idx*6 + 2] += m_comp * g_global[2];
            }
        } else if (caseType === 'U') {
            for (let nid in this.weightAtNode) {
                if (!this.weightAtNode.hasOwnProperty(nid)) continue;
                let idx = this.nodeIdToIdx[nid];
                if (idx === undefined) continue;
                let m_comp = this.weightAtNode[nid];
                let seismic_g = new Float64Array(this.loads.occasional_g || [0.0, 0.0, 0.0]);
                F[idx*6 + 0] += m_comp * seismic_g[0] * 9.81;
                F[idx*6 + 1] += m_comp * seismic_g[1] * 9.81;
                F[idx*6 + 2] += m_comp * seismic_g[2] * 9.81;
            }
        }
        
        // Apply nodal point loads (only to Weight case W)
        if (caseType === 'W') {
            let nodeLoads = this.loads.nodes || {};
            for (let nid in nodeLoads) {
                let idx = this.nodeIdToIdx[String(nid)];
                let loads = nodeLoads[nid];
                F[idx*6 + 0] += parseFloat(loads.Fx || 0.0);
                F[idx*6 + 1] += parseFloat(loads.Fy || 0.0);
                F[idx*6 + 2] += parseFloat(loads.Fz || 0.0);
                F[idx*6 + 3] += parseFloat(loads.Mx || 0.0);
                F[idx*6 + 4] += parseFloat(loads.My || 0.0);
                F[idx*6 + 5] += parseFloat(loads.Mz || 0.0);
            }
        }
        
        // Apply element loads (fixed end forces)
        this.elements.forEach(elem => {
            if (String(elem.node_A) === String(elem.node_B)) {
                elem['f_fe_' + caseType] = new Float64Array(12);
                return;
            }
            let sec = this.sections[elem.section];
            let mat = this.materials[elem.material];
            let T = elem.T;
            let L = elem.L;
            let f_fe = new Float64Array(12);
            
            if (caseType === 'W') {
                let m_total = 0.0;
                if (elem.type === 'valve' || elem.type === 'flange' || elem.type === 'tee') {
                    m_total = parseFloat(elem.weight || 0.0);
                } else {
                    let rho_steel = parseFloat(mat.density || 7850.0);
                    let rho_fluid = parseFloat(sec.fluid_density || 0.0);
                    let rho_ins = parseFloat(sec.insulation_density || 0.0);
                    
                    let m_pipe = rho_steel * sec.A;
                    let m_fluid = rho_fluid * sec.A_fluid;
                    let m_ins = rho_ins * sec.A_insulation;
                    m_total = m_pipe + m_fluid + m_ins;
                }
                
                let g_global = new Float64Array(this.loads.global_gravity || [0.0, -9.81, 0.0]);
                let q_global = new Float64Array(3);
                for (let i = 0; i < 3; i++) q_global[i] = m_total * g_global[i];
                
                let R_mat = [
                    [T[0][0], T[0][1], T[0][2]],
                    [T[1][0], T[1][1], T[1][2]],
                    [T[2][0], T[2][1], T[2][2]]
                ];
                let q_local = this._multiplyVector(R_mat, q_global);
                f_fe = this._getFixedEndForcesWeight(q_local, L);
                
            } else if (caseType === 'T') {
                let dT = parseFloat(this.loads.global_temperature_change || 0.0);
                f_fe = this._getFixedEndForcesThermal(mat.E, sec.A, parseFloat(mat.alpha || 0.0), dT);
                
            } else if (caseType === 'U') {
                let seismic_g = new Float64Array(this.loads.occasional_g || [0.0, 0.0, 0.0]);
                let m_total = 0.0;
                if (elem.type === 'valve' || elem.type === 'flange' || elem.type === 'tee') {
                    m_total = parseFloat(elem.weight || 0.0);
                } else {
                    let rho_steel = parseFloat(mat.density || 7850.0);
                    let rho_fluid = parseFloat(sec.fluid_density || 0.0);
                    let rho_ins = parseFloat(sec.insulation_density || 0.0);
                    m_total = (rho_steel * sec.A) + (rho_fluid * sec.A_fluid) + (rho_ins * sec.A_insulation);
                }
                let q_global = new Float64Array(3);
                for (let i = 0; i < 3; i++) q_global[i] = m_total * seismic_g[i] * 9.81; // Convert g-load to m/s^2
                
                let R_mat = [
                    [T[0][0], T[0][1], T[0][2]],
                    [T[1][0], T[1][1], T[1][2]],
                    [T[2][0], T[2][1], T[2][2]]
                ];
                let q_local = this._multiplyVector(R_mat, q_global);
                f_fe = this._getFixedEndForcesWeight(q_local, L);
            }
            
            elem['f_fe_' + caseType] = f_fe;
            
            // Assemble in global force vector F
            let f_fe_global = this._multiplyVector(this._transposeMatrix(T), f_fe);
            for (let i = 0; i < 12; i++) {
                F[elem.dofs[i]] += f_fe_global[i];
            }
        });
        
        return F;
    }

    _getFixedEndForcesWeight(q_local, L) {
        let qx = q_local[0], qy = q_local[1], qz = q_local[2];
        let f = new Float64Array(12);
        
        // Node A
        f[0] = qx * L / 2.0;
        f[1] = qy * L / 2.0;
        f[2] = qz * L / 2.0;
        f[3] = 0.0;
        f[4] = -qz * L**2 / 12.0;
        f[5] = qy * L**2 / 12.0;
        
        // Node B
        f[6] = qx * L / 2.0;
        f[7] = qy * L / 2.0;
        f[8] = qz * L / 2.0;
        f[9] = 0.0;
        f[10] = qz * L**2 / 12.0;
        f[11] = -qy * L**2 / 12.0;
        
        return f;
    }

    _getFixedEndForcesThermal(E, A, alpha, dT) {
        let f = new Float64Array(12);
        let F_th = E * A * alpha * dT;
        f[0] = -F_th;
        f[6] = F_th;
        return f;
    }

    _calculateElementLocalForces(u_global, caseType) {
        let f_local_elems = {};
        this.elements.forEach(elem => {
            if (String(elem.node_A) === String(elem.node_B)) {
                f_local_elems[elem.id] = new Float64Array(12);
                return;
            }
            let u_elem_global = new Float64Array(12);
            for (let i = 0; i < 12; i++) {
                u_elem_global[i] = u_global[elem.dofs[i]];
            }
            let u_elem_local = this._multiplyVector(elem.T, u_elem_global);
            
            // f_local = k_local * u_local - f_fe
            let k_u = this._multiplyVector(elem.k_local, u_elem_local);
            let f_fe = elem['f_fe_' + caseType];
            
            let f_local = new Float64Array(12);
            for (let i = 0; i < 12; i++) {
                f_local[i] = k_u[i] - f_fe[i];
            }
            f_local_elems[elem.id] = f_local;
        });
        return f_local_elems;
    }

    _calculateCodeStresses() {
        let P = parseFloat(this.loads.global_internal_pressure || 0.0);
        let f_W = this.results.f_local_W;
        let f_T = this.results.f_local_T;
        let f_U = this.results.f_local_U;
        
        this.elements.forEach(elem => {
            if (elem.type === 'hose') {
                elem.compliance = {
                    S_L: 0, S_L_allowable: 1, S_L_ratio: 0,
                    S_E: 0, S_E_allowable: 1, S_E_ratio: 0,
                    S_OL: 0, S_OL_allowable: 1, S_OL_ratio: 0
                };
                return;
            }
            let sec = this.sections[elem.section];
            let mat = this.materials[elem.material];
            
            let i_i_A = elem.i_i_A || 1.0;
            let i_o_A = elem.i_o_A || 1.0;
            let i_i_B = elem.i_i_B || 1.0;
            let i_o_B = elem.i_o_B || 1.0;
            let A = sec.A;
            let Z = sec.Z;
            let OD = sec.OD;
            let t = sec.wall_thickness;
            
            let sigma_pr = (P * OD) / (4.0 * t);
            
            // SUSTAINED
            let f_w = f_W[elem.id];
            
            // Node A
            let S_b_w_A = Math.sqrt((i_i_A * f_w[5])**2 + (i_o_A * f_w[4])**2) / Z;
            let S_a_w_A = Math.abs(f_w[0]) / A;
            let S_L_A = S_b_w_A + S_a_w_A + sigma_pr;
            
            // Node B
            let S_b_w_B = Math.sqrt((i_i_B * f_w[11])**2 + (i_o_B * f_w[10])**2) / Z;
            let S_a_w_B = Math.abs(f_w[6]) / A;
            let S_L_B = S_b_w_B + S_a_w_B + sigma_pr;
            
            let S_L = Math.max(S_L_A, S_L_B);
            
            // EXPANSION
            let f_t = f_T[elem.id];
            
            // Node A
            let S_b_t_A = Math.sqrt((i_i_A * f_t[5])**2 + (i_o_A * f_t[4])**2) / Z;
            let S_t_t_A = Math.abs(f_t[3]) / (2.0 * Z);
            let S_E_A = Math.sqrt(S_b_t_A**2 + 4.0 * S_t_t_A**2);
            
            // Node B
            let S_b_t_B = Math.sqrt((i_i_B * f_t[11])**2 + (i_o_B * f_t[10])**2) / Z;
            let S_t_t_B = Math.abs(f_t[9]) / (2.0 * Z);
            let S_E_B = Math.sqrt(S_b_t_B**2 + 4.0 * S_t_t_B**2);
            
            let S_E = Math.max(S_E_A, S_E_B);
            
            // OCCASIONAL
            let S_OL = 0.0;
            if (this.results.has_occasional) {
                let f_u = f_U[elem.id];
                
                // Node A
                let M_i_occ_A = Math.abs(f_w[5]) + Math.abs(f_u[5]);
                let M_o_occ_A = Math.abs(f_w[4]) + Math.abs(f_u[4]);
                let S_b_occ_A = Math.sqrt((i_i_A * M_i_occ_A)**2 + (i_o_A * M_o_occ_A)**2) / Z;
                let S_a_occ_A = (Math.abs(f_w[0]) + Math.abs(f_u[0])) / A;
                let S_OL_A = S_b_occ_A + S_a_occ_A + sigma_pr;
                
                // Node B
                let M_i_occ_B = Math.abs(f_w[11]) + Math.abs(f_u[11]);
                let M_o_occ_B = Math.abs(f_w[10]) + Math.abs(f_u[10]);
                let S_b_occ_B = Math.sqrt((i_i_B * M_i_occ_B)**2 + (i_o_B * M_o_occ_B)**2) / Z;
                let S_a_occ_B = (Math.abs(f_w[6]) + Math.abs(f_u[6])) / A;
                let S_OL_B = S_b_occ_B + S_a_occ_B + sigma_pr;
                
                S_OL = Math.max(S_OL_A, S_OL_B);
            }
            
            // Allowable stress checking
            let Sc = parseFloat(mat.Sc || mat.yield_strength / 1.5);
            let Sh = parseFloat(mat.Sh || mat.yield_strength / 1.5);
            let S_A = 1.25 * Sc + 0.25 * Sh;
            let S_OL_allow = 1.33 * Sh;
            
            elem.compliance = {
                S_L,
                S_L_allowable: Sh,
                S_L_ratio: S_L / Sh,
                S_E,
                S_E_allowable: S_A,
                S_E_ratio: S_E / S_A,
                S_OL,
                S_OL_allowable: S_OL_allow,
                S_OL_ratio: S_OL / S_OL_allow
            };
        });
    }

    getResultsSummary() {
        let u_W = this.results.displacements_W;
        let u_T = this.results.displacements_T;
        let u_OPE = new Float64Array(this.numDofs);
        for (let i = 0; i < this.numDofs; i++) u_OPE[i] = u_W[i] + u_T[i];
        
        let nodeDisps = {};
        let u_U = this.results.displacements_U;
        this.nodeKeys.forEach((nid, i) => {
            nodeDisps[nid] = {
                Weight: Array.from(u_W.slice(i*6, i*6+6)),
                Thermal: Array.from(u_T.slice(i*6, i*6+6)),
                Operating: Array.from(u_OPE.slice(i*6, i*6+6))
            };
            if (this.results.has_occasional) {
                nodeDisps[nid].Occasional = Array.from(u_U.slice(i*6, i*6+6));
            }
        });
        
        let elementStresses = {};
        let complianceWarning = false;
        
        this.elements.forEach(elem => {
            let comp = elem.compliance;
            let maxRatio = Math.max(comp.S_L_ratio, comp.S_E_ratio);
            if (this.results.has_occasional) {
                maxRatio = Math.max(maxRatio, comp.S_OL_ratio);
            }
            
            if (maxRatio > 1.0) complianceWarning = true;
            
            elementStresses[elem.id] = {
                type: elem.type || 'pipe',
                k_factor: elem.k_factor,
                SIF_in: Math.max(elem.i_i_A || 1.0, elem.i_i_B || 1.0),
                SIF_out: Math.max(elem.i_o_A || 1.0, elem.i_o_B || 1.0),
                sustained_stress: comp.S_L,
                sustained_allowable: comp.S_L_allowable,
                sustained_ratio: comp.S_L_ratio,
                expansion_stress: comp.S_E,
                expansion_allowable: comp.S_E_allowable,
                expansion_ratio: comp.S_E_ratio,
                occasional_stress: comp.S_OL,
                occasional_allowable: comp.S_OL_allowable,
                occasional_ratio: comp.S_OL_ratio,
                max_stress_ratio: maxRatio,
                compliance_pass: maxRatio <= 1.0
            };
        });
        
        return {
            nodes: nodeDisps,
            elements: elementStresses,
            compliance_warning: complianceWarning,
            has_occasional: this.results.has_occasional
        };
    }

    // --- LINEAR SYSTEM SOLVER (GAUSSIAN ELIMINATION WITH PARTIAL PIVOTING) ---
    _solveLinearSystem(K, F) {
        let n = F.length;
        let M = [];
        for (let i = 0; i < n; i++) {
            M[i] = new Float64Array(n + 1);
            for (let j = 0; j < n; j++) {
                M[i][j] = K[i][j];
            }
            M[i][n] = F[i];
        }
        
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            let maxVal = Math.abs(M[i][i]);
            for (let r = i + 1; r < n; r++) {
                if (Math.abs(M[r][i]) > maxVal) {
                    maxVal = Math.abs(M[r][i]);
                    maxRow = r;
                }
            }
            
            if (maxRow !== i) {
                let temp = M[i];
                M[i] = M[maxRow];
                M[maxRow] = temp;
            }
            
            if (Math.abs(M[i][i]) < 1e-18) {
                // To avoid singular matrix crash due to unconstrained node or roundoffs
                M[i][i] = 1e-9;
            }
            
            for (let r = i + 1; r < n; r++) {
                let factor = M[r][i] / M[i][i];
                for (let c = i; c <= n; c++) {
                    M[r][c] -= factor * M[i][c];
                }
            }
        }
        
        let x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let sum = M[i][n];
            for (let j = i + 1; j < n; j++) {
                sum -= M[i][j] * x[j];
            }
            x[i] = sum / M[i][i];
        }
        
        return x;
    }

    // --- MATRIX & VECTOR HELPER FUNCTIONS ---
    _transposeMatrix(A) {
        let r = A.length, c = A[0].length;
        let AT = Array.from({ length: c }, () => new Float64Array(r));
        for (let i = 0; i < r; i++) {
            for (let j = 0; j < c; j++) {
                AT[j][i] = A[i][j];
            }
        }
        return AT;
    }

    _multiplyMatrix(A, B) {
        let rA = A.length, cA = A[0].length, cB = B[0].length;
        let C = Array.from({ length: rA }, () => new Float64Array(cB));
        for (let i = 0; i < rA; i++) {
            for (let j = 0; j < cB; j++) {
                let sum = 0.0;
                for (let k = 0; k < cA; k++) {
                    sum += A[i][k] * B[k][j];
                }
                C[i][j] = sum;
            }
        }
        return C;
    }

    _multiplyVector(A, v) {
        let r = A.length, c = A[0].length;
        let w = new Float64Array(r);
        for (let i = 0; i < r; i++) {
            let sum = 0.0;
            for (let j = 0; j < c; j++) {
                sum += A[i][j] * v[j];
            }
            w[i] = sum;
        }
        return w;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FEASolver;
}
