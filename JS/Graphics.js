// graphics.js (version 2) - load this LAST (after script.js, map.js and extras/map2.js).
// Realistic look: shadows, filmic lighting, sky + sun + clouds + stars, reflections,
// textured grass and roads, a detailed car (also used for the NPC cars), varied trees,
// reflective building windows, and a day/night cycle (press N) with headlights.
(function () {

    // ---------- SETTINGS (tweak these) ----------
    const SHADOWS = true;        // set false if the game runs slowly
    const SHADOW_SIZE = 2048;    // 1024 = faster, 4096 = sharper
    const SHADOW_RANGE = 100;    // shadows are drawn this far around the car
    const EXPOSURE = 1.0;        // overall brightness (daytime)
    const SUN_POWER = 2.4;       // sunlight strength
    const HAZE = 0xc4dcef;       // colour of the horizon
    const ZENITH = 0x2a73c9;     // colour of the sky straight up
    const FOG_DENSITY = 0;       // 0 = no fog. Try 0.0015 for soft distance haze that hides trees popping in
    const SUN_OFFSET = new THREE.Vector3(130, 95, 110); // sun position relative to the car (lower = longer shadows)

    // ---------- RENDERER ----------
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.shadowMap.enabled = SHADOWS;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    let night = false;
    const buildingMats = [];     // building materials (their windows light up at night)

    function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
    function fixed(mat) { mat.userData.srgbFixed = true; return mat; }

    // ---------- PROCEDURAL TEXTURES ----------
    function canvasTex(size, draw, isData) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        draw(c.getContext('2d'), size);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.encoding = isData ? THREE.LinearEncoding : THREE.sRGBEncoding;
        t.anisotropy = maxAniso;
        return t;
    }

    const grassTex = canvasTex(256, (g, s) => {
        g.fillStyle = '#3d8a38';
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 30; i++) {
            const x = Math.random() * s, y = Math.random() * s, r = 20 + Math.random() * 40;
            const grad = g.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, Math.random() < 0.5 ? 'rgba(20,60,20,0.18)' : 'rgba(120,170,70,0.14)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = grad;
            g.fillRect(0, 0, s, s);
        }
        for (let i = 0; i < 6000; i++) {
            g.fillStyle = 'hsl(' + (90 + Math.random() * 35) + ',45%,' + (22 + Math.random() * 26) + '%)';
            g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 3);
        }
    });

    const asphaltTex = canvasTex(256, (g, s) => {
        g.fillStyle = '#4b4b50';
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 9000; i++) {
            const v = 50 + Math.random() * 60;
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 4) + ')';
            g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
        }
        g.strokeStyle = 'rgba(20,20,22,0.35)';
        for (let i = 0; i < 6; i++) {
            g.beginPath();
            let x = Math.random() * s, y = Math.random() * s;
            g.moveTo(x, y);
            for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
            g.stroke();
        }
    });

    const cloudTex = canvasTex(128, (g, s) => {
        for (let i = 0; i < 7; i++) {
            const x = s * (0.25 + Math.random() * 0.5), y = s * (0.35 + Math.random() * 0.3);
            const r = s * (0.18 + Math.random() * 0.18);
            const grad = g.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(255,255,255,0.55)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grad;
            g.fillRect(0, 0, s, s);
        }
    });

    const glowTex = canvasTex(128, (g, s) => {
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
    });

    // Building windows: one tile has 4 x 4 windows. Three matching textures:
    // the picture (day), the glow (night), and gloss (windows are shiny, walls are not).
    const WIN_COLS = 4, WIN_ROWS = 4;
    const winLit = [];
    for (let i = 0; i < WIN_COLS * WIN_ROWS; i++) winLit.push(Math.random() < 0.45 ? (Math.random() < 0.15 ? 2 : 1) : 0);
    function eachWindow(fn) {
        for (let r = 0; r < WIN_ROWS; r++) {
            for (let c = 0; c < WIN_COLS; c++) fn(8 + c * 30, 8 + r * 30, 20, 22, winLit[r * WIN_COLS + c]);
        }
    }
    const winDayTex = canvasTex(128, (g, s) => {
        g.fillStyle = '#c9ccd1';
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 400; i++) {
            const v = 170 + Math.random() * 50;
            g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 5) + ')';
            g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
        }
        eachWindow((x, y, w, h) => {
            const grad = g.createLinearGradient(x, y, x, y + h);
            grad.addColorStop(0, '#5d86a8');
            grad.addColorStop(1, '#1f3347');
            g.fillStyle = grad;
            g.fillRect(x, y, w, h);
            g.fillStyle = '#9aa0a8';
            g.fillRect(x - 1, y + h, w + 2, 2);
        });
    });
    const winEmitTex = canvasTex(128, (g, s) => {
        g.fillStyle = '#000000';
        g.fillRect(0, 0, s, s);
        eachWindow((x, y, w, h, lit) => {
            if (!lit) return;
            g.fillStyle = lit === 2 ? '#bfe0ff' : (Math.random() < 0.5 ? '#ffd98a' : '#ffc766');
            g.fillRect(x, y, w, h);
        });
    });
    const winRMTex = canvasTex(128, (g, s) => {
        g.fillStyle = 'rgb(0,205,0)';
        g.fillRect(0, 0, s, s);
        eachWindow((x, y, w, h) => {
            g.fillStyle = 'rgb(0,25,210)';
            g.fillRect(x, y, w, h);
        });
    }, true);

    // ---------- SKY ----------
    const DAY = {
        top: ZENITH, horizon: HAZE, sunCol: [1.0, 0.85, 0.6], stars: 0,
        sunLight: 0xfff0d8, sunPower: SUN_POWER,
        hemi: 0.55, hemiSky: 0xcfe6ff, hemiGround: 0x4a5a38, exposure: EXPOSURE
    };
    const NIGHT = {
        top: 0x040816, horizon: 0x101c33, sunCol: [0.55, 0.65, 1.0], stars: 1,
        sunLight: 0x9fb4ff, sunPower: 0.5,
        hemi: 0.2, hemiSky: 0x2a3a5c, hemiGround: 0x0c120c, exposure: 1.3
    };

    const SKY_VERT = [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');

    const SKY_FRAG = [
        'uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;',
        'uniform float uStars; uniform float uLinear;',
        'varying vec3 vDir;',
        'float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  float h = clamp(d.y, 0.0, 1.0);',
        '  vec3 col = mix(uHorizon, uTop, pow(h, 0.45));',
        '  float sd = max(dot(d, normalize(uSunDir)), 0.0);',
        '  col += uSunCol * (pow(sd, 8.0) * 0.25 + pow(sd, 400.0) * 1.5);',
        '  if (uStars > 0.5 && d.y > 0.0) {',
        '    float s = step(0.9975, hash(floor(d * 260.0)));',
        '    col += vec3(s) * smoothstep(0.02, 0.35, d.y);',
        '  }',
        '  if (d.y < 0.0) col = uHorizon * 0.92;',
        '  if (uLinear > 0.5) col = pow(col, vec3(2.2));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
    ].join('\n');

    function skyMaterial(linear, cfg) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTop: { value: new THREE.Color(cfg.top) },
                uHorizon: { value: new THREE.Color(cfg.horizon) },
                uSunDir: { value: SUN_OFFSET.clone().normalize() },
                uSunCol: { value: new THREE.Color(cfg.sunCol[0], cfg.sunCol[1], cfg.sunCol[2]) },
                uStars: { value: cfg.stars },
                uLinear: { value: linear ? 1 : 0 }
            },
            vertexShader: SKY_VERT,
            fragmentShader: SKY_FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            fog: false
        });
    }

    const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), skyMaterial(false, DAY));
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    scene.add(sky);

    // Optional soft haze (off by default)
    if (FOG_DENSITY > 0) scene.fog = new THREE.FogExp2(HAZE, FOG_DENSITY);
    else if (scene.fog) scene.fog.color.setHex(HAZE);

    // Clouds
    const clouds = new THREE.Group();
    for (let i = 0; i < 28; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
            color: new THREE.Color(1.15, 1.15, 1.15)
        }));
        const a = Math.random() * Math.PI * 2, r = 500 + Math.random() * 1300;
        sp.position.set(Math.cos(a) * r, 300 + Math.random() * 350, Math.sin(a) * r);
        sp.scale.set(260 + Math.random() * 220, 90 + Math.random() * 60, 1);
        sp.frustumCulled = false;
        clouds.add(sp);
    }
    scene.add(clouds);

    sky.onBeforeRender = function (r, s, cam) {
        sky.position.copy(cam.position);
        sky.updateMatrixWorld(true);
        clouds.position.set(cam.position.x, 0, cam.position.z);
        clouds.updateMatrixWorld(true);
    };

    // Reflections: the sky is baked into an environment map (re-baked when day/night changes)
    let envTarget = null;
    function bakeEnv(cfg) {
        try {
            const pmrem = new THREE.PMREMGenerator(renderer);
            const envScene = new THREE.Scene();
            envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(true, cfg)));
            const rt = pmrem.fromScene(envScene, 0.02);
            if (envTarget) envTarget.dispose();
            envTarget = rt;
            scene.environment = rt.texture;
            pmrem.dispose();
        } catch (e) {
            console.warn('graphics.js: reflections unavailable', e);
        }
    }
    bakeEnv(DAY);

    // ---------- LIGHTING ----------
    scene.children.filter(c => c.isAmbientLight).forEach(c => scene.remove(c));
    const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
    scene.add(hemi);

    sun.color.set(DAY.sunLight);
    sun.intensity = DAY.sunPower;
    sun.castShadow = SHADOWS;
    sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_RANGE; sc.right = SHADOW_RANGE;
    sc.top = SHADOW_RANGE; sc.bottom = -SHADOW_RANGE;
    sc.near = 10; sc.far = 500;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.4;
    scene.add(sun.target);

    // ---------- THE CAR ----------
    let carPaint = null;

    (function rebuildCar() {
        const old = carMesh.children.filter(c => c.geometry && c.geometry.type === 'BoxGeometry' &&
            Math.abs(c.geometry.parameters.height - 0.6) < 0.01);
        const paintHex = old.length ? old[0].material.color.getHex() : 0xd32f2f;
        old.forEach(c => carMesh.remove(c));

        const paint = fixed(new THREE.MeshPhysicalMaterial({
            color: lin(paintHex), metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08
        }));
        carPaint = paint;
        const glass = fixed(new THREE.MeshPhysicalMaterial({
            color: lin(0x14202c), metalness: 0.9, roughness: 0.05, envMapIntensity: 1.4
        }));
        const dark = fixed(new THREE.MeshStandardMaterial({ color: lin(0x111214), roughness: 0.7, metalness: 0.2 }));
        const plate = fixed(new THREE.MeshStandardMaterial({ color: lin(0xf2f2f2), roughness: 0.5 }));

        // Lower body: side profile (length, height) extruded to the car's width
        const prof = new THREE.Shape();
        prof.moveTo(-2.1, 0);
        prof.lineTo(2.1, 0);
        prof.lineTo(2.1, 0.5);
        prof.lineTo(1.4, 0.68);
        prof.lineTo(0.6, 0.72);
        prof.lineTo(-1.6, 0.72);
        prof.lineTo(-2.1, 0.62);
        prof.lineTo(-2.1, 0);
        const bodyGeo = new THREE.ExtrudeGeometry(prof, {
            depth: 1.7, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3, curveSegments: 6
        });
        bodyGeo.translate(0, 0, -0.85);
        bodyGeo.rotateY(Math.PI / 2);
        const bodyMesh = new THREE.Mesh(bodyGeo, paint);
        bodyMesh.position.y = -0.38;
        carMesh.add(bodyMesh);

        // Cabin: sloped windscreen and rear window
        const cab = new THREE.Shape();
        cab.moveTo(0.7, 0.72);
        cab.lineTo(0.1, 1.22);
        cab.lineTo(-1.0, 1.22);
        cab.lineTo(-1.55, 0.72);
        cab.lineTo(0.7, 0.72);
        const cabGeo = new THREE.ExtrudeGeometry(cab, {
            depth: 1.5, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2
        });
        cabGeo.translate(0, 0, -0.75);
        cabGeo.rotateY(Math.PI / 2);
        const cabMesh = new THREE.Mesh(cabGeo, glass);
        cabMesh.position.y = -0.38;
        carMesh.add(cabMesh);

        const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.1, 1.2), paint);
        roof.position.set(0, 0.93, 0.45);
        carMesh.add(roof);

        [-1, 1].forEach(s => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.26), paint);
            m.position.set(s * 1.08, 0.45, -0.7);
            carMesh.add(m);
        });

        // Front grille, bumper strip, number plates and side skirt
        const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.06), dark);
        grille.position.set(0, -0.08, -2.23);
        carMesh.add(grille);
        const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.08), dark);
        bumper.position.set(0, -0.36, -2.2);
        carMesh.add(bumper);
        const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.04), plate);
        frontPlate.position.set(0, -0.28, -2.25);
        carMesh.add(frontPlate);
        const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.04), plate);
        rearPlate.position.set(0, -0.2, 2.25);
        carMesh.add(rearPlate);
        const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.08), dark);
        rearBumper.position.set(0, -0.36, 2.2);
        carMesh.add(rearBumper);
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.1, 3.4), dark);
        skirt.position.set(0, -0.44, 0);
        carMesh.add(skirt);

        // Tail lights
        const tail = fixed(new THREE.MeshBasicMaterial({ color: lin(0xff1a1a) }));
        [-1, 1].forEach(s => {
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.1), tail);
            t.position.set(s * 0.62, -0.05, 2.22);
            carMesh.add(t);
        });

        // Headlights move to the new nose
        carMesh.children.filter(c => c.geometry && c.geometry.type === 'BoxGeometry' &&
            Math.abs(c.geometry.parameters.height - 0.2) < 0.01).forEach(h => {
            h.position.set(Math.sign(h.position.x) * 0.65, -0.05, -2.22);
        });

        // Hubcaps
        const hubMat = fixed(new THREE.MeshStandardMaterial({ color: lin(0xb4b8bd), metalness: 1, roughness: 0.3 }));
        carMesh.children.filter(c => c.geometry && c.geometry.type === 'CylinderGeometry').forEach(w => {
            w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.42, 16), hubMat));
        });
    })();

    // Real headlight beams (only switched on at night)
    const beams = [];
    const beamCones = [];
    [-0.65, 0.65].forEach(x => {
        const s = new THREE.SpotLight(0xfff3d0, 0, 1000, 1, 0.55, 0);
        s.position.set(x, 0.25, -2.2);
        s.target.position.set(x * 0.4, -1.2, -35);
        carMesh.add(s);
        carMesh.add(s.target);
        beams.push(s);

        // Visible soft light pool on the road right ahead of the car
        const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(14, 38),
            new THREE.MeshBasicMaterial({
                map: glowTex,
                color: lin(0xfff0c8),
                transparent: true,
                opacity: 0.42,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -7,
                polygonOffsetUnits: -7
            })
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x * 1.4, -0.72, -19);
        pool.visible = false;
        carMesh.add(pool);
        beamCones.push(pool);
    });

    // ---------- UPGRADE EVERY MATERIAL ----------
    const ASPHALT = new Set([0x2b2b2e, 0x38383c, 0x454545, 0x333336]);
    const hazeColor = new THREE.Color(HAZE);
    const cache = new Map();

    function addPlanarUV(geo, scale) {
        const p = geo.attributes.position;
        const uv = new Float32Array(p.count * 2);
        for (let i = 0; i < p.count; i++) {
            uv[2 * i] = p.getX(i) / scale;
            uv[2 * i + 1] = p.getZ(i) / scale;
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }

    function upgrade(m, mesh) {
        if (cache.has(m)) return cache.get(m);
        let out = m;
        if (m.isMeshLambertMaterial || m.isMeshPhongMaterial) {
            const hex = m.color.getHex();
            out = new THREE.MeshStandardMaterial({
                color: m.color.clone(), map: m.map || null, side: m.side,
                transparent: m.transparent, opacity: m.opacity,
                polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor,
                polygonOffsetUnits: m.polygonOffsetUnits,
                fog: m.fog, flatShading: !!m.flatShading, roughness: 0.85, metalness: 0
            });
            if (out.map) out.map.encoding = THREE.sRGBEncoding;

            if (ASPHALT.has(hex) && mesh.geometry.type === 'BufferGeometry') {
                if (!mesh.geometry.attributes.uv) addPlanarUV(mesh.geometry, 10);
                out.map = asphaltTex;
                out.bumpMap = asphaltTex;
                out.bumpScale = 0.7;
                out.color.lerp(new THREE.Color(0xffffff), 0.6);
                out.roughness = 0.92;
            }
            if (m.map && mesh.geometry.type === 'BoxGeometry') { // building walls
                const rx = Math.max(1, Math.round(m.map.repeat.x / 2));
                const ry = Math.max(1, Math.round(m.map.repeat.y / 2));
                const dayT = winDayTex.clone(), emT = winEmitTex.clone(), rmT = winRMTex.clone();
                [dayT, emT, rmT].forEach(t => { t.repeat.set(rx, ry); t.needsUpdate = true; });
                out.map = dayT;
                out.emissiveMap = emT;
                out.emissive.setRGB(1, 0.9, 0.7);
                out.emissiveIntensity = night ? 1.3 : 0;
                out.roughnessMap = rmT;
                out.metalnessMap = rmT;
                out.roughness = 1;
                out.metalness = 1;
                buildingMats.push(out);
            }
            if (hex === 0x2d7bb6 && m.transparent) { // lake
                out.roughness = 0.05;
                out.metalness = 0.2;
                out.envMapIntensity = 1.6;
            }
            if (m.fog === false) { // distant mountains
                out.color.lerp(hazeColor, 0.3);
                out.roughness = 0.95;
            }
        }
        if (out.color && !out.userData.srgbFixed) {
            out.color.convertSRGBToLinear();
            out.userData.srgbFixed = true;
        }
        cache.set(m, out);
        return out;
    }

    function addVertexColors(geo) {
        const p = geo.attributes.position;
        const col = new Float32Array(p.count * 3);
        const lo = new THREE.Color(0.72, 0.84, 0.68), hi = new THREE.Color(1.12, 1.12, 0.9);
        const c = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const n = Math.sin(x * 0.021) * Math.sin(z * 0.018) * 0.5 + Math.sin(x * 0.007 + z * 0.011) * 0.5;
            const t = Math.max(0, Math.min(1, 0.5 + n * 0.35 + y / 30));
            c.copy(lo).lerp(hi, t);
            col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }

    scene.traverse(o => {
        if (!o.isMesh || o === sky) return;
        const isArr = Array.isArray(o.material);
        const res = (isArr ? o.material : [o.material]).map(m => upgrade(m, o));
        o.material = isArr ? res : res[0];
        const mat = res[0];

        const isTerrain = o.geometry.type === 'PlaneGeometry' && o.geometry.parameters.width === 1900;
        const isGround = (typeof ground !== 'undefined') && o === ground;
        if (isTerrain || isGround) {
            const tex = grassTex.clone();
            tex.needsUpdate = true;
            const rep = (isTerrain ? 1900 : 10000) / 12;
            tex.repeat.set(rep, rep);
            mat.map = tex;
            mat.color.setRGB(1, 1, 1);
            mat.userData.srgbFixed = true;
            mat.roughness = 1;
            if (isTerrain) { addVertexColors(o.geometry); mat.vertexColors = true; }
        }

        if (o.isInstancedMesh) return;
        const t = o.geometry.type;
        const flat = t === 'PlaneGeometry' || t === 'CircleGeometry' || t === 'BufferGeometry';
        const far = mat.fog === false;
        o.receiveShadow = !far;
        o.castShadow = !flat && !far && !mat.transparent;
    });

    // ---------- TREES: PINES AND LEAFY TREES ----------
    function hash3(x, y, z, seed) {
        const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 19.19) * 43758.5453;
        return s - Math.floor(s);
    }
    // Bumps up a shape so it is not perfectly smooth (same point always moves the same way, so seams stay closed)
    function jitter(geo, amt, seed, full) {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            if (!full && Math.hypot(x, z) < 0.01) continue;
            const k = 1 + (hash3(x, y, z, seed) - 0.5) * amt;
            p.setX(i, x * k);
            p.setZ(i, z * k);
            p.setY(i, full ? y * k : y + (hash3(z, x, y, seed) - 0.5) * amt * 0.5);
        }
        return geo;
    }

    const pineSets = [0, 1, 2].map(seed =>
        [[2.1, 2.2, 2.3], [1.7, 2.2, 3.4], [1.3, 2.0, 4.5], [0.9, 1.8, 5.5]].map(t => ({
            geo: jitter(new THREE.ConeGeometry(t[0], t[1], 12, 2), 0.22, seed, false), y: t[2]
        })));
    const blobGeos = [0, 1].map(seed => jitter(new THREE.IcosahedronGeometry(1, 2), 0.3, seed, true));
    const blobSpots = [[0, 4.0, 0, 1.9], [0.9, 3.4, 0.4, 1.4], [-0.8, 3.5, -0.5, 1.5], [0.1, 4.9, 0.2, 1.3]];

    trees.forEach(tr => {
        const kids = tr.mesh.children;
        if (kids.length < 3) return;
        const trunk = kids[0], l1 = kids[1], l2 = kids[2];
        const leaf = l1.material.clone();
        tr.mesh.remove(l2);
        tr.mesh.remove(l1);
        trunk.material.roughness = 0.95;
        leaf.roughness = 0.8;

        const leafy = Math.random() < 0.35;
        if (leafy) {
            leaf.color.copy(lin(0x5a8f2e));
            trunk.scale.set(1.4, 1.5, 1.4);
            trunk.position.y = 1.5;
        }
        leaf.color.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.06);

        if (leafy) {
            const g = blobGeos[Math.floor(Math.random() * blobGeos.length)];
            blobSpots.forEach(b => {
                const m = new THREE.Mesh(g, leaf);
                m.position.set(b[0], b[1], b[2]);
                m.scale.setScalar(b[3]);
                m.castShadow = true;
                m.receiveShadow = true;
                tr.mesh.add(m);
            });
        } else {
            pineSets[Math.floor(Math.random() * pineSets.length)].forEach(t => {
                const m = new THREE.Mesh(t.geo, leaf);
                m.position.y = t.y;
                m.castShadow = true;
                m.receiveShadow = true;
                tr.mesh.add(m);
            });
        }
    });

    // ---------- NPC CARS: SAME MODEL AS YOUR CAR, DIFFERENT PAINT ----------
    (function npcCars() {
        const palette = [0x1976d2, 0xfbc02d, 0xf5f5f5, 0x2b2b2e, 0x388e3c, 0x7b1fa2, 0xff6f00, 0x90a4ae, 0x00897b, 0x5d4037];
        const groups = scene.children.filter(g => g.isGroup && g.children.length === 3 &&
            g.children[0].geometry && g.children[0].geometry.type === 'BoxGeometry' &&
            Math.abs(g.children[0].geometry.parameters.width - 2) < 0.01 &&
            Math.abs(g.children[0].geometry.parameters.height - 0.7) < 0.01);
        if (!groups.length || !carPaint) return;

        const parts = carMesh.children.filter(c => c.isMesh && !(c.material && c.material.wireframe));

        groups.forEach(g => {
            while (g.children.length) g.remove(g.children[0]);
            const inner = new THREE.Group();
            inner.position.y = -0.07; // traffic is positioned a touch higher than your car
            g.add(inner);

            const paint = carPaint.clone();
            paint.color.copy(lin(palette[Math.floor(Math.random() * palette.length)]));
            parts.forEach(p => {
                const c = p.clone();
                if (c.material === carPaint) c.material = paint;
                inner.add(c);
            });
        });
    })();

    // ---------- STREET LAMP GLOW (only visible at night) ----------
    let lampGlow = null;
    (function buildLampGlow() {
        const heads = scene.children.find(o => o.isInstancedMesh && o.geometry.type === 'SphereGeometry' &&
            Math.abs(o.geometry.parameters.radius - 0.7) < 0.01);
        if (!heads) return;
        const geo = new THREE.CircleGeometry(9, 24);
        geo.rotateX(-Math.PI / 2);
        lampGlow = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
            map: glowTex, color: lin(0xffc870), transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6
        }), heads.count);
        const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), o = new THREE.Object3D();
        for (let i = 0; i < heads.count; i++) {
            heads.getMatrixAt(i, m4);
            pos.setFromMatrixPosition(m4);
            o.position.set(pos.x, 0.2, pos.z);
            o.updateMatrix();
            lampGlow.setMatrixAt(i, o.matrix);
        }
        lampGlow.frustumCulled = false;
        lampGlow.visible = false;
        scene.add(lampGlow);
    })();

    // ---------- DAY / NIGHT (press N while playing) ----------
    function setNight(on) {
        night = on;
        const cfg = on ? NIGHT : DAY;
        const u = sky.material.uniforms;
        u.uTop.value.setHex(cfg.top);
        u.uHorizon.value.setHex(cfg.horizon);
        u.uSunCol.value.setRGB(cfg.sunCol[0], cfg.sunCol[1], cfg.sunCol[2]);
        u.uStars.value = cfg.stars;
        if (scene.fog && scene.fog.color) scene.fog.color.setHex(cfg.horizon);
        sun.color.set(cfg.sunLight);
        sun.intensity = cfg.sunPower;
        hemi.color.set(cfg.hemiSky);
        hemi.groundColor.set(cfg.hemiGround);
        hemi.intensity = cfg.hemi;
        renderer.toneMappingExposure = cfg.exposure;
        beams.forEach(b => { b.intensity = on ? 35 : 0; });
        beamCones.forEach(p => { p.visible = on; });
        if (lampGlow) lampGlow.visible = on;
        buildingMats.forEach(m => { m.emissiveIntensity = on ? 1.3 : 0; });
        clouds.visible = !on;
        bakeEnv(cfg);
    }

    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyN' && typeof gameState !== 'undefined' && gameState === 'playing') setNight(!night);
    });

    // ---------- EACH STEP: SUN FOLLOWS THE CAR, FOV GROWS WITH SPEED ----------
    world.addEventListener('postStep', function () {
        const cx = Math.round(carBody.position.x / 2) * 2;
        const cz = Math.round(carBody.position.z / 2) * 2;
        sun.target.position.set(cx, 0, cz);
        sun.position.set(cx + SUN_OFFSET.x, SUN_OFFSET.y, cz + SUN_OFFSET.z);

        const speedT = gameState === 'menu' ? 0 : Math.min(1, Math.abs(currentSpeed) / 100);
        const targetFov = 68 + speedT * 16;
        if (Math.abs(camera.fov - targetFov) > 0.01) {
            camera.fov += (targetFov - camera.fov) * 0.08;
            camera.updateProjectionMatrix();
        }
    });

    // ---------- CAMERA-LIKE VIGNETTE ----------
    const vignette = document.createElement('div');
    vignette.style.cssText =
        'position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:3;' +
        'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%);';
    document.body.appendChild(vignette);

})();