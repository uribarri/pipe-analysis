// Frontend State and UI Logic for Pipe Stress Analyzer Web App

let modelState = {
    materials: {},
    sections: {},
    nodes: {},
    elements: [],
    boundary_conditions: {},
    loads: {
        global_gravity: [0.0, -9.81, 0.0],
        global_internal_pressure: 2.0e6,
        global_temperature_change: 120.0,
        occasional_g: [0.0, 0.0, 0.0]
    }
};

let activeAnalysisResult = null;
let viewStateMode = "original"; // "original" or "deformed"

// Three.js Globals
let scene, camera, renderer, controls;
let pipeGroup, supportGroup;

// Initialize Web App
window.addEventListener('DOMContentLoaded', () => {
    initThreeJS();
    loadTemplate('system'); // Load 3D piping loop by default
    setupFileLoadHandler();
});

// Setup File Loader for Loading Projects
function setupFileLoadHandler() {
    document.getElementById('load-project-file').addEventListener('change', loadProject);
}

// -------------------------------------------------------------
// THREE.JS VIEWPORT RENDERER
// -------------------------------------------------------------
function initThreeJS() {
    const container = document.getElementById('viewport3d');
    const loadingEl = document.getElementById('three-loading');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8a909d);
    
    // Axes Helper at origin with labels
    const axesHelper = new THREE.AxesHelper(1.5);
    scene.add(axesHelper);
    scene.add(createAxisLabel('X', '#ef4444', new THREE.Vector3(1.6, 0, 0)));
    scene.add(createAxisLabel('Y', '#10b981', new THREE.Vector3(0, 1.6, 0)));
    scene.add(createAxisLabel('Z', '#3b82f6', new THREE.Vector3(0, 0, 1.6)));
    
    // Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(8, 6, 8);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    
    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(10, 20, 10);
    scene.add(dirLight1);
    
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-10, -20, -10);
    scene.add(dirLight2);
    
    // Grid Helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x374151, 0x1f2937);
    gridHelper.position.y = -1;
    scene.add(gridHelper);
    
    // Groups
    pipeGroup = new THREE.Group();
    supportGroup = new THREE.Group();
    scene.add(pipeGroup);
    scene.add(supportGroup);
    
    // Remove loading prompt
    if (loadingEl) loadingEl.remove();
    
    // Handle Resize
    window.addEventListener('resize', onWindowResize);
    
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('viewport3d');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function resetCamera() {
    camera.position.set(8, 6, 8);
    controls.target.set(0, 0, 0);
    controls.update();
}

// -------------------------------------------------------------
// 3D MODEL GEOMETRY GENERATOR
// -------------------------------------------------------------
function render3DModel() {
    // Clear previous elements
    while(pipeGroup.children.length > 0) {
        pipeGroup.remove(pipeGroup.children[0]);
    }
    while(supportGroup.children.length > 0) {
        supportGroup.remove(supportGroup.children[0]);
    }
    
    // Get current node positions (deformed or original)
    const renderNodes = {};
    const scaleFactor = parseFloat(document.getElementById('deformation-scale').value) || 50.0;
    
    Object.keys(modelState.nodes).forEach(nid => {
        let coords = [...modelState.nodes[nid]];
        if (viewStateMode === "deformed" && activeAnalysisResult) {
            let disp = activeAnalysisResult.nodes[nid]?.Operating || [0,0,0];
            coords[0] += disp[0] * scaleFactor;
            coords[1] += disp[1] * scaleFactor;
            coords[2] += disp[2] * scaleFactor;
        }
        renderNodes[nid] = new THREE.Vector3(coords[0], coords[1], coords[2]);
    });
    
    // Identify bend nodes (Node A === Node B and type === 'bend')
    const bendAtNode = {};
    modelState.elements.forEach(elem => {
        if (String(elem.node_A) === String(elem.node_B) && elem.type === 'bend') {
            let sec = modelState.sections[elem.section];
            let od = sec ? parseFloat(sec.OD) : 0.1143;
            bendAtNode[String(elem.node_A)] = parseFloat(elem.bend_radius) || (1.5 * od);
        }
    });

    // Draw pipe elements (only where Node A !== Node B)
    modelState.elements.forEach(elem => {
        if (String(elem.node_A) === String(elem.node_B)) return; // Skipped, rendered below as point component
        
        let p1 = renderNodes[elem.node_A].clone();
        let p2 = renderNodes[elem.node_B].clone();
        if (!p1 || !p2) return;
        
        const sec = modelState.sections[elem.section];
        const pipeRadius = sec ? parseFloat(sec.OD) / 2.0 : 0.05;
        
        // Color mapping based on results
        let pipeColor = 0x6366f1; // Default Indigo
        if (activeAnalysisResult && activeAnalysisResult.elements[elem.id]) {
            let el_res = activeAnalysisResult.elements[elem.id];
            let ratio = el_res.max_stress_ratio;
            if (ratio < 0.5) pipeColor = 0x10b981; // Pass Green
            else if (ratio < 0.9) pipeColor = 0xf59e0b; // Warning Yellow
            else pipeColor = 0xef4444; // Fail Red
        }
        
        const material = new THREE.MeshStandardMaterial({
            color: pipeColor,
            roughness: 0.2,
            metalness: 0.8
        });
        
        const direction = new THREE.Vector3().subVectors(p2, p1);
        const length = direction.length();
        const dirNorm = direction.clone().normalize();
        
        // Shift start/end coordinates if adjacent to node-based bends
        let R_A = bendAtNode[String(elem.node_A)] || 0.0;
        let R_B = bendAtNode[String(elem.node_B)] || 0.0;
        
        if (R_A > 0 && length > R_A) {
            p1.addScaledVector(dirNorm, R_A);
        }
        if (R_B > 0 && length > R_B) {
            p2.addScaledVector(dirNorm, -R_B);
        }
        
        const shiftedDir = new THREE.Vector3().subVectors(p2, p1);
        const shiftedLen = shiftedDir.length();
        const up = new THREE.Vector3(0, 1, 0);
        
        if (elem.type === 'bend') {
            // Draw elbow bend element as Bezier curve
            let controlPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            let tangentA = findTangentDirection(elem.node_A, elem.id, renderNodes);
            let tangentB = findTangentDirection(elem.node_B, elem.id, renderNodes);
            if (tangentA && tangentB) {
                let intersect = intersectLines(p1, tangentA, p2, tangentB);
                if (intersect) controlPoint = intersect;
            }
            const curve = new THREE.QuadraticBezierCurve3(p1, controlPoint, p2);
            const tubeGeo = new THREE.TubeGeometry(curve, 16, pipeRadius, 12, false);
            const mesh = new THREE.Mesh(tubeGeo, material);
            pipeGroup.add(mesh);
            
        } else if (elem.type === 'flange') {
            // Draw straight pipe
            const cylinderGeo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, shiftedLen, 12);
            const pipeMesh = new THREE.Mesh(cylinderGeo, material);
            pipeMesh.position.copy(p1).add(shiftedDir.clone().multiplyScalar(0.5));
            pipeMesh.quaternion.setFromUnitVectors(up, dirNorm);
            pipeGroup.add(pipeMesh);
            
            // Draw Flange Ring (thick disk)
            const flangeRadius = pipeRadius * 1.5;
            const flangeLength = Math.min(shiftedLen * 0.15, 0.05);
            const flangeMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 });
            const flangeMesh = new THREE.Mesh(new THREE.CylinderGeometry(flangeRadius, flangeRadius, flangeLength, 16), flangeMat);
            flangeMesh.position.copy(pipeMesh.position);
            flangeMesh.quaternion.copy(pipeMesh.quaternion);
            pipeGroup.add(flangeMesh);
            
        } else if (elem.type === 'tee') {
            // Draw straight pipe
            const cylinderGeo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, shiftedLen, 12);
            const pipeMesh = new THREE.Mesh(cylinderGeo, material);
            pipeMesh.position.copy(p1).add(shiftedDir.clone().multiplyScalar(0.5));
            pipeMesh.quaternion.setFromUnitVectors(up, dirNorm);
            pipeGroup.add(pipeMesh);
            
            // Draw Tee fitting (sphere) in the middle of the element
            const teeGeo = new THREE.SphereGeometry(pipeRadius * 1.35, 16, 16);
            const teeMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 });
            const teeMesh = new THREE.Mesh(teeGeo, teeMat);
            teeMesh.position.copy(pipeMesh.position);
            pipeGroup.add(teeMesh);
            
        } else if (elem.type === 'valve') {
            // Draw straight pipe
            const cylinderGeo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, shiftedLen, 12);
            const pipeMesh = new THREE.Mesh(cylinderGeo, material);
            pipeMesh.position.copy(p1).add(shiftedDir.clone().multiplyScalar(0.5));
            pipeMesh.quaternion.setFromUnitVectors(up, dirNorm);
            pipeGroup.add(pipeMesh);
            
            // Draw Double Cone (bowtie valve body)
            const coneRadius = pipeRadius * 1.6;
            const coneHeight = Math.min(shiftedLen * 0.3, 0.25);
            const cone1Geo = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
            const cone2Geo = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
            const valveMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.4, metalness: 0.8 });
            
            const cone1 = new THREE.Mesh(cone1Geo, valveMat);
            const cone2 = new THREE.Mesh(cone2Geo, valveMat);
            
            const midPoint = pipeMesh.position.clone();
            const shiftDist = coneHeight / 2.0;
            cone1.position.copy(midPoint).addScaledVector(dirNorm, -shiftDist);
            cone2.position.copy(midPoint).addScaledVector(dirNorm, shiftDist);
            
            let q1 = new THREE.Quaternion().setFromUnitVectors(up, dirNorm);
            let q2 = new THREE.Quaternion().setFromUnitVectors(up, dirNorm.clone().negate());
            cone1.quaternion.copy(q1);
            cone2.quaternion.copy(q2);
            pipeGroup.add(cone1);
            pipeGroup.add(cone2);
            
            // Valve Stem
            const stemHeight = pipeRadius * 3.0;
            const stemRadius = pipeRadius * 0.25;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(stemRadius, stemRadius, stemHeight, 8), valveMat);
            stem.position.copy(midPoint).y += (coneRadius + stemHeight/2.0);
            pipeGroup.add(stem);
            
            // Handwheel
            const wheelGeo = new THREE.TorusGeometry(pipeRadius * 1.2, pipeRadius * 0.15, 8, 24);
            const handwheel = new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 }));
            handwheel.position.copy(stem.position);
            handwheel.position.y += stemHeight/2.0;
            handwheel.rotation.x = Math.PI / 2.0;
            pipeGroup.add(handwheel);
            
        } else if (elem.type === 'hose') {
            // Draw corrugated bellows
            const numConvolutions = 14;
            const ringLength = shiftedLen / numConvolutions;
            for (let i = 0; i < numConvolutions; i++) {
                const isCrest = (i % 2 === 0);
                const r = isCrest ? pipeRadius * 1.35 : pipeRadius * 0.95;
                const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ringLength * 0.95, 12), material);
                ringMesh.position.copy(p1.clone().addScaledVector(dirNorm, (i + 0.5) * ringLength));
                ringMesh.quaternion.setFromUnitVectors(up, dirNorm);
                pipeGroup.add(ringMesh);
            }
            
        } else {
            // Draw straight pipe cylinder
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius, pipeRadius, shiftedLen, 12), material);
            mesh.position.copy(p1).add(shiftedDir.multiplyScalar(0.5));
            mesh.quaternion.setFromUnitVectors(up, dirNorm);
            pipeGroup.add(mesh);
        }
    });

    // Draw point-based Flanges and Valves centered directly at Node A
    modelState.elements.forEach(elem => {
        if (String(elem.node_A) !== String(elem.node_B)) return; // Skipped, already rendered as pipe run element
        
        const p = renderNodes[elem.node_A];
        if (!p) return;
        
        const sec = modelState.sections[elem.section];
        const pipeRadius = sec ? parseFloat(sec.OD) / 2.0 : 0.05;
        
        let dirNorm = new THREE.Vector3(0, 1, 0); // Default vertical
        // Find direction of connected pipes
        let connected = modelState.elements.find(el => 
            String(el.node_A) !== String(el.node_B) && 
            (String(el.node_A) === String(elem.node_A) || String(el.node_B) === String(elem.node_A))
        );
        if (connected) {
            let otherId = String(connected.node_A) === String(elem.node_A) ? connected.node_B : connected.node_A;
            dirNorm.subVectors(renderNodes[otherId], p).normalize();
        }
        
        const up = new THREE.Vector3(0, 1, 0);
        
        if (elem.type === 'flange') {
            const flangeMesh = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 1.5, pipeRadius * 1.5, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 }));
            flangeMesh.position.copy(p);
            flangeMesh.quaternion.setFromUnitVectors(up, dirNorm);
            pipeGroup.add(flangeMesh);
            
        } else if (elem.type === 'tee') {
            const teeGeo = new THREE.SphereGeometry(pipeRadius * 1.35, 16, 16);
            const teeMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 });
            const teeMesh = new THREE.Mesh(teeGeo, teeMat);
            teeMesh.position.copy(p);
            pipeGroup.add(teeMesh);
            
        } else if (elem.type === 'valve') {
            const valveMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.4, metalness: 0.8 });
            const cone1 = new THREE.Mesh(new THREE.ConeGeometry(pipeRadius * 1.6, 0.2, 16), valveMat);
            const cone2 = new THREE.Mesh(new THREE.ConeGeometry(pipeRadius * 1.6, 0.2, 16), valveMat);
            cone1.position.copy(p).addScaledVector(dirNorm, -0.1);
            cone2.position.copy(p).addScaledVector(dirNorm, 0.1);
            cone1.quaternion.setFromUnitVectors(up, dirNorm);
            cone2.quaternion.setFromUnitVectors(up, dirNorm.clone().negate());
            pipeGroup.add(cone1); pipeGroup.add(cone2);
            
            // Stem & Handwheel
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 0.25, pipeRadius * 0.25, pipeRadius * 3, 8), valveMat);
            stem.position.copy(p).y += (pipeRadius * 1.6 + pipeRadius * 1.5);
            pipeGroup.add(stem);
            const wheel = new THREE.Mesh(new THREE.TorusGeometry(pipeRadius * 1.2, pipeRadius * 0.15, 8, 24), new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 }));
            wheel.position.copy(stem.position).y += pipeRadius * 1.5;
            wheel.rotation.x = Math.PI / 2.0;
            pipeGroup.add(wheel);
        }
    });

    // Draw node-based Bends as curved elbows between adjacent runs
    Object.keys(bendAtNode).forEach(nid => {
        let R = bendAtNode[nid];
        let connected = modelState.elements.filter(el => 
            String(el.node_A) !== String(el.node_B) && 
            (String(el.node_A) === String(nid) || String(el.node_B) === String(nid))
        );
        
        if (connected.length >= 2) {
            let el1 = connected[0];
            let el2 = connected[1];
            let p_nid = renderNodes[nid];
            
            let dir1 = getDirectionAway(el1, nid, renderNodes);
            let dir2 = getDirectionAway(el2, nid, renderNodes);
            
            let p_t1 = p_nid.clone().addScaledVector(dir1, R);
            let p_t2 = p_nid.clone().addScaledVector(dir2, R);
            
            let sec = modelState.sections[el1.section];
            let pipeRadius = sec ? parseFloat(sec.OD) / 2.0 : 0.05;
            
            // Color mapping
            let bendColor = 0x10b981; 
            if (activeAnalysisResult && activeAnalysisResult.elements) {
                let is_fail = false;
                connected.forEach(el => {
                    let res = activeAnalysisResult.elements[el.id];
                    if (res && !res.compliance_pass) is_fail = true;
                });
                if (is_fail) bendColor = 0xef4444;
            }
            
            const tubeGeo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p_t1, p_nid, p_t2), 16, pipeRadius, 12, false);
            pipeGroup.add(new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ color: bendColor, roughness: 0.2, metalness: 0.8 })));
        }
    });
    
    // Draw boundary condition Restraint markers
    Object.keys(modelState.boundary_conditions).forEach(nid => {
        const p = renderNodes[nid];
        if (!p) return;
        
        const bc = modelState.boundary_conditions[nid];
        
        // Check if fully fixed (Anchor)
        const isAnchor = bc.tx === true && bc.ty === true && bc.tz === true &&
                         bc.rx === true && bc.ry === true && bc.rz === true;
                         
        if (isAnchor) {
            // Anchor marker: Red pyramid
            const pyramidGeo = new THREE.ConeGeometry(0.18, 0.3, 4);
            const material = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
            const mesh = new THREE.Mesh(pyramidGeo, material);
            mesh.position.copy(p).y -= 0.15;
            supportGroup.add(mesh);
        } else {
            // Spring or roller guides: Blue pyramids/boxes
            const boxGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            const material = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 });
            const mesh = new THREE.Mesh(boxGeo, material);
            mesh.position.copy(p);
            supportGroup.add(mesh);
        }
    });

    // Draw Node Number Labels (High Contrast Badges)
    Object.keys(modelState.nodes).forEach(nid => {
        const p = renderNodes[nid];
        if (!p) return;
        const labelSprite = createNodeLabelSprite(nid, p);
        supportGroup.add(labelSprite);
    });
}

// Find tangent direction of adjacent elements to build the elbow curvature
function findTangentDirection(nodeId, currentElemId, renderNodes) {
    let adjacent = null;
    modelState.elements.forEach(el => {
        if (el.id !== currentElemId) {
            if (String(el.node_B) === String(nodeId)) {
                let pA = renderNodes[el.node_A];
                let pB = renderNodes[el.node_B];
                if (pA && pB) adjacent = new THREE.Vector3().subVectors(pB, pA).normalize();
            } else if (String(el.node_A) === String(nodeId)) {
                let pA = renderNodes[el.node_A];
                let pB = renderNodes[el.node_B];
                if (pA && pB) adjacent = new THREE.Vector3().subVectors(pA, pB).normalize(); // Reverse vector
            }
        }
    });
    return adjacent;
}

// Intersect two 3D lines (shortest distance point) to find the control point of the Bezier curve
function intersectLines(p1, d1, p2, d2) {
    let n = new THREE.Vector3().crossVectors(d1, d2);
    let denominator = n.lengthSq();
    if (denominator < 1e-8) return null; // Parallel lines
    
    let p2_p1 = new THREE.Vector3().subVectors(p2, p1);
    
    // Solve linear system for parameters t1, t2
    let n1 = new THREE.Vector3().crossVectors(p2_p1, d2);
    let t1 = n1.dot(n) / denominator;
    
    return p1.clone().addScaledVector(d1, t1);
}

// -------------------------------------------------------------
// UI COMPLIANCE REPORTS & FORMS POPULATION
// -------------------------------------------------------------
function rebuildInputTables() {
    // Populate Nodes Table & Dropdowns
    const nodeTableBody = document.querySelector('#table-nodes tbody');
    nodeTableBody.innerHTML = "";
    
    const elemNodeA = document.getElementById('element-node-a');
    const elemNodeB = document.getElementById('element-node-b');
    const bcNode = document.getElementById('restraint-node');
    
    elemNodeA.innerHTML = "";
    elemNodeB.innerHTML = "";
    bcNode.innerHTML = "";
    
    Object.keys(modelState.nodes).forEach(nid => {
        const coords = modelState.nodes[nid];
        nodeTableBody.innerHTML += `
            <tr>
                <td>${nid}</td>
                <td>${coords[0].toFixed(3)}</td>
                <td>${coords[1].toFixed(3)}</td>
                <td>${coords[2].toFixed(3)}</td>
                <td class="actions-col">
                    <button class="btn-danger" onclick="deleteNode('${nid}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
        
        elemNodeA.innerHTML += `<option value="${nid}">${nid}</option>`;
        elemNodeB.innerHTML += `<option value="${nid}">${nid}</option>`;
        bcNode.innerHTML += `<option value="${nid}">${nid}</option>`;
    });
    
    // Populate Elements Table
    const elemTableBody = document.querySelector('#table-elements tbody');
    elemTableBody.innerHTML = "";
    modelState.elements.forEach(el => {
        let typeText = el.type;
        if (el.type === 'bend') typeText = `Bend (R=${el.bend_radius}m)`;
        else if (el.type === 'valve') typeText = `Valve (${el.weight}kg)`;
        else if (el.type === 'flange') typeText = `Flange (${el.weight}kg)`;
        else if (el.type === 'tee') typeText = `Tee (${el.weight}kg)`;
        else if (el.type === 'hose') typeText = `Hose (Ax=${(el.k_ax/1e6).toFixed(1)}M)`;
        else typeText = 'Pipe';
        elemTableBody.innerHTML += `
            <tr>
                <td>${el.id}</td>
                <td>${el.node_A}</td>
                <td>${el.node_B}</td>
                <td>${typeText}</td>
                <td>${el.material}</td>
                <td>${el.section}</td>
                <td class="actions-col">
                    <button class="btn-danger" onclick="deleteElement(${el.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
    
    // Populate Materials Table & Dropdowns
    const matTableBody = document.querySelector('#table-materials tbody');
    matTableBody.innerHTML = "";
    const elemMaterial = document.getElementById('element-material');
    elemMaterial.innerHTML = "";
    
    for (let matId in modelState.materials) {
        let mat = modelState.materials[matId];
        matTableBody.innerHTML += `
            <tr>
                <td>${matId}</td>
                <td>${(mat.E / 1e9).toFixed(1)}</td>
                <td>${(mat.Sc / 1e6).toFixed(1)}</td>
                <td>${(mat.Sh / 1e6).toFixed(1)}</td>
                <td class="actions-col">
                    <button class="btn-danger" onclick="deleteMaterial('${matId}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
        elemMaterial.innerHTML += `<option value="${matId}">${matId}</option>`;
    }
    
    // Populate Sections Table & Dropdowns
    const secTableBody = document.querySelector('#table-sections tbody');
    secTableBody.innerHTML = "";
    const elemSection = document.getElementById('element-section');
    elemSection.innerHTML = "";
    
    for (let secId in modelState.sections) {
        let sec = modelState.sections[secId];
        secTableBody.innerHTML += `
            <tr>
                <td>${secId}</td>
                <td>${sec.OD.toFixed(4)}</td>
                <td>${sec.wall_thickness.toFixed(5)}</td>
                <td>${sec.fluid_density.toFixed(1)}</td>
                <td class="actions-col">
                    <button class="btn-danger" onclick="deleteSection('${secId}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
        elemSection.innerHTML += `<option value="${secId}">${secId}</option>`;
    }
    
    // Populate Restraints Table
    const bcTableBody = document.querySelector('#table-restraints tbody');
    bcTableBody.innerHTML = "";
    for (let nid in modelState.boundary_conditions) {
        let bc = modelState.boundary_conditions[nid];
        let trans = [];
        let rot = [];
        
        ['tx', 'ty', 'tz'].forEach(dof => {
            if (bc[dof] === true) trans.push(dof.toUpperCase());
            else if (typeof bc[dof] === 'number') trans.push(`${dof.toUpperCase()}(K=${bc[dof]})`);
        });
        ['rx', 'ry', 'rz'].forEach(dof => {
            if (bc[dof] === true) rot.push(dof.toUpperCase());
        });
        
        bcTableBody.innerHTML += `
            <tr>
                <td>${nid}</td>
                <td>${trans.join(', ') || 'None'}</td>
                <td>${rot.join(', ') || 'None'}</td>
                <td class="actions-col">
                    <button class="btn-danger" onclick="deleteRestraint('${nid}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    }
    
    // Refresh 3D rendering
    render3DModel();
}

// Form Submission Actions
function addNode(e) {
    e.preventDefault();
    let id = document.getElementById('node-id').value.trim();
    let x = parseFloat(document.getElementById('node-x').value);
    let y = parseFloat(document.getElementById('node-y').value);
    let z = parseFloat(document.getElementById('node-z').value);
    
    if (modelState.nodes[id]) {
        alert("Node ID already exists!");
        return;
    }
    modelState.nodes[id] = [x, y, z];
    rebuildInputTables();
    document.getElementById('form-node').reset();
}

function deleteNode(nid) {
    delete modelState.nodes[nid];
    // Delete attached elements
    modelState.elements = modelState.elements.filter(el => String(el.node_A) !== String(nid) && String(el.node_B) !== String(nid));
    // Delete boundary condition
    delete modelState.boundary_conditions[nid];
    rebuildInputTables();
}

function addElement(e) {
    e.preventDefault();
    let id = parseInt(document.getElementById('element-id').value);
    let node_A = document.getElementById('element-node-a').value;
    let node_B = document.getElementById('element-node-b').value;
    let type = document.getElementById('element-type').value;
    let material = document.getElementById('element-material').value;
    let section = document.getElementById('element-section').value;
    
    if (modelState.elements.some(el => el.id === id)) {
        alert("Element ID already exists!");
        return;
    }
    if (node_A === node_B && (type === 'pipe' || type === 'hose')) {
        alert("Pipes and hoses must connect two different nodes!");
        return;
    }
    
    let elem = { id, node_A, node_B, type, material, section };
    
    if (type === 'bend') {
        elem.bend_radius = parseFloat(document.getElementById('element-bend-radius').value);
    } else if (type === 'valve' || type === 'flange' || type === 'tee') {
        elem.weight = parseFloat(document.getElementById('element-weight').value) || 0.0;
    } else if (type === 'hose') {
        elem.k_ax = parseFloat(document.getElementById('element-k-ax').value) || 1e7;
        elem.k_lat = parseFloat(document.getElementById('element-k-lat').value) || 1e5;
    }
    
    modelState.elements.push(elem);
    rebuildInputTables();
    
    // Increment element ID field for convenience
    document.getElementById('element-id').value = id + 1;
}

function deleteElement(id) {
    modelState.elements = modelState.elements.filter(el => el.id !== id);
    rebuildInputTables();
}

function addMaterial(e) {
    e.preventDefault();
    let id = document.getElementById('material-id').value.trim();
    let E = parseFloat(document.getElementById('material-e').value);
    let G = parseFloat(document.getElementById('material-g').value);
    let alpha = parseFloat(document.getElementById('material-alpha').value);
    let yield_strength = parseFloat(document.getElementById('material-yield').value);
    let Sc = parseFloat(document.getElementById('material-sc').value);
    let Sh = parseFloat(document.getElementById('material-sh').value);
    let density = parseFloat(document.getElementById('material-density').value);
    
    modelState.materials[id] = { E, G, alpha, yield_strength, Sc, Sh, density };
    rebuildInputTables();
}

function deleteMaterial(id) {
    delete modelState.materials[id];
    rebuildInputTables();
}

function addSection(e) {
    e.preventDefault();
    let id = document.getElementById('section-id').value.trim();
    let OD = parseFloat(document.getElementById('section-od').value);
    let wall_thickness = parseFloat(document.getElementById('section-thickness').value);
    let fluid_density = parseFloat(document.getElementById('section-fluid-density').value);
    let insulation_thickness = parseFloat(document.getElementById('section-ins-thick').value);
    let insulation_density = parseFloat(document.getElementById('section-ins-density').value);
    
    modelState.sections[id] = { OD, wall_thickness, type: 'pipe', fluid_density, insulation_thickness, insulation_density };
    rebuildInputTables();
}

function deleteSection(id) {
    delete modelState.sections[id];
    rebuildInputTables();
}

function addRestraint(e) {
    e.preventDefault();
    let nid = document.getElementById('restraint-node').value;
    let bc = {};
    
    ['tx', 'ty', 'tz'].forEach(dof => {
        let isRigid = document.getElementById(`restraint-${dof}`).checked;
        if (isRigid) {
            bc[dof] = true;
        } else {
            let stiffVal = parseFloat(document.getElementById(`restraint-${dof}-stiff`).value);
            if (!isNaN(stiffVal)) bc[dof] = stiffVal;
        }
    });
    
    ['rx', 'ry', 'rz'].forEach(dof => {
        if (document.getElementById(`restraint-${dof}`).checked) bc[dof] = true;
    });
    
    modelState.boundary_conditions[nid] = bc;
    rebuildInputTables();
    document.getElementById('form-restraint').reset();
    
    // Disable stiffness fields again
    ['tx', 'ty', 'tz'].forEach(dof => {
        document.getElementById(`restraint-${dof}-stiff`).disabled = true;
    });
}

function deleteRestraint(nid) {
    delete modelState.boundary_conditions[nid];
    rebuildInputTables();
}

function updateLoads(e) {
    e.preventDefault();
    modelState.loads.global_internal_pressure = parseFloat(document.getElementById('load-pressure').value);
    modelState.loads.global_temperature_change = parseFloat(document.getElementById('load-temp-change').value);
    modelState.loads.global_gravity = [
        parseFloat(document.getElementById('load-gx').value),
        parseFloat(document.getElementById('load-gy').value),
        parseFloat(document.getElementById('load-gz').value)
    ];
    modelState.loads.occasional_g = [
        parseFloat(document.getElementById('load-seismic-x').value) || 0.0,
        parseFloat(document.getElementById('load-seismic-y').value) || 0.0,
        parseFloat(document.getElementById('load-seismic-z').value) || 0.0
    ];
    alert("Loads updated successfully!");
}

// Predefined Materials Dropdown Presets
function applyMaterialPreset() {
    const val = document.getElementById('material-presets').value;
    
    let presets = {
        steel_a106: { id: "carbon_steel", E: 2.0e11, G: 7.7e10, alpha: 1.2e-5, yield: 2.5e8, Sc: 1.379e8, Sh: 1.379e8, density: 7850 },
        ss_tp304: { id: "stainless_304", E: 1.93e11, G: 7.44e10, alpha: 1.6e-5, yield: 2.05e8, Sc: 1.379e8, Sh: 1.296e8, density: 8000 },
        alloy_p11: { id: "alloy_p11", E: 2.0e11, G: 7.7e10, alpha: 1.25e-5, yield: 2.05e8, Sc: 1.379e8, Sh: 1.379e8, density: 7850 },
        copper_b88: { id: "copper", E: 1.17e11, G: 4.4e10, alpha: 1.65e-5, yield: 6.2e7, Sc: 6.0e7, Sh: 5.0e7, density: 8900 }
    };
    
    if (presets[val]) {
        let p = presets[val];
        document.getElementById('material-id').value = p.id;
        document.getElementById('material-e').value = p.E;
        document.getElementById('material-g').value = p.G;
        document.getElementById('material-alpha').value = p.alpha;
        document.getElementById('material-yield').value = p.yield;
        document.getElementById('material-sc').value = p.Sc;
        document.getElementById('material-sh').value = p.Sh;
        document.getElementById('material-density').value = p.density;
    }
}

function applySectionPreset() {
    const val = document.getElementById('section-presets').value;
    
    let presets = {
        "nps_0.5_sch40": { id: "nps_0.5_sch40", OD: 0.02134, t: 0.00277 },
        "nps_0.5_sch80": { id: "nps_0.5_sch80", OD: 0.02134, t: 0.00373 },
        "nps_1_sch40": { id: "nps_1_sch40", OD: 0.03340, t: 0.00338 },
        "nps_1_sch80": { id: "nps_1_sch80", OD: 0.03340, t: 0.00455 },
        "nps_2_sch40": { id: "nps_2_sch40", OD: 0.06033, t: 0.00391 },
        "nps_2_sch80": { id: "nps_2_sch80", OD: 0.06033, t: 0.00554 },
        "nps_3_sch40": { id: "nps_3_sch40", OD: 0.08890, t: 0.00549 },
        "nps_3_sch80": { id: "nps_3_sch80", OD: 0.08890, t: 0.00762 },
        "nps_4_sch40": { id: "nps_4_sch40", OD: 0.11430, t: 0.00602 },
        "nps_4_sch80": { id: "nps_4_sch80", OD: 0.11430, t: 0.00856 },
        "nps_6_sch40": { id: "nps_6_sch40", OD: 0.16828, t: 0.00711 },
        "nps_6_sch80": { id: "nps_6_sch80", OD: 0.16828, t: 0.01097 },
        "nps_8_sch40": { id: "nps_8_sch40", OD: 0.21908, t: 0.00818 },
        "nps_8_sch80": { id: "nps_8_sch80", OD: 0.21908, t: 0.01270 },
        "nps_10_sch40": { id: "nps_10_sch40", OD: 0.27305, t: 0.00927 },
        "nps_10_sch80": { id: "nps_10_sch80", OD: 0.27305, t: 0.01509 },
        "nps_12_sch40": { id: "nps_12_sch40", OD: 0.32385, t: 0.01031 },
        "nps_12_sch80": { id: "nps_12_sch80", OD: 0.32385, t: 0.01748 }
    };
    
    if (presets[val]) {
        let p = presets[val];
        document.getElementById('section-id').value = p.id;
        document.getElementById('section-od').value = p.OD;
        document.getElementById('section-thickness').value = p.t;
    }
}

function toggleStiffnessField(dof) {
    let checked = document.getElementById(`restraint-${dof}`).checked;
    document.getElementById(`restraint-${dof}-stiff`).disabled = checked;
    if (checked) document.getElementById(`restraint-${dof}-stiff`).value = "";
}

function toggleElementFields() {
    let type = document.getElementById('element-type').value;
    document.getElementById('bend-radius-field').style.display = type === 'bend' ? 'block' : 'none';
    document.getElementById('element-weight-field').style.display = (type === 'valve' || type === 'flange' || type === 'tee') ? 'block' : 'none';
    document.getElementById('element-hose-fields').style.display = type === 'hose' ? 'block' : 'none';
}

// -------------------------------------------------------------
// FEA SOLVER INTEGRATION & DISSIMULATION
// -------------------------------------------------------------
function runAnalysis() {
    if (Object.keys(modelState.nodes).length === 0 || modelState.elements.length === 0) {
        alert("Please define nodes and elements first!");
        return;
    }
    
    console.log("Assembling stiffness matrix and running linear solver...");
    
    try {
        const solver = new FEASolver(modelState);
        solver.solve();
        activeAnalysisResult = solver.getResultsSummary();
        
        console.log("Analysis completed successfully!");
        populateResultsDashboard();
        
        // Automatically switch view to deformed mesh with compliance colors
        viewStateMode = "deformed";
        document.getElementById('view-state').value = "deformed";
        document.getElementById('scale-control').style.display = "flex";
        
        render3DModel();
    } catch(err) {
        console.error(err);
        alert(`Analysis Error: ${err.message}`);
    }
}

function populateResultsDashboard() {
    const res = activeAnalysisResult;
    if (!res) return;
    
    // Status Badge
    const badge = document.getElementById('status-badge');
    if (res.compliance_warning) {
        badge.className = "badge badge-fail";
        badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Over-stressed';
    } else {
        badge.className = "badge badge-pass";
        badge.innerHTML = '<i class="fa-solid fa-check"></i> Code Compliant';
    }
    
    // Dashboard KPIs
    document.getElementById('overview-prompt').style.display = "none";
    document.getElementById('dashboard-grid').style.display = "grid";
    
    let maxRatio = 0.0;
    let maxSusStress = 0.0;
    let maxExpStress = 0.0;
    let maxSusAllow = 0.0;
    let maxExpAllow = 0.0;
    
    for (let eid in res.elements) {
        let el = res.elements[eid];
        maxRatio = Math.max(maxRatio, el.max_stress_ratio);
        if (el.sustained_stress > maxSusStress) {
            maxSusStress = el.sustained_stress;
            maxSusAllow = el.sustained_allowable;
        }
        if (el.expansion_stress > maxExpStress) {
            maxExpStress = el.expansion_stress;
            maxExpAllow = el.expansion_allowable;
        }
    }
    
    const kpiRatio = document.getElementById('kpi-max-ratio');
    kpiRatio.innerHTML = maxRatio.toFixed(2);
    kpiRatio.className = "kpi-num " + (maxRatio > 1.0 ? "fail-badge" : "pass-badge");
    
    document.getElementById('kpi-sus-stress').innerHTML = (maxSusStress / 1e6).toFixed(2) + " MPa";
    document.getElementById('kpi-sus-allow').innerHTML = "Allowable: " + (maxSusAllow / 1e6).toFixed(2) + " MPa";
    
    document.getElementById('kpi-exp-stress').innerHTML = (maxExpStress / 1e6).toFixed(2) + " MPa";
    document.getElementById('kpi-exp-allow').innerHTML = "Allowable: " + (maxExpAllow / 1e6).toFixed(2) + " MPa";
    
    // Element Stress Table
    const stressTableBody = document.querySelector('#table-results-stresses tbody');
    stressTableBody.innerHTML = "";
    for (let eid in res.elements) {
        let el = res.elements[eid];
        let tag = el.compliance_pass ? '<span class="tag-pass">Pass</span>' : '<span class="tag-fail">Fail</span>';
        let sif_str = `${el.SIF_in.toFixed(2)} / ${el.SIF_out.toFixed(2)}`;
        
        stressTableBody.innerHTML += `
            <tr>
                <td>${eid}</td>
                <td>${el.type.toUpperCase()}</td>
                <td>${sif_str}</td>
                <td>${(el.sustained_stress / 1e6).toFixed(2)}</td>
                <td style="color: ${varRatioColor(el.sustained_ratio)}">${el.sustained_ratio.toFixed(2)}</td>
                <td>${(el.expansion_stress / 1e6).toFixed(2)}</td>
                <td style="color: ${varRatioColor(el.expansion_ratio)}">${el.expansion_ratio.toFixed(2)}</td>
                <td>${tag}</td>
            </tr>
        `;
    }
    
    // Node Displacements Table
    const dispTableBody = document.querySelector('#table-results-displacements tbody');
    dispTableBody.innerHTML = "";
    for (let nid in res.nodes) {
        let cases = res.nodes[nid];
        for (let caseName in cases) {
            let d = cases[caseName];
            dispTableBody.innerHTML += `
                <tr>
                    <td><strong>${nid}</strong></td>
                    <td class="text-secondary">${caseName}</td>
                    <td>${(d[0]*1000).toFixed(3)}</td>
                    <td>${(d[1]*1000).toFixed(3)}</td>
                    <td>${(d[2]*1000).toFixed(3)}</td>
                    <td>${(d[3]*180/Math.PI).toFixed(4)}</td>
                    <td>${(d[4]*180/Math.PI).toFixed(4)}</td>
                    <td>${(d[5]*180/Math.PI).toFixed(4)}</td>
                </tr>
            `;
        }
    }
    
    // Force results-tab-btn glow if over-stressed
    const stressTabBtn = document.getElementById('stress-tab-btn');
    if (res.compliance_warning) {
        stressTabBtn.style.color = "var(--color-fail)";
    } else {
        stressTabBtn.style.color = "";
    }
}

function varRatioColor(ratio) {
    if (ratio < 0.5) return "var(--color-pass)";
    else if (ratio < 0.9) return "var(--color-warning)";
    else return "var(--color-fail)";
}

// -------------------------------------------------------------
// UI INTERACTION EVENT HANDLERS
// -------------------------------------------------------------
function switchSidebarTab(tabId) {
    document.querySelectorAll('.sidebar-tabs .nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.sidebar-content .tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // Make active
    event.currentTarget.classList.add('active');
    document.getElementById('panel-' + tabId).classList.add('active');
}

function switchResultsTab(tabId) {
    document.querySelectorAll('.results-header .res-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.results-content .res-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    event.currentTarget.classList.add('active');
    document.getElementById('res-' + tabId).classList.add('active');
}

function toggleDeformedMesh() {
    viewStateMode = document.getElementById('view-state').value;
    document.getElementById('scale-control').style.display = viewStateMode === 'deformed' ? 'flex' : 'none';
    render3DModel();
}

function updateDeformedMesh() {
    const val = document.getElementById('deformation-scale').value;
    document.getElementById('scale-value').innerHTML = val + "x";
    render3DModel();
}

// -------------------------------------------------------------
// TEMPLATES AND PROJECT SAVE/LOAD
// -------------------------------------------------------------
function loadTemplatePreset() {
    const val = document.getElementById('benchmark-templates').value;
    if (val) loadTemplate(val);
}

function loadTemplate(name) {
    activeAnalysisResult = null;
    document.getElementById('view-state').value = "original";
    viewStateMode = "original";
    document.getElementById('scale-control').style.display = "none";
    document.getElementById('status-badge').className = "badge badge-neutral";
    document.getElementById('status-badge').innerHTML = "Solve Pending";
    document.getElementById('dashboard-grid').style.display = "none";
    document.getElementById('overview-prompt').style.display = "flex";
    
    let defaultLoads = {
        global_gravity: [0.0, -9.81, 0.0],
        global_internal_pressure: 0.0,
        global_temperature_change: 0.0,
        occasional_g: [0.0, 0.0, 0.0]
    };
    
    let defaultMat = {
        carbon_steel: { E: 2.0e11, G: 7.7e10, alpha: 1.2e-5, yield_strength: 2.5e8, Sc: 1.379e8, Sh: 1.379e8, density: 7850 }
    };
    
    let defaultSec = {
        sec1: { OD: 0.1143, wall_thickness: 0.00602, type: 'pipe', fluid_density: 0.0, insulation_thickness: 0.0, insulation_density: 0.0 }
    };

    if (name === 'cantilever') {
        modelState = {
            materials: {...defaultMat},
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [2.0, 0.0, 0.0]
            },
            elements: [
                { id: 0, node_A: "0", node_B: "1", type: "pipe", material: "carbon_steel", section: "sec1" }
            ],
            boundary_conditions: {
                "0": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true }
            },
            loads: {
                ...defaultLoads,
                nodes: {
                    "1": { Fx: 0, Fy: -5000, Fz: 0, Mx: 0, My: 0, Mz: 0 }
                }
            }
        };
        // Reset density to 0.0 for exact point load comparison
        modelState.materials.carbon_steel.density = 0.0;
        
    } else if (name === 'thermal') {
        modelState = {
            materials: {
                carbon_steel: { E: 2.0e11, G: 7.7e10, alpha: 1.2e-5, yield_strength: 2.5e8, Sc: 1.379e8, Sh: 1.379e8, density: 0 }
            },
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [2.0, 0.0, 0.0]
            },
            elements: [
                { id: 0, node_A: "0", node_B: "1", type: "pipe", material: "carbon_steel", section: "sec1" }
            ],
            boundary_conditions: {
                "0": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true },
                "1": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true }
            },
            loads: {
                ...defaultLoads,
                global_temperature_change: 100.0
            }
        };
        
    } else if (name === 'lbend') {
        modelState = {
            materials: {
                carbon_steel: { E: 2.0e11, G: 7.7e10, alpha: 1.2e-5, yield_strength: 2.5e8, Sc: 1.379e8, Sh: 1.379e8, density: 0 }
            },
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [5.0, 0.0, 0.0],
                "2": [5.0, 4.0, 0.0]
            },
            elements: [
                { id: 0, node_A: "0", node_B: "1", type: "pipe", material: "carbon_steel", section: "sec1" },
                { id: 1, node_A: "1", node_B: "2", type: "pipe", material: "carbon_steel", section: "sec1" }
            ],
            boundary_conditions: {
                "0": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true },
                "2": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true }
            },
            loads: {
                ...defaultLoads,
                global_temperature_change: 150.0
            }
        };
        
    } else if (name === 'system') {
        // Detailed 3D loop template
        modelState = {
            materials: {
                carbon_steel: { E: 2.0e11, G: 7.7e10, alpha: 1.2e-5, yield_strength: 2.5e8, Sc: 1.379e8, Sh: 1.379e8, density: 7850 }
            },
            sections: {
                nps_4: { OD: 0.1143, wall_thickness: 0.00602, type: 'pipe', fluid_density: 1000.0, insulation_thickness: 0.025, insulation_density: 200.0 }
            },
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [3.0, 0.0, 0.0],
                "2": [3.0, 3.0, 0.0],
                "3": [5.0, 3.0, 0.0],
                "4": [5.0, 3.0, 2.0]
            },
            elements: [
                { id: 0, node_A: "0", node_B: "1", type: "pipe", material: "carbon_steel", section: "nps_4" },
                { id: 1, node_A: "1", node_B: "2", type: "bend", bend_radius: 0.17145, material: "carbon_steel", section: "nps_4" },
                { id: 2, node_A: "2", node_B: "3", type: "pipe", material: "carbon_steel", section: "nps_4" },
                { id: 3, node_A: "3", node_B: "4", type: "pipe", material: "carbon_steel", section: "nps_4" }
            ],
            boundary_conditions: {
                "0": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true },
                "4": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true }
            },
            loads: {
                ...defaultLoads,
                global_internal_pressure: 2.0e6,
                global_temperature_change: 130.0
            }
        };
    }
    
    // Set input form element ID sequence
    let maxId = -1;
    modelState.elements.forEach(el => {
        if (el.id > maxId) maxId = el.id;
    });
    document.getElementById('element-id').value = maxId + 1;
    
    // Set Loads form fields
    document.getElementById('load-pressure').value = modelState.loads.global_internal_pressure;
    document.getElementById('load-temp-change').value = modelState.loads.global_temperature_change;
    document.getElementById('load-gx').value = modelState.loads.global_gravity[0];
    document.getElementById('load-gy').value = modelState.loads.global_gravity[1];
    document.getElementById('load-gz').value = modelState.loads.global_gravity[2];
    document.getElementById('load-seismic-x').value = modelState.loads.occasional_g[0];
    document.getElementById('load-seismic-y').value = modelState.loads.occasional_g[1];
    document.getElementById('load-seismic-z').value = modelState.loads.occasional_g[2];
    
    rebuildInputTables();
    
    // Adjust camera view fits models
    if (controls) {
        if (name === 'system' || name === 'lbend') {
            camera.position.set(8, 7, 8);
            controls.target.set(2.5, 1.5, 0.5);
        } else {
            camera.position.set(4, 3, 4);
            controls.target.set(1.0, 0, 0);
        }
        controls.update();
    }
}

function exportProject() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(modelState, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "piping_project.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function loadProject(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            if (!parsed.nodes || !parsed.elements) {
                throw new Error("Invalid project structure: Missing nodes/elements.");
            }
            modelState = parsed;
            activeAnalysisResult = null;
            rebuildInputTables();
            alert("Project loaded successfully!");
        } catch(err) {
            alert(`Failed to load project: ${err.message}`);
        }
    };
    reader.readAsText(file);
}

function getDirectionAway(el, nid, renderNodes) {
    let otherId = String(el.node_A) === String(nid) ? el.node_B : el.node_A;
    let p_nid = renderNodes[nid];
    let p_other = renderNodes[otherId];
    return new THREE.Vector3().subVectors(p_other, p_nid).normalize();
}

function createNodeLabelSprite(text, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Draw white circular badge with blue border
    const radius = 22;
    ctx.beginPath();
    ctx.arc(32, 32, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3b82f6';
    ctx.stroke();
    
    // Draw text inside
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(spriteMat);
    
    sprite.scale.set(0.3, 0.3, 1);
    
    sprite.position.copy(position);
    sprite.position.y += 0.22;
    sprite.position.x += 0.12;
    sprite.renderOrder = 999;
    
    return sprite;
}

function createAxisLabel(text, color, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    
    ctx.font = 'bold 24px Inter, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16, 16);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.2, 0.2, 1);
    sprite.position.copy(position);
    sprite.renderOrder = 1000;
    return sprite;
}
