/**
 * WISDEMY - Solid of Revolution Visualizer
 * Main Application Logic
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

console.log('App.js Loaded - Version Piecewise - Trigger 2');

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
let profileLines = [];
let boundCircleA = null;
let boundCircleB = null;
let axisObjects = []; // Track axis objects for dynamic updates
let dynamicGrid = null; // Track dynamic grid
let wireframeMesh = null; // Track wireframe overlay

// DOM Elements
// DOM Elements (Updated)
const inputA = document.getElementById('input-a');
const inputB = document.getElementById('input-b');
const sliderAngle = document.getElementById('slider-angle');
const sliderOpacity = document.getElementById('slider-opacity');
// Color mode elements
const colorModeSelect = document.getElementById('color-mode-select');
const colorSolid = document.getElementById('color-solid');
const colorStart = document.getElementById('color-start');
const colorMid = document.getElementById('color-mid');
const colorEnd = document.getElementById('color-end');
const toggleWireframe = document.getElementById('toggle-wireframe');
const colorBounds = document.getElementById('color-bounds');
const valueAngle = document.getElementById('value-angle');
const valueOpacity = document.getElementById('value-opacity');
const volumeFormula = document.getElementById('volume-formula');
const volumeValue = document.getElementById('volume-value');
const errorOverlay = document.getElementById('error-overlay');
const canvasContainer = document.getElementById('three-canvas');

// Dynamic List Containers
const upperFuncsContainer = document.getElementById('upper-funcs-list');
const lowerFuncsContainer = document.getElementById('lower-funcs-list');
const btnAddUpper = document.getElementById('btn-add-upper');
const btnAddLower = document.getElementById('btn-add-lower');

// State for Multiple Functions
// Each item: { id: string, expr: string, color: string, rangeStart: string, rangeEnd: string, preview: element }
let upperFuncs = [
    { id: 'f1', expr: '-x+3', color: '#ff6b6b', rangeStart: '', rangeEnd: '' }
];
let lowerFuncs = [
    { id: 'g1', expr: '-sqrt(-x+3)', color: '#51cf66', rangeStart: '', rangeEnd: '' }
];

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

/**
 * Evaluate a list of piecewise functions to find the effective boundary
 * @param {Array} funcsList - List of function objects { expr, rangeStart, rangeEnd }
 * @param {Array} xValues - Array of x coordinates
 * @param {string} type - 'upper' (max of overlaps? no, min of overlaps for upper bound logic usually? Wait.)
 *        For "Upper Boundary Group" (Roof):
 *        - If multiple functions overlap, the "effective" boundary is usually the one that is "lowest" if we are bounding from above?
 *        - Wait, user said: "giao nhau... hệ thống sẽ tự động chọn giá trị lớn nhất (đối với nhóm đường trên)".
 *        - User said: "Max for Upper Group".
 *        - Let's follow User's explicit request: Max for Upper, Min for Lower (?) OR Max for both?
 *        - Re-read user request: "Trường hợp có giao nhau... chọn giá trị lớn nhất (nhóm đường trên)".
 *        - "Nhóm đường dưới": logic đối xứng -> Min?
 *        - Let's implement flexible Min/Max logic.
 */
function evaluatePiecewise(funcsList, xValues, mode) {
    // 1. Preprocess all expressions
    const compiledFuncs = funcsList.map(f => ({
        func: (x) => safeEval(preprocessInput(f.expr), x),
        range: [
            f.rangeStart !== '' ? safeEval(preprocessInput(f.rangeStart), 0) : -Infinity,
            f.rangeEnd !== '' ? safeEval(preprocessInput(f.rangeEnd), 0) : Infinity
        ]
    }));

    return xValues.map(x => {
        // Find active functions for this x
        const active = compiledFuncs.filter(f => x >= f.range[0] && x <= f.range[1]);

        if (active.length === 0) return 0; // Gap = 0

        const values = active.map(f => f.func(x)).filter(v => isFinite(v));
        if (values.length === 0) return 0;

        if (mode === 'max') {
            return Math.max(...values);
        } else {
            return Math.min(...values);
        }
    });
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
    camera.position.set(9, -9, 6); // Isometric view - Zoomed out
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

    // Lighting - optimized for default viewing angle (front-right-above)
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);  // Slightly increased for overall visibility
    scene.add(ambient);

    // Main light: front-right-above (creates primary highlights)
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.9);
    mainLight.position.set(5, 8, 10);
    scene.add(mainLight);

    // Key light: front-left-low (illuminates the left side visible from default view)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(-8, -5, 8);   // Front-left-low
    scene.add(keyLight);

    // Fill light: back-low (softens harsh shadows)
    const fillLight = new THREE.DirectionalLight(0x88aacc, 0.4);
    fillLight.position.set(0, -5, -8);
    scene.add(fillLight);

    // Rim light: behind-above (edge definition)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(-5, 8, -8);
    scene.add(rimLight);

    // Grid handled dynamically in drawDynamicAxes
    // const gridHelper = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
    // ... removed static grid code

    // Handle resize with Platinum Sync (Smooth aspect + Debounced resolution)
    let resizeTimeout;
    const resizeObserver = new ResizeObserver(entries => {
        if (!entries.length) return;
        const width = canvasContainer.clientWidth;
        const height = canvasContainer.clientHeight;

        // 1. Instant Aspect Sync (Flicker-free & No distortion)
        if (camera) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }

        // 2. Debounced Resolution Snap (Prevents buffer-clearing flickering)
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderer.setSize(width, height, false);
            // Force immediate render to prevent 1-frame gap
            if (scene && camera) renderer.render(scene, camera);
        }, 100);
    });
    resizeObserver.observe(canvasContainer);

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

    dynamicGrid = new THREE.GridHelper(gridSize, divisions, 0x4a5568, 0x374151);  // Lighter gray for visibility
    dynamicGrid.rotation.x = Math.PI / 2; // Rotate to OXY plane
    dynamicGrid.material.opacity = 0.4;   // Increased opacity
    dynamicGrid.material.transparent = true;
    scene.add(dynamicGrid);
    // ==========================

    const axisColor = 0xffffff;
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
    ctx.font = 'italic 80px "Computer Modern Serif", "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,    // Allow occlusion by solid objects
        depthWrite: false   // Don't mess with depth buffer
    });
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

// onWindowResize removed in favor of ResizeObserver in initThreeJS


let isResettingCamera = false;
let isSweeping = false;

function animate() {
    requestAnimationFrame(animate);

    if (isResettingCamera) {
        // LERP target towards 0,0,0
        controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.1);
        if (controls.target.lengthSq() < 0.001) {
            controls.target.set(0, 0, 0);
            isResettingCamera = false;
            // Only enable autoRotate if the checkbox is still checked
            const toggleRotate = document.getElementById('toggle-rotate');
            if (toggleRotate && toggleRotate.checked) {
                controls.autoRotate = true;
            }
        }
    }

    if (isSweeping) {
        let currentAngle = parseInt(sliderAngle.value);
        currentAngle += 2; // Speed: 2 degrees per frame

        if (currentAngle >= 360) {
            currentAngle = 0; // Loop continuously
        }

        sliderAngle.value = currentAngle;
        updateSolid();
    }
    controls.update();
    renderer.render(scene, camera);
}

// ============================================
// SOLID OF REVOLUTION - WASHER METHOD
// ============================================

function updateSolid() {
    // Get slider values
    // Get input values
    // Allow math expressions in A and B (e.g. "pi", "sqrt(2)")
    let valA = inputA.value;
    let valB = inputB.value;

    // Default to 0 if empty
    if (!valA.trim()) valA = '0';
    if (!valB.trim()) valB = '0';

    let a = safeEval(preprocessInput(valA), 0);
    let b = safeEval(preprocessInput(valB), 0);

    // Fallback if evaluation fails
    if (isNaN(a)) a = 0;
    if (isNaN(b)) b = 0;
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

    // Evaluate Piecewise Functions
    // User requested: "Upper Group" -> Max (Outer envelope typically)
    // "Lower Group" -> Min (Inner envelope typically) assuming they are below?
    // Actually, "Upper" usually means f(x). "Lower" means g(x).
    // The Radius is |y|.
    // Let's use 'max' for Upper and 'min' for Lower as per standard envelope logic for now.
    // User explicitly said: "chọn giá trị lớn nhất (đối với nhóm đường trên)". -> Max.
    const yOuter = evaluatePiecewise(upperFuncs, xValues, 'max');

    // For lower group, if multiple functions overlap, we usually want the "highest" of the bottoms if we are cutting from below?
    // Or "lowest"?
    // Case 2: V-shape bottom. y=|x|. g1=x (x>0), g2=-x (x<0).
    // At x=0, both 0.
    // If we have g1=0 and g2=x-1. Max is 0. Min is x-1.
    // Standard "Lower Boundary" of a region defined by "y >= g(x)" is usually g(x) = max(g1, g2).
    // Example: y >= 0 AND y >= x-1. Effective g(x) = max(0, x-1).
    // So BOTH Upper and Lower effective boundaries are MAX of their components (if we define region as y <= f_i and y >= g_i).
    // Wait. y <= f1 AND y <= f2 -> y <= min(f1, f2). (Ceiling is min of roofs).
    // y >= g1 AND y >= g2 -> y >= max(g1, g2). (Floor is max of floors).
    // The user said: "chọn giá trị lớn nhất (đối với nhóm đường trên)".
    // This contradicts "y <= f1 and y <= f2".
    // "Max of Upper" implies "y <= f1 OR y <= f2" (Union of regions under curves).
    // "Min of Upper" implies "Intersection of regions".
    // I will stick to User's "Max" request for Upper. And likely "Max" for Lower too (Floor logic).
    // Let's define: Effective F = Max(all f). Effective G = Max(all g).
    // This allows "Piecewise" easily (since 0 is fallback).
    const yInner = evaluatePiecewise(lowerFuncs, xValues, 'max'); // Assuming Max for lower too to allow building up shapes.

    // Check for NaN/Infinity
    const hasInvalid = yOuter.some(v => !isFinite(v)) || yInner.some(v => !isFinite(v));

    if (hasInvalid) {
        showError(true);
        removeSolid();
        return;
    }
    showError(false);

    // Remove existing meshes
    removeSolid();

    const renderMode = document.getElementById('render-mode') ? document.getElementById('render-mode').value : 'smooth';
    let geometry = null;

    if (renderMode === 'disks') {
        const n = parseInt(document.getElementById('slider-disk-count').value) || 20;
        geometry = createDisks(a, b, n, angleRad);
    } else {
        // ====== SMOOTH LATHE METHOD ======
        // Compute adjusted radii for mesh generation
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

        const positions = [];
        const indices = [];

        const thetaSegments = CONFIG.segments;
        const xSegments = CONFIG.resolution;

        // Helper function to add a surface
        function addSurface(radiusArray, startVertexIndex, flipNormals = false) {
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

        // ====== ADD END CAPS ======
        function addEndCap(xPos, rOuter, rInner, startVertexIdx, facing) {
            for (let j = 0; j <= thetaSegments; j++) {
                const theta = (j / thetaSegments) * angleRad;
                const py = Math.abs(rOuter) * Math.cos(theta);
                const pz = Math.abs(rOuter) * Math.sin(theta);
                positions.push(xPos, py, pz);
            }
            for (let j = 0; j <= thetaSegments; j++) {
                const theta = (j / thetaSegments) * angleRad;
                const py = Math.abs(rInner) * Math.cos(theta);
                const pz = Math.abs(rInner) * Math.sin(theta);
                positions.push(xPos, py, pz);
            }

            const outerStart = startVertexIdx;
            const innerStart = startVertexIdx + (thetaSegments + 1);

            for (let j = 0; j < thetaSegments; j++) {
                const vo1 = outerStart + j;
                const vo2 = outerStart + j + 1;
                const vi1 = innerStart + j;
                const vi2 = innerStart + j + 1;

                if (facing > 0) {
                    indices.push(vo1, vi1, vo2);
                    indices.push(vo2, vi1, vi2);
                } else {
                    indices.push(vo1, vo2, vi1);
                    indices.push(vo2, vi2, vi1);
                }
            }
            return 2 * (thetaSegments + 1);
        }

        const rOuterA = rOuterArr[0];
        const rInnerA = rInnerArr[0];
        vertexCount += addEndCap(a, rOuterA, rInnerA, vertexCount, -1);

        const rOuterB = rOuterArr[CONFIG.resolution];
        const rInnerB = rInnerArr[CONFIG.resolution];
        vertexCount += addEndCap(b, rOuterB, rInnerB, vertexCount, 1);

        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
    } // End Smooth Mode

    if (!geometry) return;

    // ====== MATERIAL & GRADIENT ======
    const currentOpacity = sliderOpacity.value / 100;
    const colorMode = colorModeSelect.value;
    let material;
    const isTransparent = currentOpacity < 0.99;
    const depthWrite = !isTransparent;

    if (colorMode === 'gradient-x') {
        const startColor = new THREE.Color(colorStart.value);
        const midColor = new THREE.Color(colorMid.value);
        const endColor = new THREE.Color(colorEnd.value);

        // Use geometry attributes directly to support both BufferGeometry sources
        const positions = geometry.attributes.position.array;
        const colors = [];

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
            let vertexColor;

            if (t < 0.5) {
                const localT = t * 2;
                vertexColor = new THREE.Color().lerpColors(startColor, midColor, localT);
            } else {
                const localT = (t - 0.5) * 2;
                vertexColor = new THREE.Color().lerpColors(midColor, endColor, localT);
            }
            colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: isTransparent,
            opacity: currentOpacity,
            side: THREE.DoubleSide,
            metalness: 0.1,
            roughness: 0.4,
            depthWrite: depthWrite
        });
    } else {
        material = new THREE.MeshStandardMaterial({
            color: colorSolid.value,
            transparent: isTransparent,
            opacity: currentOpacity,
            side: THREE.DoubleSide,
            metalness: 0.1,
            roughness: 0.4,
            depthWrite: depthWrite
        });
    }

    solidMesh = new THREE.Mesh(geometry, material);
    scene.add(solidMesh);

    // ====== MESH OVERLAY ======
    if (toggleWireframe.checked) {
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.25,
        });
        wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);
        scene.add(wireframeMesh);
    }

    // ====== DRAW PROFILE LINES (PIECEWISE) ======
    // Draw each active function segment with its own color

    // Helper to draw a function segment
    // Helper to draw a function segment
    function drawFunctionSegment(funcItem, xValues) {
        // Preprocess just this function
        const processedExpr = preprocessInput(funcItem.expr);
        const compiledFunc = (x) => safeEval(processedExpr, x);

        // Filter by range
        const rStartInput = parseFloat(funcItem.rangeStart !== '' ? safeEval(preprocessInput(funcItem.rangeStart), 0) : -Infinity);
        const rEndInput = parseFloat(funcItem.rangeEnd !== '' ? safeEval(preprocessInput(funcItem.rangeEnd), 0) : Infinity);

        // Clamp to global bounds [a, b] for drawing
        const xMinGlobal = Math.min(a, b);
        const xMaxGlobal = Math.max(a, b);
        const rStart = Math.max(rStartInput, xMinGlobal);
        const rEnd = Math.min(rEndInput, xMaxGlobal);

        if (rStart > rEnd) return;

        let points = [];

        // 1. Add sampled points within range
        for (let i = 0; i < xValues.length; i++) {
            const x = xValues[i];
            if (x >= rStart && x <= rEnd) {
                const y = compiledFunc(x);
                if (isFinite(y)) {
                    points.push({ x: x, y: y }); // Store as object first for sorting
                }
            }
        }

        // 2. Explicitly add start and end points to close gaps
        const yStart = compiledFunc(rStart);
        if (isFinite(yStart)) points.push({ x: rStart, y: yStart });

        const yEnd = compiledFunc(rEnd);
        if (isFinite(yEnd)) points.push({ x: rEnd, y: yEnd });

        // 3. Sort by X
        points.sort((p1, p2) => p1.x - p2.x);

        // 4. Remove duplicates (simple proximity check)
        const uniquePoints = [];
        if (points.length > 0) {
            uniquePoints.push(points[0]);
            for (let i = 1; i < points.length; i++) {
                if (Math.abs(points[i].x - points[i - 1].x) > 1e-9) {
                    uniquePoints.push(points[i]);
                }
            }
        }

        // 5. Create segments (handle internal gaps if any NaN, though filtered above)
        // Since we filtered isFinite, we assume continuous for now.
        // If the function itself has a gap (e.g. 1/x), we might get a line across asymptote. 
        // For piecewise segments usually short and continuous.
        if (uniquePoints.length < 2) return;

        const vecPoints = uniquePoints.map(p => new THREE.Vector3(p.x, p.y, 0));
        const geom = new THREE.BufferGeometry().setFromPoints(vecPoints);
        const mat = new THREE.LineBasicMaterial({
            color: funcItem.color,
            linewidth: 2
        });
        const line = new THREE.Line(geom, mat);
        scene.add(line);
        profileLines.push(line);
    }

    // Draw Upper Functions
    upperFuncs.forEach(f => drawFunctionSegment(f, xValues));

    // Draw Lower Functions
    lowerFuncs.forEach(f => drawFunctionSegment(f, xValues));

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

// ============================================
// DISC METHOD VISUALIZATION
// ============================================

function createDisks(a, b, n, angleRad) {
    const dx = (b - a) / n;
    const geometries = [];

    // Precompile functions for speed
    const compiledUpper = upperFuncs.map(f => ({
        func: (x) => safeEval(preprocessInput(f.expr), x),
        range: [
            f.rangeStart !== '' ? safeEval(preprocessInput(f.rangeStart), 0) : -Infinity,
            f.rangeEnd !== '' ? safeEval(preprocessInput(f.rangeEnd), 0) : Infinity
        ]
    }));

    const compiledLower = lowerFuncs.map(f => ({
        func: (x) => safeEval(preprocessInput(f.expr), x),
        range: [
            f.rangeStart !== '' ? safeEval(preprocessInput(f.rangeStart), 0) : -Infinity,
            f.rangeEnd !== '' ? safeEval(preprocessInput(f.rangeEnd), 0) : Infinity
        ]
    }));

    // Helper to evaluate max/min at scalar x
    const evalSet = (compiledList, x, mode) => {
        const active = compiledList.filter(f => x >= f.range[0] && x <= f.range[1]);
        if (active.length === 0) return 0;
        const values = active.map(f => f.func(x)).filter(v => isFinite(v));
        if (values.length === 0) return 0;
        return mode === 'max' ? Math.max(...values) : Math.min(...values);
    };

    for (let i = 0; i < n; i++) {
        // Midpoint Riemman Sum
        const xMid = a + dx * (i + 0.5);

        const yUpper = evalSet(compiledUpper, xMid, 'max');
        const yLower = evalSet(compiledLower, xMid, 'max');

        let rOuter, rInner;
        if (yUpper * yLower < 0) {
            rOuter = Math.max(Math.abs(yUpper), Math.abs(yLower));
            rInner = 0;
        } else {
            const r1 = Math.abs(yUpper);
            const r2 = Math.abs(yLower);
            rOuter = Math.max(r1, r2);
            rInner = Math.min(r1, r2);
        }

        if (rOuter < 0.001) continue;

        const shape = new THREE.Shape();
        if (angleRad >= Math.PI * 2 - 0.01) {
            shape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
            if (rInner > 0.001) {
                const hole = new THREE.Path();
                hole.absarc(0, 0, rInner, 0, Math.PI * 2, true);
                shape.holes.push(hole);
            }
        } else {
            shape.moveTo(rOuter, 0);
            shape.absarc(0, 0, rOuter, 0, angleRad, false);
            shape.lineTo(rInner * Math.cos(angleRad), rInner * Math.sin(angleRad));
            if (rInner > 0.001) {
                shape.absarc(0, 0, rInner, angleRad, 0, true);
            } else {
                shape.lineTo(0, 0);
            }
            shape.lineTo(rOuter, 0);
        }

        const extrudeSettings = {
            depth: dx * 0.9,
            bevelEnabled: false,
            curveSegments: 12
        };

        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geom.rotateY(Math.PI / 2);
        geom.translate(a + dx * i, 0, 0);

        geometries.push(geom);
    }

    if (geometries.length === 0) return null;

    if (typeof BufferGeometryUtils !== 'undefined' && BufferGeometryUtils.mergeGeometries) {
        return BufferGeometryUtils.mergeGeometries(geometries);
    } else {
        console.warn('BufferGeometryUtils missing');
        return geometries[0];
    }
}

function removeSolid() {
    if (solidMesh) {
        scene.remove(solidMesh);
        solidMesh.geometry.dispose();
        solidMesh.material.dispose();
        solidMesh = null;
    }
    profileLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
    });
    profileLines = [];
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
    if (wireframeMesh) {
        scene.remove(wireframeMesh);
        wireframeMesh.geometry.dispose();
        wireframeMesh.material.dispose();
        wireframeMesh = null;
    }
}

function showError(show) {
    errorOverlay.classList.toggle('hidden', !show);
}

function updateMeasurements(a, b, angleDeg) {
    const n = 1000;
    const dx = (b - a) / n;

    // Generate x values
    const xValues = [];
    for (let i = 0; i <= n; i++) {
        xValues.push(a + i * dx);
    }

    // Evaluate using Piecewise logic
    const yUpper = evaluatePiecewise(upperFuncs, xValues, 'max');
    const yLower = evaluatePiecewise(lowerFuncs, xValues, 'max');

    let volume = 0;
    let area2D = 0;

    for (let i = 0; i < n; i++) {
        // Use average value for the segment
        const u_avg = (yUpper[i] + yUpper[i + 1]) / 2;
        const l_avg = (yLower[i] + yLower[i + 1]) / 2;

        let rOuter, rInner;

        if (u_avg * l_avg < 0) {
            // Opposite signs: region spans axis -> solid disc
            rOuter = Math.max(Math.abs(u_avg), Math.abs(l_avg));
            rInner = 0;
        } else {
            // Same sign: washer
            const r1 = Math.abs(u_avg);
            const r2 = Math.abs(l_avg);
            rOuter = Math.max(r1, r2);
            rInner = Math.min(r1, r2);
        }

        volume += (rOuter * rOuter - rInner * rInner) * dx;
        area2D += Math.abs(u_avg - l_avg) * dx;
    }

    // Volume depends on Angle
    const ratio = angleDeg / 360;
    volume = Math.abs(Math.PI * volume * ratio);

    // Update UI
    if (volumeValue) volumeValue.textContent = volume.toFixed(2);
    const areaValueElem = document.getElementById('area-value');
    if (areaValueElem) areaValueElem.textContent = area2D.toFixed(2);

    // Hide formula
    const volFormulaElem = document.getElementById('volume-formula');
    if (volFormulaElem) volFormulaElem.parentElement.style.display = 'none';
}


// ============================================
// DYNAMIC UI LOGIC
// ============================================

function renderFunctionList(type) {
    const isUpper = type === 'upper';
    const list = isUpper ? upperFuncs : lowerFuncs;
    const container = isUpper ? upperFuncsContainer : lowerFuncsContainer;
    container.innerHTML = '';

    list.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'func-item';
        div.innerHTML = `
            <div class="func-item-row top-row">
                <div class="color-pickers">
                    <input type="color" value="${item.color}" id="color-${type}-${index}">
                </div>
                
                <div class="input-col">
                     <input type="text" value="${item.expr}" id="input-${type}-${index}" placeholder="Nhập hàm số (ví dụ: x+1)">
                     <!-- INLINE PREVIEW -->
                     <div class="latex-mini" id="preview-${type}-${index}"></div>
                </div>

                <button class="btn-remove" data-type="${type}" data-index="${index}" title="Xóa">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
            
            <div class="func-item-row range-row">
                <span>Từ x =</span>
                <input type="text" value="${item.rangeStart}" id="start-${type}-${index}" placeholder="-∞">
                <span>đến</span>
                <input type="text" value="${item.rangeEnd}" id="end-${type}-${index}" placeholder="+∞">
            </div>
        `;
        container.appendChild(div);

        // Event Listeners
        const colorInput = div.querySelector(`#color-${type}-${index}`);
        const exprInput = div.querySelector(`#input-${type}-${index}`);
        const startInput = div.querySelector(`#start-${type}-${index}`);
        const endInput = div.querySelector(`#end-${type}-${index}`);
        const removeBtn = div.querySelector('.btn-remove');
        const previewEl = div.querySelector(`#preview-${type}-${index}`);

        // Update Model on Change
        const updateModel = () => {
            item.color = colorInput.value;
            item.expr = exprInput.value;
            item.rangeStart = startInput.value;
            item.rangeEnd = endInput.value;
            // Debounce or immediate update? Immediate for now.
        };

        const updatePreview = () => {
            renderLatexPreview(exprInput.value, previewEl);
        };

        // Initial preview
        updatePreview();

        // Inputs trigger update on change
        [colorInput, startInput, endInput].forEach(inp => {
            inp.addEventListener('input', () => { // Use input for live color/text
                updateModel();
                updateSolid();
            });
        });

        // Expression input: update on change (Enter/Blur) to avoid heavy parse on every key
        // BUT update preview on input for responsiveness
        exprInput.addEventListener('input', () => {
            updatePreview();
        });

        exprInput.addEventListener('change', () => {
            updateModel();
            updateSolid();
        });
        // Also support Enter key
        exprInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                updateModel();
                updateSolid();
            }
        });

        // Remove Button
        removeBtn.addEventListener('click', () => {
            if (list.length > 1) {
                list.splice(index, 1);
                renderFunctionList(type);
                updateSolid();
            } else {
                // Don't allow deleting the last one? Or allow and show 0?
                // Let's allow deleting but ensure at least 0 is rendered if empty?
                // For now, prevent deleting last one to keep UI simple.
                alert('Cần ít nhất một hàm!');
            }
        });
    });
}

function addNewFunction(type) {
    const list = type === 'upper' ? upperFuncs : lowerFuncs;
    const newColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
    list.push({ id: Date.now().toString(), expr: '0', color: newColor, rangeStart: '', rangeEnd: '' });
    renderFunctionList(type);
    updateSolid();
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Helper to update solid from global inputs
    const globalUpdate = () => updateSolid();

    inputA.addEventListener('change', globalUpdate);
    inputB.addEventListener('change', globalUpdate);
    sliderAngle.addEventListener('input', globalUpdate);

    // Render Mode Logic
    const renderModeSelect = document.getElementById('render-mode');
    const diskCountGroup = document.getElementById('disk-count-group');
    const sliderDiskCount = document.getElementById('slider-disk-count');
    const valueDiskCount = document.getElementById('value-disk-count');

    if (renderModeSelect) {
        renderModeSelect.addEventListener('change', () => {
            if (renderModeSelect.value === 'disks') {
                diskCountGroup.style.display = 'block';
            } else {
                diskCountGroup.style.display = 'none';
            }
            updateSolid();
        });
    }

    if (sliderDiskCount) {
        sliderDiskCount.addEventListener('input', () => {
            valueDiskCount.textContent = sliderDiskCount.value;
            updateSolid();
        });
    }

    // Auto Sweep: Stop on manual interaction
    sliderAngle.addEventListener('input', () => {
        if (isSweeping) {
            isSweeping = false;
            const btn = document.getElementById('btn-sweep');
            if (btn) btn.textContent = '▶';
        }
    });

    // Auto Sweep Button
    const btnSweep = document.getElementById('btn-sweep');
    if (btnSweep) {
        btnSweep.addEventListener('click', () => {
            isSweeping = !isSweeping;
            if (isSweeping) {
                sliderAngle.value = 0;
                updateSolid();
                btnSweep.textContent = '⏹';
            } else {
                btnSweep.textContent = '▶';
            }
        });
    }

    // Opacity
    // Opacity
    sliderOpacity.addEventListener('input', () => {
        const opacity = sliderOpacity.value / 100;
        valueOpacity.textContent = opacity.toFixed(2);
        if (solidMesh) {
            solidMesh.material.opacity = opacity;
            solidMesh.visible = opacity > 0;

            // Toggle Transparency Mode dynamically
            const isTransparent = opacity < 0.99;
            if (solidMesh.material.transparent !== isTransparent) {
                solidMesh.material.transparent = isTransparent;
                solidMesh.material.depthWrite = !isTransparent;
                solidMesh.material.needsUpdate = true;
            }
        }
    });

    // Color Mode

    // ... (existing code)

    // Color Mode
    const toggleColorModes = () => {
        const mode = colorModeSelect.value;
        if (mode === 'solid') {
            colorSolid.classList.remove('hidden');
            colorStart.classList.add('hidden');
            colorMid.classList.add('hidden');
            colorEnd.classList.add('hidden');
        } else {
            colorSolid.classList.add('hidden');
            colorStart.classList.remove('hidden');
            colorMid.classList.remove('hidden');
            colorEnd.classList.remove('hidden');
        }
        updateSolid();
    };

    colorModeSelect.addEventListener('change', toggleColorModes);
    colorSolid.addEventListener('input', updateSolid);
    colorStart.addEventListener('input', updateSolid);
    colorMid.addEventListener('input', updateSolid);
    colorEnd.addEventListener('input', updateSolid);

    // Initial call to set correct state
    toggleColorModes();

    // Share Button Logic
    document.getElementById('btn-share').addEventListener('click', () => {
        const state = {
            upper: upperFuncs,
            lower: lowerFuncs,
            bounds: { a: inputA.value, b: inputB.value },
            visuals: {
                angle: sliderAngle.value,
                opacity: sliderOpacity.value,
                mode: colorModeSelect.value,
                autoRotate: controls.autoRotate, // Save auto rotate state
                colors: {
                    solid: colorSolid.value,
                    start: colorStart.value,
                    mid: colorMid.value,
                    end: colorEnd.value
                }
            }
        };

        try {
            const json = JSON.stringify(state);
            const b64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
                }));

            const url = `${window.location.origin}${window.location.pathname}#${b64}`;
            navigator.clipboard.writeText(url).then(() => {
                showToast();
            });
        } catch (e) {
            console.error('Serialization Failed', e);
            alert('Lỗi tạo link chia sẻ!');
        }
    });

    // Sidebar Toggle
    const toggleBtn = document.getElementById('sidebar-toggle');
    const panel = document.getElementById('panel-wrapper'); // Target the wrapper
    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
        });
    }

    // Check for Shared State on Load
    if (window.location.hash) {
        try {
            const b64 = window.location.hash.substring(1);
            const json = decodeURIComponent(atob(b64).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            const state = JSON.parse(json);
            restoreState(state);
        } catch (e) {
            console.error('Deserialization Failed', e);
            // Non-blocking, just ignore invalid hash
        }
    } else {
        // Initial Data Default
        renderFunctionList('upper');
        renderFunctionList('lower');
        updateSolid();


        // Wireframe
        toggleWireframe.addEventListener('change', updateSolid);

        // Auto Rotate
        const toggleRotate = document.getElementById('toggle-rotate');
        if (toggleRotate) {
            toggleRotate.addEventListener('change', () => {
                if (toggleRotate.checked) {
                    // Determine if we need to smooth reset or just start
                    if (controls.target.lengthSq() > 0.01) {
                        isResettingCamera = true;
                        controls.autoRotate = false; // Wait for reset
                    } else {
                        controls.autoRotate = true;
                    }
                } else {
                    controls.autoRotate = false;
                    isResettingCamera = false;
                }
                controls.autoRotateSpeed = 2.0;
            });
        }

        // Save Image
        const btnSaveImage = document.getElementById('btn-save-image');
        if (btnSaveImage) {
            btnSaveImage.addEventListener('click', () => {
                renderer.render(scene, camera);
                const dataURL = renderer.domElement.toDataURL('image/png');
                const link = document.createElement('a');
                link.download = 'solid-of-revolution.png';
                link.href = dataURL;
                link.click();
            });
        }
    }

    // Dynamic List Buttons
    btnAddUpper.addEventListener('click', () => addNewFunction('upper'));
    btnAddLower.addEventListener('click', () => addNewFunction('lower'));
}

// ============================================
// INITIALIZATION
// ============================================

try {
    initThreeJS();
    setupEventListeners();

    // Initial Data
    renderFunctionList('upper');
    renderFunctionList('lower');

    // Initial Draw
    updateSolid();
} catch (error) {
    console.error("App Initialization Error:", error);
    alert("Lỗi khởi chạy ứng dụng: " + error.message + "\nVui lòng F5 lại hoặc kiểm tra Console.");
}

function showToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function restoreState(state) {
    if (!state) return;

    // Functions
    upperFuncs.length = 0;
    if (state.upper) state.upper.forEach(f => upperFuncs.push(f));

    lowerFuncs.length = 0;
    if (state.lower) state.lower.forEach(f => lowerFuncs.push(f));

    // Bounds
    if (state.bounds) {
        inputA.value = state.bounds.a;
        inputB.value = state.bounds.b;
    }

    // Visuals
    if (state.visuals) {
        sliderAngle.value = state.visuals.angle || 360;
        valueAngle.textContent = sliderAngle.value + '°';

        sliderOpacity.value = state.visuals.opacity || 75;
        const opVal = sliderOpacity.value / 100;
        valueOpacity.textContent = opVal.toFixed(2);

        colorModeSelect.value = state.visuals.mode || 'gradient-x';

        // Auto Rotate
        if (state.visuals.autoRotate !== undefined) {
            controls.autoRotate = state.visuals.autoRotate;
            const toggleRotate = document.getElementById('toggle-rotate');
            if (toggleRotate) toggleRotate.checked = state.visuals.autoRotate;
        }

        if (state.visuals.colors) {
            colorSolid.value = state.visuals.colors.solid || '#4ECDC4';
            colorStart.value = state.visuals.colors.start || '#FF9A9E';
            colorMid.value = state.visuals.colors.mid || '#a18cd1';
            colorEnd.value = state.visuals.colors.end || '#4ECDC4';
        }
    }

    // UI Update triggers
    renderFunctionList('upper');
    renderFunctionList('lower');

    // Force event trigger for color mode UI update
    const event = new Event('change');
    colorModeSelect.dispatchEvent(event);

    updateSolid();
}


