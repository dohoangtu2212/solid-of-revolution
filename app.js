/**
 * WISDEMY - Solid of Revolution Visualizer
 * Main Application Logic
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    resolution: 100,        // Number of points for curve
    segments: 64,          // Lathe geometry segments
    axisLength: 6,         // Length of coordinate axes
    solidColor: 0x00ffff,  // Cyan
    solidOpacity: 0.7,
    profileColor: 0xff3366, // Red-pink
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let scene, camera, renderer, controls;
let solidMesh = null;
let profileLineF = null;
let profileLineG = null;
let boundCircleA = null;
let boundCircleB = null;
let axisObjects = []; // Track axis objects for dynamic updates
let dynamicGrid = null; // Track dynamic grid

// DOM Elements
const inputF = document.getElementById('input-f');
const inputG = document.getElementById('input-g');
const previewF = document.getElementById('preview-f');
const previewG = document.getElementById('preview-g');
const inputA = document.getElementById('input-a'); // Changed from slider
const inputB = document.getElementById('input-b'); // Changed from slider
const sliderAngle = document.getElementById('slider-angle');
const sliderOpacity = document.getElementById('slider-opacity');
const colorSolid = document.getElementById('color-solid');
const colorF = document.getElementById('color-f');
const colorG = document.getElementById('color-g');
const colorBounds = document.getElementById('color-bounds');
// Removed valueA, valueB refs
const valueAngle = document.getElementById('value-angle');
const valueOpacity = document.getElementById('value-opacity');
const volumeFormula = document.getElementById('volume-formula'); // Kept for safety if re-enabled
const volumeValue = document.getElementById('volume-value');
const errorOverlay = document.getElementById('error-overlay');
const canvasContainer = document.getElementById('three-canvas');

// ============================================
// MATH EXPRESSION PROCESSING
// ============================================

/**
 * Preprocess natural math input to JavaScript evaluable expression
 */
function preprocessInput(expr) {
    let s = expr.toLowerCase().trim();
    if (!s) return '0';

    // Handle absolute value |x| -> abs(x)
    s = s.replace(/\|([^|]+)\|/g, 'abs($1)');

    // Replace ^ with ** for exponentiation
    s = s.replace(/\^/g, '**');

    // Handle general log base: log3(x) -> log_base(3, x)
    // Must be done BEFORE implicit multiplication checks
    s = s.replace(/\blog(\d+)\(/g, 'log_base($1,');

    // Add implicit multiplication
    // 2x -> 2*x, 2( -> 2*(, )2 -> )*2, )x -> )*x
    s = s.replace(/(\d)([a-z(])/g, '$1*$2');
    s = s.replace(/(\))(\d)/g, '$1*$2');
    s = s.replace(/(\))([a-z])/g, '$1*$2');

    // Replace math functions
    const mathFunctions = {
        'sin': 'Math.sin',
        'cos': 'Math.cos',
        'tan': 'Math.tan',
        'sqrt': 'Math.sqrt',
        'abs': 'Math.abs',
        'exp': 'Math.exp',
        'ln': 'Math.log',        // Natural logarithm
        'log': 'Math.log10',     // Base 10 logarithm
        'arcsin': 'Math.asin',
        'arccos': 'Math.acos',
        'arctan': 'Math.atan',
        'asin': 'Math.asin',
        'acos': 'Math.acos',
        'atan': 'Math.atan',
        'pi': 'Math.PI',
        'e': 'Math.E'
    };

    const sortedKeys = Object.keys(mathFunctions).sort((a, b) => b.length - a.length);

    for (const func of sortedKeys) {
        const regex = new RegExp(`\\b${func}\\b`, 'g');
        s = s.replace(regex, mathFunctions[func]);
    }

    return s;
}

/**
 * Safely evaluate a mathematical expression
 */
function safeEval(expr, x) {
    try {
        // Define log_base helper within the function scope
        // This is necessary because new Function creates a confined scope
        // We use Math.log (natural log) for the base change formula: log_b(x) = ln(x) / ln(b)
        const helperCode = `
            const log_base = (b, v) => Math.log(v) / Math.log(b);
            return ${expr};
        `;
        const func = new Function('x', 'Math', helperCode);
        const result = func(x, Math);
        return typeof result === 'number' ? result : NaN;
    } catch (e) {
        return NaN;
    }
}

/**
 * Evaluate expression for an array of x values
 */
function evaluateFunction(expr, xValues) {
    const processed = preprocessInput(expr);
    return xValues.map(x => safeEval(processed, x));
}

// ============================================
// LATEX RENDERING
// ============================================

function fixSqrtLatex(text) {
    while (text.toLowerCase().includes('sqrt(')) {
        const startIdx = text.toLowerCase().indexOf('sqrt(');
        const scanStart = startIdx + 4;
        let openCount = 0;
        let endIdx = -1;

        for (let i = scanStart; i < text.length; i++) {
            if (text[i] === '(') openCount++;
            else if (text[i] === ')') {
                openCount--;
                if (openCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }

        if (endIdx !== -1) {
            const content = text.slice(scanStart + 1, endIdx);
            text = text.slice(0, startIdx) + '\\sqrt{' + content + '}' + text.slice(endIdx + 1);
        } else {
            const content = text.slice(scanStart + 1);
            text = text.slice(0, startIdx) + '\\sqrt{' + content + '}';
            break;
        }
    }
    return text;
}

function toLatex(expr) {
    if (!expr.trim()) return '';
    let s = expr.trim();
    if (s.endsWith('^')) s += '{?}';
    s = fixSqrtLatex(s);

    // Handle log base N for LaTeX: log3 -> \log_{3}
    // Matches log followed by digits
    s = s.replace(/\blog(\d+)/g, '\\log_{$1}');

    const latexMap = {
        'log10': '\\log_{10}',
        'log2': '\\log_{2}',
        'ln': '\\ln',
        'log': '\\log',
        'sin': '\\sin',
        'cos': '\\cos',
        'tan': '\\tan',
        'arcsin': '\\arcsin',
        'arccos': '\\arccos',
        'arctan': '\\arctan',
        'pi': '\\pi',
    };

    const sortedKeys = Object.keys(latexMap).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        const regex = new RegExp(key, 'gi');
        s = s.replace(regex, latexMap[key]);
    }

    s = s.replace(/\*/g, ' \\cdot ');
    return s;
}

function renderLatexPreview(expr, container) {
    try {
        const latex = toLatex(expr);
        if (!latex) {
            container.innerHTML = '';
            container.classList.remove('error');
            return;
        }
        katex.render(latex, container, { throwOnError: false, displayMode: false });
        container.classList.remove('error');
    } catch (e) {
        container.innerHTML = '';
        container.classList.add('error');
    }
}

// ============================================
// THREE.JS SETUP
// ============================================

function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e2433);  // Warm dark blue (educational)

    // Camera - Z-up coordinate system
    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    camera.up.set(0, 0, 1);  // Z is up
    camera.position.set(10, -8, 6);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasContainer.appendChild(renderer.domElement);

    // Controls - Z-up
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.8;
    controls.minDistance = 3;
    controls.maxDistance = 50;

    // Lighting - designed for typical isometric viewing angle
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);  // Reduced ambient for more contrast
    scene.add(ambient);

    // Main light: front-right-above (creates primary highlights)
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(5, 8, 12);
    scene.add(mainLight);

    // Fill light: back-left-low (softens shadows)
    const fillLight = new THREE.DirectionalLight(0x6688cc, 0.3);
    fillLight.position.set(-8, -3, -5);
    scene.add(fillLight);

    // Rim light: behind-above (creates edge definition against dark background)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    rimLight.position.set(-5, 10, -10);
    scene.add(rimLight);

    // Grid handled dynamically in drawDynamicAxes
    // const gridHelper = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
    // ... removed static grid code

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    // Animation loop
    animate();
}

/**
 * Draw dynamic coordinate axes based on function bounds
 * @param {number} xPosLimit - Positive X limit
 * @param {number} xNegLimit - Negative X limit (value < 0)
 * @param {number} rLimit - Radius limit for Y/Z axes
 */
function drawDynamicAxes(xPosLimit, xNegLimit, rLimit) {
    // Remove old axis objects
    axisObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
    });
    axisObjects = [];

    // Calculate axis lengths with padding
    const L_x_pos = Math.max(xPosLimit + 1.5, 3.0);
    const L_x_neg = Math.max(Math.abs(xNegLimit) + 1.5, 1.2);
    const L_r = Math.max(rLimit + 1.5, 3.0);
    const neg_r = 1.2; // Fixed negative extension for Y/Z

    // ====== DYNAMIC GRID ======
    if (dynamicGrid) {
        scene.remove(dynamicGrid);
        if (dynamicGrid.geometry) dynamicGrid.geometry.dispose();
        if (dynamicGrid.material) dynamicGrid.material.dispose();
    }

    // Grid size should cover the largest dimension
    // Ensure size is large enough and divisions are integers
    const gridSize = Math.ceil(Math.max(L_x_pos, L_x_neg, L_r)) * 2 + 2;
    const divisions = gridSize; // 1 unit per division

    dynamicGrid = new THREE.GridHelper(gridSize, divisions, 0x444466, 0x222233);
    dynamicGrid.rotation.x = Math.PI / 2; // Rotate to OXY plane
    dynamicGrid.material.opacity = 0.25;
    dynamicGrid.material.transparent = true;
    scene.add(dynamicGrid);
    // ==========================

    const axisColor = 0x888899;
    const axisMaterial = new THREE.LineBasicMaterial({ color: axisColor, linewidth: 2 });

    // X-axis: from -L_x_neg to L_x_pos
    const xAxisGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-L_x_neg, 0, 0),
        new THREE.Vector3(L_x_pos, 0, 0)
    ]);
    const xAxis = new THREE.Line(xAxisGeom, axisMaterial);
    scene.add(xAxis);
    axisObjects.push(xAxis);

    // Y-axis
    const yAxisGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -neg_r, 0),
        new THREE.Vector3(0, L_r, 0)
    ]);
    const yAxis = new THREE.Line(yAxisGeom, axisMaterial);
    scene.add(yAxis);
    axisObjects.push(yAxis);

    // Z-axis
    const zAxisGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -neg_r),
        new THREE.Vector3(0, 0, L_r)
    ]);
    const zAxis = new THREE.Line(zAxisGeom, axisMaterial);
    scene.add(zAxis);
    axisObjects.push(zAxis);

    // Arrow heads (cones)
    const coneGeom = new THREE.ConeGeometry(0.1, 0.3, 16);
    const coneMaterial = new THREE.MeshBasicMaterial({ color: axisColor });

    // X arrow
    const xArrow = new THREE.Mesh(coneGeom.clone(), coneMaterial);
    xArrow.position.set(L_x_pos, 0, 0);
    xArrow.rotation.z = -Math.PI / 2;
    scene.add(xArrow);
    axisObjects.push(xArrow);

    // Y arrow
    const yArrow = new THREE.Mesh(coneGeom.clone(), coneMaterial);
    yArrow.position.set(0, L_r, 0);
    scene.add(yArrow);
    axisObjects.push(yArrow);

    // Z arrow
    const zArrow = new THREE.Mesh(coneGeom.clone(), coneMaterial);
    zArrow.position.set(0, 0, L_r);
    zArrow.rotation.x = Math.PI / 2;
    scene.add(zArrow);
    axisObjects.push(zArrow);

    // Labels
    const xLabel = createAxisSprite('x', L_x_pos + 0.4, 0, 0);
    const yLabel = createAxisSprite('y', 0, L_r + 0.4, 0);
    const zLabel = createAxisSprite('z', 0, 0, L_r + 0.4);
    const oLabel = createAxisSprite('O', -0.3, -0.3, 0);
    axisObjects.push(xLabel, yLabel, zLabel, oLabel);
}

function createAxisSprite(text, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    // Use Times New Roman for LaTeX-like appearance
    ctx.font = 'italic 700 80px "Times New Roman", Times, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(0.6, 0.6, 1);
    scene.add(sprite);
    return sprite;
}

function createTextSprite(text, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(0.6, 0.6, 1);
    scene.add(sprite);
}

function onWindowResize() {
    const width = canvasContainer.clientWidth;
    const height = canvasContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ============================================
// SOLID OF REVOLUTION - WASHER METHOD
// ============================================

function updateSolid() {
    // Get slider values
    // Get input values
    let a = parseFloat(inputA.value);
    let b = parseFloat(inputB.value);
    const angleDeg = parseInt(sliderAngle.value);
    const angleRad = (angleDeg * Math.PI) / 180;

    // Fixed: Removed legacy valueA/valueB label updates
    valueAngle.textContent = `${angleDeg}°`;

    // Ensure a < b
    if (a > b) [a, b] = [b, a];
    if (Math.abs(a - b) < 0.01) b = a + 0.01;

    // Generate x values
    const xValues = [];
    for (let i = 0; i <= CONFIG.resolution; i++) {
        xValues.push(a + (b - a) * (i / CONFIG.resolution));
    }

    // Evaluate functions
    const yOuter = evaluateFunction(inputF.value, xValues);
    const yInner = evaluateFunction(inputG.value, xValues);

    // Check for NaN/Infinity
    const hasInvalid = yOuter.some(v => !isFinite(v)) || yInner.some(v => !isFinite(v));

    if (hasInvalid) {
        showError(true);
        removeSolid();
        return;
    }
    showError(false);

    // ====== CROSS-AXIS PREPROCESSING ======
    // Compute adjusted radii for mesh generation
    // When f and g have opposite signs, the region spans the axis -> solid disc (inner = 0)
    const rOuterArr = [];
    const rInnerArr = [];

    for (let i = 0; i <= CONFIG.resolution; i++) {
        const f = yOuter[i];
        const g = yInner[i];

        if (f * g < 0) {
            // Opposite signs: region spans the rotation axis
            rOuterArr.push(Math.max(Math.abs(f), Math.abs(g)));
            rInnerArr.push(0);
        } else {
            // Same sign: washer method
            rOuterArr.push(Math.max(Math.abs(f), Math.abs(g)));
            rInnerArr.push(Math.min(Math.abs(f), Math.abs(g)));
        }
    }

    // Remove existing meshes
    removeSolid();

    // ====== CREATE WASHER SOLID ======
    // Outer surface: rOuterArr, Inner surface: rInnerArr
    // Both rotate around X-axis

    const positions = [];
    const indices = [];

    const thetaSegments = CONFIG.segments;
    const xSegments = CONFIG.resolution;

    // Helper function to add a surface
    function addSurface(radiusArray, startVertexIndex, flipNormals = false) {
        const surfaceIndices = [];

        // Generate vertices
        for (let i = 0; i <= xSegments; i++) {
            const x = xValues[i];
            const r = Math.abs(radiusArray[i]);

            for (let j = 0; j <= thetaSegments; j++) {
                const theta = (j / thetaSegments) * angleRad;

                const px = x;
                const py = r * Math.cos(theta);
                const pz = r * Math.sin(theta);

                positions.push(px, py, pz);
            }
        }

        // Generate indices
        for (let i = 0; i < xSegments; i++) {
            for (let j = 0; j < thetaSegments; j++) {
                const va = startVertexIndex + i * (thetaSegments + 1) + j;
                const vb = va + 1;
                const vc = va + (thetaSegments + 1);
                const vd = vc + 1;

                if (flipNormals) {
                    indices.push(va, vb, vc);
                    indices.push(vb, vd, vc);
                } else {
                    indices.push(va, vc, vb);
                    indices.push(vb, vc, vd);
                }
            }
        }

        return (xSegments + 1) * (thetaSegments + 1);
    }

    // Add outer surface (rOuterArr)
    let vertexCount = 0;
    vertexCount += addSurface(rOuterArr, vertexCount, false);

    // Add inner surface (rInnerArr) - with flipped normals
    const innerStartIdx = vertexCount;
    vertexCount += addSurface(rInnerArr, innerStartIdx, true);

    // ====== ADD END CAPS (washer discs at x=a and x=b) ======
    // Helper function to add a washer cap at a specific x position
    function addEndCap(xPos, rOuter, rInner, startVertexIdx, facing) {
        const capPositions = [];

        // Outer ring vertices
        for (let j = 0; j <= thetaSegments; j++) {
            const theta = (j / thetaSegments) * angleRad;
            const py = Math.abs(rOuter) * Math.cos(theta);
            const pz = Math.abs(rOuter) * Math.sin(theta);
            positions.push(xPos, py, pz);
        }

        // Inner ring vertices
        for (let j = 0; j <= thetaSegments; j++) {
            const theta = (j / thetaSegments) * angleRad;
            const py = Math.abs(rInner) * Math.cos(theta);
            const pz = Math.abs(rInner) * Math.sin(theta);
            positions.push(xPos, py, pz);
        }

        // Create triangles between outer and inner rings
        const outerStart = startVertexIdx;
        const innerStart = startVertexIdx + (thetaSegments + 1);

        for (let j = 0; j < thetaSegments; j++) {
            const vo1 = outerStart + j;
            const vo2 = outerStart + j + 1;
            const vi1 = innerStart + j;
            const vi2 = innerStart + j + 1;

            if (facing > 0) {
                // Facing positive X direction (cap at x=b)
                indices.push(vo1, vi1, vo2);
                indices.push(vo2, vi1, vi2);
            } else {
                // Facing negative X direction (cap at x=a)
                indices.push(vo1, vo2, vi1);
                indices.push(vo2, vi2, vi1);
            }
        }

        return 2 * (thetaSegments + 1);
    }

    // Add cap at x = a (left side, facing negative X)
    const rOuterA = rOuterArr[0];
    const rInnerA = rInnerArr[0];
    vertexCount += addEndCap(a, rOuterA, rInnerA, vertexCount, -1);

    // Add cap at x = b (right side, facing positive X)
    const rOuterB = rOuterArr[CONFIG.resolution];
    const rInnerB = rInnerArr[CONFIG.resolution];
    vertexCount += addEndCap(b, rOuterB, rInnerB, vertexCount, 1);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Material - use current opacity and color values
    const currentOpacity = sliderOpacity.value / 100;
    const currentColor = colorSolid.value;
    const material = new THREE.MeshPhongMaterial({
        color: currentColor,
        transparent: true,
        opacity: currentOpacity,
        side: THREE.DoubleSide,
        shininess: 80,
        specular: 0x444444,
    });

    solidMesh = new THREE.Mesh(geometry, material);
    scene.add(solidMesh);

    // ====== CREATE PROFILE LINES ======
    // f(x) line - on XY plane (z=0, positive Y)
    const fPoints = [];
    for (let i = 0; i <= CONFIG.resolution; i++) {
        fPoints.push(new THREE.Vector3(xValues[i], yOuter[i], 0));  // No abs - show actual curve
    }
    const fGeometry = new THREE.BufferGeometry().setFromPoints(fPoints);
    const fMaterial = new THREE.LineBasicMaterial({
        color: colorF.value,
        linewidth: 2,
    });
    profileLineF = new THREE.Line(fGeometry, fMaterial);
    scene.add(profileLineF);

    // g(x) line - on XY plane (z=0, positive Y)
    const gPoints = [];
    for (let i = 0; i <= CONFIG.resolution; i++) {
        gPoints.push(new THREE.Vector3(xValues[i], yInner[i], 0));  // No abs - show actual curve
    }
    const gGeometry = new THREE.BufferGeometry().setFromPoints(gPoints);
    const gMaterial = new THREE.LineBasicMaterial({
        color: colorG.value,
        linewidth: 2,
    });
    profileLineG = new THREE.Line(gGeometry, gMaterial);
    scene.add(profileLineG);

    // ====== DASHED BOUND LINES (on OXY plane) ======
    // Draw vertical dashed lines at x=a and x=b on the Z=0 plane
    const boundColor = colorBounds.value;

    // Helper to create dashed line segment
    function createBoundLine(xPos, yStart, yEnd) {
        const points = [];
        points.push(new THREE.Vector3(xPos, yStart, 0));
        points.push(new THREE.Vector3(xPos, yEnd, 0));

        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineDashedMaterial({
            color: boundColor,
            linewidth: 2,
            scale: 1,
            dashSize: 0.2,
            gapSize: 0.1,
        });

        const line = new THREE.Line(geom, mat);
        line.computeLineDistances();
        return line;
    }

    // Line at x = a (from min to max of both curves)
    const yaMin = Math.min(yOuter[0], yInner[0]);
    const yaMax = Math.max(yOuter[0], yInner[0]);
    if (yaMax !== yaMin) {
        boundCircleA = createBoundLine(a, yaMin, yaMax);
        scene.add(boundCircleA);
    }

    // Line at x = b (from min to max of both curves)
    const ybMin = Math.min(yOuter[CONFIG.resolution], yInner[CONFIG.resolution]);
    const ybMax = Math.max(yOuter[CONFIG.resolution], yInner[CONFIG.resolution]);
    if (ybMax !== ybMin) {
        boundCircleB = createBoundLine(b, ybMin, ybMax);
        scene.add(boundCircleB);
    }

    // ====== DYNAMIC AXES ======
    // Calculate limits based on function bounds
    const xMaxLimit = Math.max(a, b, 0);
    const xMinLimit = Math.min(a, b, 0);

    // Max radius from outer and inner functions
    const rMaxOuter = Math.max(...yOuter.map(Math.abs));
    const rMaxInner = Math.max(...yInner.map(Math.abs));
    const rMaxLimit = Math.max(rMaxOuter, rMaxInner);

    // Draw dynamic axes
    drawDynamicAxes(xMaxLimit, xMinLimit, rMaxLimit);

    // Calculate measurements (Volume, Area) and update UI
    updateMeasurements(a, b, angleDeg);
}

function removeSolid() {
    if (solidMesh) {
        scene.remove(solidMesh);
        solidMesh.geometry.dispose();
        solidMesh.material.dispose();
        solidMesh = null;
    }
    if (profileLineF) {
        scene.remove(profileLineF);
        profileLineF.geometry.dispose();
        profileLineF.material.dispose();
        profileLineF = null;
    }
    if (profileLineG) {
        scene.remove(profileLineG);
        profileLineG.geometry.dispose();
        profileLineG.material.dispose();
        profileLineG = null;
    }
    if (boundCircleA) {
        scene.remove(boundCircleA);
        boundCircleA.geometry.dispose();
        boundCircleA.material.dispose();
        boundCircleA = null;
    }
    if (boundCircleB) {
        scene.remove(boundCircleB);
        boundCircleB.geometry.dispose();
        boundCircleB.material.dispose();
        boundCircleB = null;
    }
}

function showError(show) {
    errorOverlay.classList.toggle('hidden', !show);
}

function updateMeasurements(a, b, angleDeg) {
    const n = 1000;
    const dx = (b - a) / n;
    let volume = 0;
    let area2D = 0;

    const fProcessed = preprocessInput(inputF.value);
    const gProcessed = preprocessInput(inputG.value);

    // Initial values at x = a (needed for Trapezoidal rule)
    let f_prev = safeEval(fProcessed, a);
    let g_prev = safeEval(gProcessed, a);
    if (!isFinite(f_prev)) f_prev = 0;
    if (!isFinite(g_prev)) g_prev = 0;

    for (let i = 0; i < n; i++) {
        const x_next = a + (i + 1) * dx;
        let f_next = safeEval(fProcessed, x_next);
        let g_next = safeEval(gProcessed, x_next);

        if (!isFinite(f_next)) f_next = 0;
        if (!isFinite(g_next)) g_next = 0;

        // ====== CROSS-AXIS DETECTION ======
        // Check if f and g have opposite signs at this segment
        // Use average of prev and next for the segment
        const f_avg = (f_prev + f_next) / 2;
        const g_avg = (g_prev + g_next) / 2;

        let rOuter, rInner;

        if (f_avg * g_avg < 0) {
            // Opposite signs: region spans the rotation axis
            // The solid is a full disc (no hole)
            rOuter = Math.max(Math.abs(f_avg), Math.abs(g_avg));
            rInner = 0;
        } else {
            // Same sign: use washer method
            const rf = Math.abs(f_avg);
            const rg = Math.abs(g_avg);
            rOuter = Math.max(rf, rg);
            rInner = Math.min(rf, rg);
        }

        // Volume (using segment averages)
        volume += (rOuter * rOuter - rInner * rInner) * dx;

        // 2D Area: ∫ |f(x) - g(x)| dx (actual signed difference, not absolute radii)
        const h_prev = Math.abs(f_prev - g_prev);
        const h_next = Math.abs(f_next - g_next);
        area2D += (h_prev + h_next) / 2 * dx;

        f_prev = f_next;
        g_prev = g_next;
    }

    // Volume depends on Angle
    const ratio = angleDeg / 360;
    volume = Math.abs(Math.PI * volume * ratio);

    // Area is 2D region, independent of rotation angle?
    // User requested "Diện tích sinh ra bởi hai đường cong".
    // Usually this means the area of the shape itself.
    // If they meant rotation, they would say "Surface Area".
    // We assume 2D Area of the region.

    // Update UI
    if (volumeValue) volumeValue.textContent = volume.toFixed(2);

    const areaValue = document.getElementById('area-value');
    if (areaValue) areaValue.textContent = area2D.toFixed(2);

    // Hide formula
    const volumeFormula = document.getElementById('volume-formula');
    if (volumeFormula) volumeFormula.parentElement.style.display = 'none';

    const infoSection = document.querySelector('.info-section');
    if (infoSection) {
        // Ensure styling is consistent
    }
}


// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    inputF.addEventListener('input', () => renderLatexPreview(inputF.value, previewF));
    inputG.addEventListener('input', () => renderLatexPreview(inputG.value, previewG));

    inputF.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') updateSolid();
    });
    inputG.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') updateSolid();
    });

    inputA.addEventListener('input', updateSolid);
    inputB.addEventListener('input', updateSolid);
    sliderAngle.addEventListener('input', updateSolid);

    // Opacity slider
    sliderOpacity.addEventListener('input', () => {
        const opacity = sliderOpacity.value / 100;
        valueOpacity.textContent = opacity.toFixed(2);
        if (solidMesh) {
            solidMesh.material.opacity = opacity;
        }
    });

    // Color picker - solid
    colorSolid.addEventListener('input', () => {
        if (solidMesh) {
            solidMesh.material.color.set(colorSolid.value);
        }
    });

    // Color picker - f(x) line
    colorF.addEventListener('input', () => {
        if (profileLineF) {
            profileLineF.material.color.set(colorF.value);
        }
    });

    // Color picker - g(x) line
    colorG.addEventListener('input', () => {
        if (profileLineG) {
            profileLineG.material.color.set(colorG.value);
        }
    });

    // Color picker - bounds (requires re-render)
    colorBounds.addEventListener('input', updateSolid);
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
    initThreeJS();
    setupEventListeners();

    // Initial previews
    renderLatexPreview(inputF.value, previewF);
    renderLatexPreview(inputG.value, previewG);

    // Initial solid
    updateSolid();
}

// Start
init();
