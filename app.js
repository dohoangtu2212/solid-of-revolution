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
let profileLine = null;
let axisObjects = []; // Track axis objects for dynamic updates

// DOM Elements
const inputF = document.getElementById('input-f');
const inputG = document.getElementById('input-g');
const previewF = document.getElementById('preview-f');
const previewG = document.getElementById('preview-g');
const sliderA = document.getElementById('slider-a');
const sliderB = document.getElementById('slider-b');
const sliderAngle = document.getElementById('slider-angle');
const valueA = document.getElementById('value-a');
const valueB = document.getElementById('value-b');
const valueAngle = document.getElementById('value-angle');
const volumeFormula = document.getElementById('volume-formula');
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

    // Replace ^ with ** for exponentiation
    s = s.replace(/\^/g, '**');

    // Add implicit multiplication
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
        'log10': 'Math.log10',
        'log2': 'Math.log2',
        'ln': 'Math.log',
        'log': 'Math.log',
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
        const func = new Function('x', 'Math', `return ${expr}`);
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

    const latexMap = {
        'log10': '\\log_{10}',
        'log2': '\\log_{2}',
        'ln': '\\ln',
        'log': '\\ln',
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
    scene.background = new THREE.Color(0x0f0f1a);

    // Camera
    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    camera.position.set(8, 6, 10);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasContainer.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 50;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(10, 15, 10);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    fillLight.position.set(-10, 5, -10);
    scene.add(fillLight);

    // Grid (static)
    const gridHelper = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

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
    let a = sliderA.value / 10;
    let b = sliderB.value / 10;
    const angleDeg = parseInt(sliderAngle.value);
    const angleRad = (angleDeg * Math.PI) / 180;

    // Update labels
    valueA.textContent = a.toFixed(2);
    valueB.textContent = b.toFixed(2);
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

    // Remove existing meshes
    removeSolid();

    // ====== CREATE WASHER SOLID ======
    // Outer surface: f(x), Inner surface: g(x)
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

    // Add outer surface (f(x))
    let vertexCount = 0;
    vertexCount += addSurface(yOuter, vertexCount, false);

    // Add inner surface (g(x)) - with flipped normals
    const innerStartIdx = vertexCount;
    vertexCount += addSurface(yInner, innerStartIdx, true);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Material
    const material = new THREE.MeshPhongMaterial({
        color: CONFIG.solidColor,
        transparent: true,
        opacity: CONFIG.solidOpacity,
        side: THREE.DoubleSide,
        shininess: 80,
        specular: 0x444444,
    });

    solidMesh = new THREE.Mesh(geometry, material);
    scene.add(solidMesh);

    // ====== CREATE PROFILE LINES ======
    // Show both f(x) and g(x) edges on the XY plane (z=0)

    const profilePoints = [];

    // Outer curve f(x) - top edge at theta=0
    for (let i = 0; i <= CONFIG.resolution; i++) {
        const x = xValues[i];
        const y = Math.abs(yOuter[i]);
        profilePoints.push(new THREE.Vector3(x, y, 0));
    }

    // Connect outer to inner at x=b
    const lastX = xValues[CONFIG.resolution];
    profilePoints.push(new THREE.Vector3(lastX, Math.abs(yInner[CONFIG.resolution]), 0));

    // Inner curve g(x) - going back
    for (let i = CONFIG.resolution - 1; i >= 0; i--) {
        const x = xValues[i];
        const y = Math.abs(yInner[i]);
        profilePoints.push(new THREE.Vector3(x, y, 0));
    }

    // Connect inner to outer at x=a
    profilePoints.push(new THREE.Vector3(xValues[0], Math.abs(yOuter[0]), 0));

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(profilePoints);
    const lineMaterial = new THREE.LineBasicMaterial({
        color: CONFIG.profileColor,
        linewidth: 2,
    });
    profileLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(profileLine);

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

    // Calculate volume
    calculateVolume(a, b, angleDeg);
}

function removeSolid() {
    if (solidMesh) {
        scene.remove(solidMesh);
        solidMesh.geometry.dispose();
        solidMesh.material.dispose();
        solidMesh = null;
    }
    if (profileLine) {
        scene.remove(profileLine);
        profileLine.geometry.dispose();
        profileLine.material.dispose();
        profileLine = null;
    }
}

function showError(show) {
    errorOverlay.classList.toggle('hidden', !show);
}

function calculateVolume(a, b, angleDeg) {
    const n = 1000;
    const dx = (b - a) / n;
    let volume = 0;

    const fProcessed = preprocessInput(inputF.value);
    const gProcessed = preprocessInput(inputG.value);

    for (let i = 0; i < n; i++) {
        const x = a + (i + 0.5) * dx;
        const fVal = safeEval(fProcessed, x);
        const gVal = safeEval(gProcessed, x);

        if (isFinite(fVal) && isFinite(gVal)) {
            const rOuter = Math.abs(fVal);
            const rInner = Math.abs(gVal);
            volume += (rOuter * rOuter - rInner * rInner) * dx;
        }
    }

    volume = Math.PI * volume * (angleDeg / 360);

    if (isFinite(volume)) {
        volumeValue.textContent = volume.toFixed(4);
    } else {
        volumeValue.textContent = '--';
    }

    try {
        katex.render(`V = \\pi \\int_{${a.toFixed(1)}}^{${b.toFixed(1)}} [f(x)^2 - g(x)^2] \\, dx`, volumeFormula, {
            throwOnError: false,
        });
    } catch (e) {
        volumeFormula.textContent = 'V = π ∫[f(x)² - g(x)²] dx';
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

    sliderA.addEventListener('input', updateSolid);
    sliderB.addEventListener('input', updateSolid);
    sliderAngle.addEventListener('input', updateSolid);
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
    console.log('Initializing Solid of Revolution Visualizer...');
    initThreeJS();
    setupEventListeners();

    // Initial previews
    renderLatexPreview(inputF.value, previewF);
    renderLatexPreview(inputG.value, previewG);

    // Initial solid
    updateSolid();
    console.log('Initialization complete!');
}

// Start
init();
