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
let pipeGroup, supportGroup, nodeLabelGroup, gridHelper;

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
    const axesHelper = new THREE.AxesHelper(5.0);
    scene.add(axesHelper);
    scene.add(createAxisLabel('X', '#ef4444', new THREE.Vector3(5.5, 0, 0)));
    scene.add(createAxisLabel('Y', '#10b981', new THREE.Vector3(0, 5.5, 0)));
    scene.add(createAxisLabel('Z', '#3b82f6', new THREE.Vector3(0, 0, 5.5)));
    
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
    
    // Dynamically rebuild grid helper to underlie the entire piping model
    if (gridHelper) {
        scene.remove(gridHelper);
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let nodeKeys = Object.keys(renderNodes);
    if (nodeKeys.length > 0) {
        nodeKeys.forEach(nid => {
            const p = renderNodes[nid];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        });
        
        let sizeX = maxX - minX;
        let sizeZ = maxZ - minZ;
        let maxDim = Math.max(sizeX, sizeZ, 20); // Minimum size of 20
        let gridSize = Math.ceil(maxDim * 1.6 / 10) * 10; // Rounded up to nearest 10
        let divisions = gridSize; // 1 unit grid lines
        
        gridHelper = new THREE.GridHelper(gridSize, divisions, 0x374151, 0x1f2937);
        gridHelper.position.x = (minX + maxX) / 2;
        gridHelper.position.z = (minZ + maxZ) / 2;
        gridHelper.position.y = minY - 2.0; // Place 2 units below the lowest node
        scene.add(gridHelper);
    } else {
        gridHelper = new THREE.GridHelper(20, 20, 0x374151, 0x1f2937);
        gridHelper.position.y = -1;
        scene.add(gridHelper);
    }
    
    // Identify bend nodes (Node A === Node B and type === 'bend')
    const bendAtNode = {};
    modelState.elements.forEach(elem => {
        if (String(elem.node_A) === String(elem.node_B) && elem.type === 'bend') {
            let sec = modelState.sections[elem.section];
            let od = sec ? parseFloat(sec.OD) : 4.5;
            let r_in = parseFloat(elem.bend_radius) || (1.5 * od);
            bendAtNode[String(elem.node_A)] = r_in / 12.0; // Convert to feet
        }
    });

    // Draw pipe elements (only where Node A !== Node B)
    modelState.elements.forEach(elem => {
        if (String(elem.node_A) === String(elem.node_B)) return; // Skipped, rendered below as point component
        
        let p1 = renderNodes[elem.node_A].clone();
        let p2 = renderNodes[elem.node_B].clone();
        if (!p1 || !p2) return;
        
        const sec = modelState.sections[elem.section];
        const pipeRadius = sec ? (parseFloat(sec.OD) / 12.0) / 2.0 : 0.1875;
        
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
            const flangeLength = Math.min(shiftedLen * 0.15, pipeRadius * 0.4);
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
            const coneHeight = Math.min(shiftedLen * 0.3, pipeRadius * 1.5);
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
        const pipeRadius = sec ? (parseFloat(sec.OD) / 12.0) / 2.0 : 0.1875;
        
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
            const flangeMesh = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 1.5, pipeRadius * 1.5, pipeRadius * 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 }));
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
            const valveLength = pipeRadius * 2.0;
            const cone1 = new THREE.Mesh(new THREE.ConeGeometry(pipeRadius * 1.6, valveLength / 2.0, 16), valveMat);
            const cone2 = new THREE.Mesh(new THREE.ConeGeometry(pipeRadius * 1.6, valveLength / 2.0, 16), valveMat);
            cone1.position.copy(p).addScaledVector(dirNorm, -valveLength / 4.0);
            cone2.position.copy(p).addScaledVector(dirNorm, valveLength / 4.0);
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
            let pipeRadius = sec ? (parseFloat(sec.OD) / 12.0) / 2.0 : 0.1875;
            
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
        
        if (bc.type === 'rod_hanger') {
            // Gray vertical rod extending upward
            const rodGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8);
            const rodMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.8, roughness: 0.2 });
            const rod = new THREE.Mesh(rodGeo, rodMat);
            rod.position.copy(p);
            rod.position.y += 0.6; // shift up
            supportGroup.add(rod);
            
            // Top clamp attachment
            const clampGeo = new THREE.SphereGeometry(0.06, 8, 8);
            const clampMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4 });
            const clamp = new THREE.Mesh(clampGeo, clampMat);
            clamp.position.copy(p);
            clamp.position.y += 1.2;
            supportGroup.add(clamp);
        } else if (bc.type === 'variable_spring') {
            // Green spring housing
            const housingGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 12);
            const housingMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.4 });
            const housing = new THREE.Mesh(housingGeo, housingMat);
            housing.position.copy(p);
            housing.position.y += 0.7;
            supportGroup.add(housing);
            
            // Connecting rod
            const rodGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);
            const rodMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8, roughness: 0.2 });
            const rod = new THREE.Mesh(rodGeo, rodMat);
            rod.position.copy(p);
            rod.position.y += 0.2;
            supportGroup.add(rod);
        } else if (bc.type === 'constant_hanger') {
            // Orange rectangular housing
            const housingGeo = new THREE.BoxGeometry(0.24, 0.4, 0.24);
            const housingMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4 });
            const housing = new THREE.Mesh(housingGeo, housingMat);
            housing.position.copy(p);
            housing.position.y += 0.8;
            supportGroup.add(housing);
            
            // Connecting rod
            const rodGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8);
            const rodMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8, roughness: 0.2 });
            const rod = new THREE.Mesh(rodGeo, rodMat);
            rod.position.copy(p);
            rod.position.y += 0.3;
            supportGroup.add(rod);
        } else if (bc.type === 'snubber') {
            // Snubber: cylinder along the active axis
            const axis = bc.axis || 'y';
            const cylinderGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
            const cylinderMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.9, roughness: 0.1 });
            const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat);
            
            cylinder.position.copy(p);
            if (axis === 'x') {
                cylinder.rotation.z = Math.PI / 2.0;
                cylinder.position.x += 0.4;
            } else if (axis === 'z') {
                cylinder.rotation.x = Math.PI / 2.0;
                cylinder.position.z += 0.4;
            } else {
                cylinder.position.y += 0.4;
            }
            supportGroup.add(cylinder);
            
            // Back plate/wall attachment
            const plateGeo = new THREE.BoxGeometry(0.15, 0.15, 0.02);
            const plateMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.5 });
            const plate = new THREE.Mesh(plateGeo, plateMat);
            plate.position.copy(p);
            if (axis === 'x') {
                plate.rotation.y = Math.PI / 2.0;
                plate.position.x += 0.8;
            } else if (axis === 'z') {
                plate.position.z += 0.8;
            } else {
                plate.rotation.x = Math.PI / 2.0;
                plate.position.y += 0.8;
            }
            supportGroup.add(plate);
        } else {
            // Standard/Custom boundary conditions
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
        if (el.type === 'bend') typeText = `Bend (R=${el.bend_radius}in)`;
        else if (el.type === 'valve') typeText = `Valve (${el.weight}lb)`;
        else if (el.type === 'flange') typeText = `Flange (${el.weight}lb)`;
        else if (el.type === 'tee') typeText = `Tee (${el.weight}lb)`;
        else if (el.type === 'hose') typeText = `Hose (Ax=${el.k_ax} lb/in)`;
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
                <td>${(mat.E / 1e6).toFixed(1)}</td>
                <td>${mat.Sc.toFixed(0)}</td>
                <td>${mat.Sh.toFixed(0)}</td>
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
        let odNum = parseFloat(sec.OD) || 0;
        let thkNum = parseFloat(sec.wall_thickness) || 0;
        let fluidNum = parseFloat(sec.fluid_density) || 0;
        secTableBody.innerHTML += `
            <tr>
                <td>${secId}</td>
                <td>${odNum.toFixed(3)}</td>
                <td>${thkNum.toFixed(3)}</td>
                <td>${fluidNum.toFixed(1)}</td>
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
        if (!modelState.boundary_conditions.hasOwnProperty(nid)) continue;
        let bc = modelState.boundary_conditions[nid];
        let trans = [];
        let rot = [];
        
        if (bc.type === 'rod_hanger') {
            trans.push("Rigid Rod Hanger (Y)");
        } else if (bc.type === 'variable_spring') {
            trans.push(`Var Spring (K=${bc.ty} lb/in, Preload=${bc.preload} lb)`);
        } else if (bc.type === 'constant_hanger') {
            trans.push(`Constant Support (Force=${bc.force} lb)`);
        } else if (bc.type === 'snubber') {
            trans.push(`Seismic Snubber (${bc.axis.toUpperCase()})`);
        } else {
            ['tx', 'ty', 'tz'].forEach(dof => {
                if (bc[dof] === true) trans.push(dof.toUpperCase());
                else if (typeof bc[dof] === 'number') trans.push(`${dof.toUpperCase()}(K=${bc[dof]} lb/in)`);
            });
            ['rx', 'ry', 'rz'].forEach(dof => {
                if (bc[dof] === true) rot.push(dof.toUpperCase());
            });
        }
        
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
    let type = document.getElementById('restraint-type').value;
    let bc = { type: type };
    
    if (type === 'custom') {
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
    } else if (type === 'rod_hanger') {
        bc.ty = true; // rigid vertical Y
    } else if (type === 'variable_spring') {
        bc.ty = parseFloat(document.getElementById('spring-rate').value) || 100.0;
        bc.preload = parseFloat(document.getElementById('spring-preload').value) || 0.0;
    } else if (type === 'constant_hanger') {
        bc.force = parseFloat(document.getElementById('constant-force').value) || 0.0;
    } else if (type === 'snubber') {
        bc.axis = document.getElementById('snubber-axis').value || 'y';
    }
    
    modelState.boundary_conditions[nid] = bc;
    rebuildInputTables();
    
    document.getElementById('form-restraint').reset();
    document.getElementById('restraint-type').value = 'custom';
    toggleRestraintTypeFields();
    
    // Disable stiffness fields again
    ['tx', 'ty', 'tz'].forEach(dof => {
        document.getElementById(`restraint-${dof}-stiff`).disabled = true;
    });
}

function toggleRestraintTypeFields() {
    let type = document.getElementById('restraint-type').value;
    document.getElementById('restraint-custom-fields').style.display = type === 'custom' ? 'grid' : 'none';
    document.getElementById('restraint-variable-spring-fields').style.display = type === 'variable_spring' ? 'grid' : 'none';
    document.getElementById('restraint-constant-fields').style.display = type === 'constant_hanger' ? 'grid' : 'none';
    document.getElementById('restraint-snubber-fields').style.display = type === 'snubber' ? 'grid' : 'none';
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
        steel_a106: { id: "carbon_steel", E: 2.9e7, G: 1.12e7, alpha: 6.5e-6, yield: 35000, Sc: 20000, Sh: 20000, density: 490 },
        ss_tp304: { id: "stainless_304", E: 2.8e7, G: 1.08e7, alpha: 8.89e-6, yield: 29700, Sc: 20000, Sh: 18800, density: 500 },
        alloy_p11: { id: "alloy_p11", E: 2.9e7, G: 1.12e7, alpha: 6.94e-6, yield: 30000, Sc: 20000, Sh: 20000, density: 490 },
        copper_b88: { id: "copper", E: 1.7e7, G: 6.4e6, alpha: 9.17e-6, yield: 9000, Sc: 8700, Sh: 7200, density: 556 }
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
        "nps_0.5_sch40": { id: "nps_0.5_sch40", OD: 0.840, t: 0.109 },
        "nps_0.5_sch80": { id: "nps_0.5_sch80", OD: 0.840, t: 0.147 },
        "nps_1_sch40": { id: "nps_1_sch40", OD: 1.315, t: 0.133 },
        "nps_1_sch80": { id: "nps_1_sch80", OD: 1.315, t: 0.179 },
        "nps_2_sch40": { id: "nps_2_sch40", OD: 2.375, t: 0.154 },
        "nps_2_sch80": { id: "nps_2_sch80", OD: 2.375, t: 0.218 },
        "nps_3_sch40": { id: "nps_3_sch40", OD: 3.500, t: 0.216 },
        "nps_3_sch80": { id: "nps_3_sch80", OD: 3.500, t: 0.300 },
        "nps_4_sch40": { id: "nps_4_sch40", OD: 4.500, t: 0.237 },
        "nps_4_sch80": { id: "nps_4_sch80", OD: 4.500, t: 0.337 },
        "nps_6_sch40": { id: "nps_6_sch40", OD: 6.625, t: 0.280 },
        "nps_6_sch80": { id: "nps_6_sch80", OD: 6.625, t: 0.432 },
        "nps_8_sch40": { id: "nps_8_sch40", OD: 8.625, t: 0.322 },
        "nps_8_sch80": { id: "nps_8_sch80", OD: 8.625, t: 0.500 },
        "nps_10_sch40": { id: "nps_10_sch40", OD: 10.750, t: 0.365 },
        "nps_10_sch80": { id: "nps_10_sch80", OD: 10.750, t: 0.593 },
        "nps_12_sch40": { id: "nps_12_sch40", OD: 12.750, t: 0.406 },
        "nps_12_sch80": { id: "nps_12_sch80", OD: 12.750, t: 0.688 }
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
        // Deep copy modelState to convert from English to Metric (SI) for the solver
        const solverInput = JSON.parse(JSON.stringify(modelState));
        
        // 1. Convert Nodes: ft -> m
        Object.keys(solverInput.nodes).forEach(nid => {
            solverInput.nodes[nid] = solverInput.nodes[nid].map(x => x * 0.3048);
        });
        
        // 2. Convert Materials: E, G, yield_strength, Sc, Sh (psi -> Pa), alpha (1/F -> 1/C), density (lb/ft³ -> kg/m³)
        Object.keys(solverInput.materials).forEach(matId => {
            let mat = solverInput.materials[matId];
            mat.E = mat.E * 6894.757;
            mat.G = mat.G * 6894.757;
            mat.alpha = mat.alpha * 1.8;
            mat.yield_strength = mat.yield_strength * 6894.757;
            mat.Sc = mat.Sc * 6894.757;
            mat.Sh = mat.Sh * 6894.757;
            mat.density = mat.density * 16.018463;
        });
        
        // 3. Convert Sections: OD, wall_thickness, insulation_thickness (in -> m), densities (lb/ft³ -> kg/m³)
        Object.keys(solverInput.sections).forEach(secId => {
            let sec = solverInput.sections[secId];
            sec.OD = sec.OD * 0.0254;
            sec.wall_thickness = sec.wall_thickness * 0.0254;
            sec.fluid_density = sec.fluid_density * 16.018463;
            sec.insulation_thickness = sec.insulation_thickness * 0.0254;
            sec.insulation_density = sec.insulation_density * 16.018463;
        });
        
        // 4. Convert Elements: bend_radius (in -> m), weight (lb -> kg), k_ax, k_lat (lb/in -> N/m)
        solverInput.elements.forEach(elem => {
            if (elem.type === 'bend') {
                elem.bend_radius = elem.bend_radius * 0.0254;
            } else if (elem.type === 'valve' || elem.type === 'flange' || elem.type === 'tee') {
                elem.weight = elem.weight * 0.45359237;
            } else if (elem.type === 'hose') {
                elem.k_ax = elem.k_ax * 175.1268;
                elem.k_lat = elem.k_lat * 175.1268;
            }
        });
        
        // 5. Convert Boundary Conditions: tx, ty, tz (lb/in -> N/m)
        Object.keys(solverInput.boundary_conditions).forEach(nid => {
            let bc = solverInput.boundary_conditions[nid];
            if (bc.type === 'variable_spring') {
                if (typeof bc.ty === 'number') bc.ty = bc.ty * 175.1268;
                if (typeof bc.preload === 'number') bc.preload = bc.preload * 4.4482216;
            } else if (bc.type === 'constant_hanger') {
                if (typeof bc.force === 'number') bc.force = bc.force * 4.4482216;
            } else if (bc.type === 'snubber' || bc.type === 'rod_hanger') {
                // Snubber and rod hanger do not require numerical scaling of stiffness
            } else {
                ['tx', 'ty', 'tz'].forEach(dof => {
                    if (typeof bc[dof] === 'number') {
                        bc[dof] = bc[dof] * 175.1268;
                    }
                });
            }
        });
        
        // 6. Convert Loads: pressure (psi -> Pa), temp change (F -> C), gravity (ft/s² -> m/s²), point loads (lb -> N, ft-lb -> N-m)
        if (solverInput.loads) {
            solverInput.loads.global_internal_pressure = (solverInput.loads.global_internal_pressure || 0.0) * 6894.757;
            solverInput.loads.global_temperature_change = (solverInput.loads.global_temperature_change || 0.0) / 1.8;
            if (solverInput.loads.global_gravity) {
                solverInput.loads.global_gravity = solverInput.loads.global_gravity.map(x => x * 0.3048);
            }
            if (solverInput.loads.nodes) {
                Object.keys(solverInput.loads.nodes).forEach(nid => {
                    let load = solverInput.loads.nodes[nid];
                    if (load.Fx) load.Fx = load.Fx * 4.4482216;
                    if (load.Fy) load.Fy = load.Fy * 4.4482216;
                    if (load.Fz) load.Fz = load.Fz * 4.4482216;
                    if (load.Mx) load.Mx = load.Mx * 1.355818;
                    if (load.My) load.My = load.My * 1.355818;
                    if (load.Mz) load.Mz = load.Mz * 1.355818;
                });
            }
        }
        
        const solver = new FEASolver(solverInput);
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
    
    const maxSusStressPsi = maxSusStress * 0.0001450377;
    const maxSusAllowPsi = maxSusAllow * 0.0001450377;
    const maxExpStressPsi = maxExpStress * 0.0001450377;
    const maxExpAllowPsi = maxExpAllow * 0.0001450377;
    
    document.getElementById('kpi-sus-stress').innerHTML = maxSusStressPsi.toFixed(0) + " psi";
    document.getElementById('kpi-sus-allow').innerHTML = "Allowable: " + maxSusAllowPsi.toFixed(0) + " psi";
    
    document.getElementById('kpi-exp-stress').innerHTML = maxExpStressPsi.toFixed(0) + " psi";
    document.getElementById('kpi-exp-allow').innerHTML = "Allowable: " + maxExpAllowPsi.toFixed(0) + " psi";
    
    // Element Stress Table
    const stressTableBody = document.querySelector('#table-results-stresses tbody');
    stressTableBody.innerHTML = "";
    for (let eid in res.elements) {
        let el = res.elements[eid];
        let tag = el.compliance_pass ? '<span class="tag-pass">Pass</span>' : '<span class="tag-fail">Fail</span>';
        let sif_str = `${el.SIF_in.toFixed(2)} / ${el.SIF_out.toFixed(2)}`;
        
        let susPsi = el.sustained_stress * 0.0001450377;
        let expPsi = el.expansion_stress * 0.0001450377;
        
        stressTableBody.innerHTML += `
            <tr>
                <td>${eid}</td>
                <td>${el.type.toUpperCase()}</td>
                <td>${sif_str}</td>
                <td>${susPsi.toFixed(0)}</td>
                <td style="color: ${varRatioColor(el.sustained_ratio)}">${el.sustained_ratio.toFixed(2)}</td>
                <td>${expPsi.toFixed(0)}</td>
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
                    <td>${(d[0]*39.37008).toFixed(3)}</td>
                    <td>${(d[1]*39.37008).toFixed(3)}</td>
                    <td>${(d[2]*39.37008).toFixed(3)}</td>
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
        global_gravity: [0.0, -32.2, 0.0],
        global_internal_pressure: 0.0,
        global_temperature_change: 0.0,
        occasional_g: [0.0, 0.0, 0.0]
    };
    
    let defaultMat = {
        carbon_steel: { E: 2.9e7, G: 1.12e7, alpha: 6.5e-6, yield_strength: 35000, Sc: 20000, Sh: 20000, density: 490 }
    };
    
    let defaultSec = {
        sec1: { OD: 4.5, wall_thickness: 0.237, type: 'pipe', fluid_density: 0.0, insulation_thickness: 0.0, insulation_density: 0.0 }
    };

    if (name === 'cantilever') {
        modelState = {
            materials: {...defaultMat},
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [10.0, 0.0, 0.0]
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
                    "1": { Fx: 0, Fy: -1000, Fz: 0, Mx: 0, My: 0, Mz: 0 }
                }
            }
        };
        // Reset density to 0.0 for exact point load comparison
        modelState.materials.carbon_steel.density = 0.0;
        
    } else if (name === 'thermal') {
        modelState = {
            materials: {
                carbon_steel: { E: 2.9e7, G: 1.12e7, alpha: 6.5e-6, yield_strength: 35000, Sc: 20000, Sh: 20000, density: 0 }
            },
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [10.0, 0.0, 0.0]
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
                global_temperature_change: 212.0
            }
        };
        
    } else if (name === 'lbend') {
        modelState = {
            materials: {
                carbon_steel: { E: 2.9e7, G: 1.12e7, alpha: 6.5e-6, yield_strength: 35000, Sc: 20000, Sh: 20000, density: 0 }
            },
            sections: {...defaultSec},
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [15.0, 0.0, 0.0],
                "2": [15.0, 12.0, 0.0]
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
                global_temperature_change: 300.0
            }
        };
        
    } else if (name === 'system') {
        // Detailed 3D loop template in customary English units
        modelState = {
            materials: {
                carbon_steel: { E: 2.9e7, G: 1.12e7, alpha: 6.5e-6, yield_strength: 35000, Sc: 20000, Sh: 20000, density: 490 }
            },
            sections: {
                nps_4: { OD: 4.5, wall_thickness: 0.237, type: 'pipe', fluid_density: 62.4, insulation_thickness: 1.0, insulation_density: 12.5 }
            },
            nodes: {
                "0": [0.0, 0.0, 0.0],
                "1": [10.0, 0.0, 0.0],
                "2": [10.0, 10.0, 0.0],
                "3": [16.0, 10.0, 0.0],
                "4": [16.0, 10.0, 6.0]
            },
            elements: [
                { id: 0, node_A: "0", node_B: "1", type: "pipe", material: "carbon_steel", section: "nps_4" },
                { id: 1, node_A: "1", node_B: "2", type: "bend", bend_radius: 6.0, material: "carbon_steel", section: "nps_4" },
                { id: 2, node_A: "2", node_B: "3", type: "pipe", material: "carbon_steel", section: "nps_4" },
                { id: 3, node_A: "3", node_B: "4", type: "pipe", material: "carbon_steel", section: "nps_4" }
            ],
            boundary_conditions: {
                "0": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true },
                "4": { tx: true, ty: true, tz: true, rx: true, ry: true, rz: true }
            },
            loads: {
                ...defaultLoads,
                global_internal_pressure: 300.0,
                global_temperature_change: 250.0
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
            camera.position.set(24, 21, 24);
            controls.target.set(7.5, 4.5, 1.5);
        } else {
            camera.position.set(12, 9, 12);
            controls.target.set(3.0, 0, 0);
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
    
    sprite.scale.set(0.8, 0.8, 1);
    
    sprite.position.copy(position);
    sprite.position.y += 0.6;
    sprite.position.x += 0.3;
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
    sprite.scale.set(0.8, 0.8, 1);
    sprite.position.copy(position);
    sprite.renderOrder = 1000;
    return sprite;
}

function setViewPlane(plane) {
    if (!camera || !controls) return;
    
    const target = controls.target.clone();
    const dist = camera.position.distanceTo(target) || 25.0;
    
    if (plane === 'x') {
        camera.position.set(target.x + dist, target.y, target.z);
    } else if (plane === 'y') {
        // Small offset in X to prevent OrbitControls camera-up gimbal lock when looking straight down
        camera.position.set(target.x + 0.01, target.y + dist, target.z);
    } else if (plane === 'z') {
        camera.position.set(target.x, target.y, target.z + dist);
    } else if (plane === 'iso') {
        const isoDist = dist / Math.sqrt(3);
        camera.position.set(target.x + isoDist, target.y + isoDist, target.z + isoDist);
    }
    
    controls.update();
}
