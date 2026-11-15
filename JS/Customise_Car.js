// customize.js - load this LAST (after slopes.js). Needs graphics.js (for the detailed car).
// Adds a "Customize" button to the main menu: car colour, paint finish, wraps and wheels.
(function () {

    // ---------- FIND THE PARTS OF YOUR CAR ----------
    // The paint material is the glossy one (clearcoat) on the car body that graphics.js built
    let paintMat = null;
    carMesh.traverse(o => {
        const m = o.material;
        if (!paintMat && o.isMesh && m && m.isMeshPhysicalMaterial && m.clearcoat === 1 &&
            o.geometry.type === 'ExtrudeGeometry') paintMat = m;
    });
    if (!paintMat) {
        console.error('customize.js: could not find the car body. Make sure graphics.js loads before customize.js.');
        return;
    }

    const paintMeshes = [], wheels = [];
    carMesh.traverse(o => {
        if (!o.isMesh) return;
        if (o.material === paintMat) paintMeshes.push(o);
        if (o.geometry.type === 'CylinderGeometry' && Math.abs(o.geometry.parameters.radiusTop - 0.45) < 0.01) wheels.push(o);
    });
    const bodyMesh = paintMeshes.find(o => o.geometry.type === 'ExtrudeGeometry');
    const roofMesh = paintMeshes.find(o => o.geometry.type === 'BoxGeometry' && Math.abs(o.geometry.parameters.height - 0.1) < 0.01);
    const mirrors = paintMeshes.filter(o => o !== bodyMesh && o !== roofMesh);

    // Mirrors keep a plain paint (wraps are only drawn on the body and roof)
    const mirrorMat = paintMat.clone();
    mirrors.forEach(m => { m.material = mirrorMat; });

    function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

    // ---------- WRAP TEXTURE LAYOUT ----------
    // One 1024 x 1024 picture holds the side view, the top view and a plain-colour area.
    // 1 unit of car = 222.6 pixels everywhere, so patterns are not stretched.
    const TEX = 1024, PXU = TEX / 4.6;
    const SIDE_H = Math.round(PXU);         // side view: 1.0 unit tall (y -0.5 to 0.5)
    const TOP_H = Math.round(2.2 * PXU);    // top view: 2.2 units wide (x -1.1 to 1.1)

    // Give the body and roof their own texture coordinates, by projecting every
    // triangle onto the side, top or plain area depending on which way it faces
    function projectUV(mesh) {
        let geo = mesh.geometry;
        if (geo.index) { geo = geo.toNonIndexed(); mesh.geometry = geo; }
        const p = geo.attributes.position, n = geo.attributes.normal;
        const uv = new Float32Array(p.count * 2);
        const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;
        for (let i = 0; i < p.count; i += 3) {
            const nx = Math.abs(n.getX(i)), ny = n.getY(i), nz = Math.abs(n.getZ(i));
            let kind = 'flat';
            if (nx >= Math.abs(ny) && nx >= nz) kind = 'side';
            else if (ny > 0 && Math.abs(ny) >= nz) kind = 'top';
            for (let k = 0; k < 3; k++) {
                const x = p.getX(i + k) + ox, y = p.getY(i + k) + oy, z = p.getZ(i + k) + oz;
                let u = 0.5 - z / 4.6, v;
                if (kind === 'side' && y <= 0.5) v = (Math.max(-0.5, y) + 0.5) * PXU / TEX;
                else if (kind === 'top') v = (SIDE_H + (Math.max(-1.1, Math.min(1.1, x)) + 1.1) * PXU) / TEX;
                else { v = (SIDE_H + TOP_H + (TEX - SIDE_H - TOP_H) / 2) / TEX; u = 0.5; }
                uv[(i + k) * 2] = Math.max(0, Math.min(1, u));
                uv[(i + k) * 2 + 1] = v;
            }
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (bodyMesh) projectUV(bodyMesh);
    if (roofMesh) projectUV(roofMesh);

    // ---------- DRAWING HELPERS ----------
    function rng(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    function mix(a, b, t) {
        const A = rgb(a), B = rgb(b);
        return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
    }

    // A row of flame tongues pointing backwards from the front (right side of the picture)
    function flameRow(g, xStart, xEnd, baseY, grow, height, color, n) {
        const bw = (xStart - xEnd) / n;
        g.fillStyle = color;
        for (let i = 0; i < n; i++) {
            const x = xStart - i * bw;
            const hgt = height * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + 1)));
            g.beginPath();
            g.moveTo(x, baseY);
            g.quadraticCurveTo(x - bw * 0.15, baseY + grow * hgt * 0.5, x - bw * 1.2, baseY + grow * hgt);
            g.quadraticCurveTo(x - bw * 0.7, baseY + grow * hgt * 0.3, x - bw, baseY);
            g.closePath();
            g.fill();
        }
    }

    // Each wrap draws onto the side view and the top view.
    // g = canvas, w x h = size of the area, view = 'side' or 'top', base = paint colour, acc = wrap colour.
    // In both views the FRONT of the car is on the right of the picture.
    const WRAPS = {
        none: null,

        stripes: (g, w, h, view, base, acc) => {
            g.fillStyle = acc;
            if (view === 'top') {
                g.fillRect(0, h / 2 - 70, w, 60);
                g.fillRect(0, h / 2 + 10, w, 60);
            } else {
                g.fillRect(0, h * 0.42, w, h * 0.12);
                g.fillRect(0, h * 0.6, w, h * 0.04);
            }
        },

        flames: (g, w, h, view, base, acc) => {
            const hot = mix(acc, '#ffeb3b', 0.65);
            const draw = (baseY, grow, hgt) => {
                flameRow(g, w * 0.97, w * 0.3, baseY, grow, hgt, acc, 7);
                flameRow(g, w * 0.95, w * 0.34, baseY, grow, hgt * 0.62, hot, 7);
            };
            if (view === 'top') { draw(0, 1, h * 0.3); draw(h, -1, h * 0.3); }
            else draw(h, -1, h * 0.8);
        },

        checker: (g, w, h, view, base, acc) => {
            const s = 34;
            const rows = view === 'top' ? 4 : 2;
            const y0 = view === 'top' ? h / 2 - rows * s / 2 : h * 0.5;
            g.fillStyle = acc;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c * s < w; c++) if ((r + c) % 2 === 0) g.fillRect(c * s, y0 + r * s, s, s);
            }
        },

        camo: (g, w, h, view, base, acc) => {
            const R = rng(view === 'top' ? 7 : 3);
            const cols = [mix(base, acc, 0.5), acc, mix(acc, '#000000', 0.5)];
            for (let k = 0; k < 110; k++) {
                g.fillStyle = cols[Math.floor(R() * cols.length)];
                g.beginPath();
                g.ellipse(R() * w, R() * h, 30 + R() * 70, 20 + R() * 35, R() * Math.PI, 0, Math.PI * 2);
                g.fill();
            }
        },

        carbon: (g, w, h) => {
            g.fillStyle = '#17181c';
            g.fillRect(0, 0, w, h);
            const s = 8;
            for (let ty = 0; ty * s < h; ty++) {
                for (let tx = 0; tx * s < w; tx++) {
                    g.fillStyle = (tx + ty) % 2 ? '#24262c' : '#101114';
                    g.fillRect(tx * s, ty * s, s - 1, s - 1);
                }
            }
        },

        fade: (g, w, h, view, base, acc) => {
            const grad = g.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, acc);
            grad.addColorStop(0.75, base);
            g.fillStyle = grad;
            g.fillRect(0, 0, w, h);
        },

        geo: (g, w, h, view, base, acc) => {
            const R = rng(view === 'top' ? 11 : 5), s = 70;
            for (let y = 0; y * s < h; y++) {
                for (let x = 0; x * s < w; x++) {
                    [[0, 0, s, 0, 0, s], [s, 0, s, s, 0, s]].forEach(t => {
                        g.fillStyle = mix(base, acc, R() * 0.85);
                        g.beginPath();
                        g.moveTo(x * s + t[0], y * s + t[1]);
                        g.lineTo(x * s + t[2], y * s + t[3]);
                        g.lineTo(x * s + t[4], y * s + t[5]);
                        g.closePath();
                        g.fill();
                    });
                }
            }
        }
    };

    // ---------- THE CHOICES ----------
    const PALETTE = ['#d32f2f', '#e64a19', '#ffb300', '#fdd835', '#7cb342', '#2e7d32', '#00897b', '#00acc1', '#1976d2',
                     '#3949ab', '#7b1fa2', '#d81b60', '#f5f5f5', '#9e9e9e', '#2b2b2e', '#000000', '#5d4037', '#ff80ab'];
    const FINISHES = {
        gloss:    { label: 'Gloss',    m: 0.55, r: 0.28, c: 1, cr: 0.08 },
        matte:    { label: 'Matte',    m: 0.05, r: 0.85, c: 0, cr: 0.5 },
        metallic: { label: 'Metallic', m: 0.95, r: 0.25, c: 1, cr: 0.05 },
        pearl:    { label: 'Pearl',    m: 0.35, r: 0.18, c: 1, cr: 0.02 },
        chrome:   { label: 'Chrome',   m: 1.0,  r: 0.05, c: 0, cr: 0.0 }
    };
    const WRAP_NAMES = { none: 'None', stripes: 'Racing stripes', flames: 'Flames', checker: 'Checkered',
                         camo: 'Camo', carbon: 'Carbon fibre', fade: 'Fade', geo: 'Geometric' };
    const TYRES = {
        standard: { label: 'Standard',     width: 1.0,  rough: 0.9 },
        sport:    { label: 'Sport (wide)', width: 1.3,  rough: 0.55 },
        whitewall: { label: 'Whitewall',   width: 1.0,  rough: 0.9 },
        offroad:  { label: 'Off-road',     width: 1.15, rough: 1.0 }
    };
    const RIM_STYLES = { star5: '5-spoke', star10: '10-spoke', solid: 'Solid' };
    const RIM_COLOURS = ['#b4b8bd', '#1a1a1a', '#d4af37', '#f0f0f0', '#c62828', '#1565c0', '#8d6e63', '#2e7d32'];

    const DEFAULTS = { paint: '#d32f2f', finish: 'gloss', wrap: 'none', wrapColor: '#f5f5f5',
                       tyre: 'standard', rim: 'star5', rimColor: '#b4b8bd' };
    let state = Object.assign({}, DEFAULTS);
    try { Object.assign(state, JSON.parse(localStorage.getItem('vroomCar') || '{}')); } catch (e) { /* ignore */ }
    function save() { try { localStorage.setItem('vroomCar', JSON.stringify(state)); } catch (e) { /* ignore */ } }

    // ---------- APPLY THE PAINT AND WRAP ----------
    let wrapTex = null;

    function buildWrapTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = TEX;
        const g = c.getContext('2d');
        g.fillStyle = state.paint;
        g.fillRect(0, 0, TEX, TEX);
        const fn = WRAPS[state.wrap];
        if (fn) {
            [['side', TEX - SIDE_H, SIDE_H], ['top', TEX - SIDE_H - TOP_H, TOP_H]].forEach(r => {
                g.save();
                g.beginPath();
                g.rect(0, r[1], TEX, r[2]);
                g.clip();
                g.translate(0, r[1]);
                fn(g, TEX, r[2], r[0], state.paint, state.wrapColor);
                g.restore();
            });
        }
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return t;
    }

    function applyPaint() {
        const F = FINISHES[state.finish];
        [paintMat, mirrorMat].forEach(m => {
            m.metalness = F.m; m.roughness = F.r; m.clearcoat = F.c; m.clearcoatRoughness = F.cr;
        });
        if (wrapTex) { wrapTex.dispose(); wrapTex = null; }
        if (state.wrap !== 'none') {
            wrapTex = buildWrapTexture();
            paintMat.map = wrapTex;
            paintMat.color.setRGB(1, 1, 1); // the colour is drawn into the wrap picture
        } else {
            paintMat.map = null;
            paintMat.color.copy(lin(state.paint));
        }
        mirrorMat.color.copy(lin(state.paint));
        paintMat.needsUpdate = true;
        mirrorMat.needsUpdate = true;
    }

    // ---------- APPLY THE WHEELS ----------
    const tyreMat = wheels.length ? wheels[0].material.clone() : null;
    const hubMat = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.3 });
    const spokeMat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: lin('#f2f2f2'), roughness: 0.6, side: THREE.DoubleSide });
    const redMat = new THREE.MeshStandardMaterial({ color: lin('#e53935'), roughness: 0.6, side: THREE.DoubleSide });
    const capMat = new THREE.MeshStandardMaterial({ color: lin('#222222'), metalness: 0.6, roughness: 0.4 });

    function starGeo(points) {
        const shape = new THREE.Shape();
        for (let i = 0; i < points * 2; i++) {
            const a = (i / (points * 2)) * Math.PI * 2;
            const r = i % 2 === 0 ? 0.26 : (points > 6 ? 0.15 : 0.1);
            if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.44, bevelEnabled: false });
        g.translate(0, 0, -0.22);
        g.rotateX(-Math.PI / 2);
        return g;
    }
    const star5 = starGeo(5), star10 = starGeo(10);
    const blockGeo = new THREE.BoxGeometry(0.1, 0.36, 0.12);
    const wallGeo = new THREE.RingGeometry(0.31, 0.41, 40);
    const lineGeo = new THREE.RingGeometry(0.39, 0.42, 40);
    const capGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.44, 16);

    wheels.forEach(w => {
        w.material = tyreMat;
        w.userData.hub = w.children.find(c => c.geometry && c.geometry.type === 'CylinderGeometry');
        const oldStar = w.children.find(c => c.geometry && c.geometry.type === 'ExtrudeGeometry');
        if (oldStar) oldStar.visible = false; // we draw our own spokes
        if (w.userData.hub) w.userData.hub.material = hubMat;
    });

    function applyWheels() {
        if (!tyreMat) return;
        const T = TYRES[state.tyre];
        tyreMat.roughness = T.rough;
        hubMat.color.copy(lin(state.rimColor));
        spokeMat.color.copy(lin(mix(state.rimColor, '#000000', 0.55)));

        wheels.forEach(w => {
            (w.userData.cust || []).forEach(c => w.remove(c));
            const cust = w.userData.cust = [];
            const add = m => { m.castShadow = true; w.add(m); cust.push(m); return m; };

            w.scale.set(1, T.width, 1); // wider tyres

            // Tyre details
            if (state.tyre === 'whitewall' || state.tyre === 'sport') {
                const mat = state.tyre === 'sport' ? redMat : whiteMat;
                const geo = state.tyre === 'sport' ? lineGeo : wallGeo;
                [1, -1].forEach(s => {
                    const ring = add(new THREE.Mesh(geo, mat));
                    ring.position.y = s * 0.203;
                    ring.rotation.x = s * -Math.PI / 2;
                });
            }
            if (state.tyre === 'offroad') {
                for (let k = 0; k < 20; k++) {
                    const a = (k / 20) * Math.PI * 2;
                    const b = add(new THREE.Mesh(blockGeo, tyreMat));
                    b.position.set(Math.cos(a) * 0.46, 0, Math.sin(a) * 0.46);
                    b.rotation.y = -a;
                }
            }

            // Rim
            const hub = w.userData.hub;
            if (hub) hub.scale.set(state.rim === 'solid' ? 1.27 : 1, 1, state.rim === 'solid' ? 1.27 : 1);
            if (state.rim === 'solid') {
                add(new THREE.Mesh(capGeo, capMat));
            } else {
                add(new THREE.Mesh(state.rim === 'star10' ? star10 : star5, spokeMat));
            }
        });
    }

    function applyAll() { applyPaint(); applyWheels(); }
    applyAll();

    // ---------- THE MENU PANEL ----------
    const FONT = '"Segoe UI", Arial, sans-serif';
    function el(tag, css, text) {
        const e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (text) e.textContent = text;
        return e;
    }

    const panel = el('div',
        'position:fixed; top:0; right:0; width:370px; height:100%; box-sizing:border-box; padding:22px 20px;' +
        'background:rgba(10,12,18,0.85); color:#fff; font-family:' + FONT + '; z-index:12; display:none; overflow-y:auto;');
    document.body.appendChild(panel);

    panel.appendChild(el('div', 'font-size:26px; font-weight:bold; letter-spacing:4px; margin-bottom:14px;', 'CUSTOMISE'));
    const tabRow = el('div', 'display:flex; gap:8px; margin-bottom:16px;');
    panel.appendChild(tabRow);
    const body = el('div');
    panel.appendChild(body);
    const footer = el('div', 'margin-top:22px; display:flex; gap:10px;');
    panel.appendChild(footer);

    let tab = 'PAINT';

    function chip(label, active, onClick) {
        const c = el('div',
            'padding:8px 12px; border-radius:6px; cursor:pointer; font-size:14px; user-select:none;' +
            'border:2px solid ' + (active ? '#ff3d3d' : 'rgba(255,255,255,0.35)') + ';' +
            'background:' + (active ? '#ff3d3d' : 'rgba(255,255,255,0.08)') + ';', label);
        c.addEventListener('click', onClick);
        return c;
    }
    function swatch(hex, active, onClick) {
        const s = el('div',
            'width:34px; height:34px; border-radius:50%; cursor:pointer; background:' + hex + ';' +
            'border:3px solid ' + (active ? '#ffffff' : 'rgba(255,255,255,0.25)') + ';' +
            (active ? 'box-shadow:0 0 8px #fff;' : ''));
        s.addEventListener('click', onClick);
        return s;
    }
    function heading(text) { body.appendChild(el('div', 'margin:14px 0 8px; font-size:13px; letter-spacing:2px; opacity:0.7;', text)); }
    function row(items) {
        const r = el('div', 'display:flex; flex-wrap:wrap; gap:8px;');
        items.forEach(i => r.appendChild(i));
        body.appendChild(r);
    }
    function change(key, value) { state[key] = value; applyAll(); save(); render(); }

    function render() {
        tabRow.innerHTML = '';
        ['PAINT', 'WRAP', 'WHEELS'].forEach(t => tabRow.appendChild(chip(t, t === tab, () => { tab = t; render(); })));
        body.innerHTML = '';

        if (tab === 'PAINT') {
            heading('COLOUR');
            row(PALETTE.map(c => swatch(c, state.paint === c, () => change('paint', c))));
            const picker = el('input', 'margin-top:10px; width:100%; height:36px; border:none; background:none; cursor:pointer;');
            picker.type = 'color';
            picker.value = state.paint;
            picker.addEventListener('input', () => { state.paint = picker.value; applyAll(); save(); });
            body.appendChild(picker);
            heading('FINISH');
            row(Object.keys(FINISHES).map(k => chip(FINISHES[k].label, state.finish === k, () => change('finish', k))));
        }

        if (tab === 'WRAP') {
            heading('PATTERN');
            row(Object.keys(WRAP_NAMES).map(k => chip(WRAP_NAMES[k], state.wrap === k, () => change('wrap', k))));
            heading('WRAP COLOUR');
            row(PALETTE.map(c => swatch(c, state.wrapColor === c, () => change('wrapColor', c))));
            body.appendChild(el('div', 'margin-top:12px; font-size:12px; opacity:0.6;',
                'The wrap is drawn on top of your paint colour. Carbon fibre ignores the colours.'));
        }

        if (tab === 'WHEELS') {
            heading('TYRES');
            row(Object.keys(TYRES).map(k => chip(TYRES[k].label, state.tyre === k, () => change('tyre', k))));
            heading('RIM STYLE');
            row(Object.keys(RIM_STYLES).map(k => chip(RIM_STYLES[k], state.rim === k, () => change('rim', k))));
            heading('RIM COLOUR');
            row(RIM_COLOURS.map(c => swatch(c, state.rimColor === c, () => change('rimColor', c))));
        }
    }

    footer.appendChild(chip('RESET', false, () => { state = Object.assign({}, DEFAULTS); applyAll(); save(); render(); }));
    const doneBtn = chip('DONE', true, closePanel);
    doneBtn.style.flex = '1';
    doneBtn.style.textAlign = 'center';
    footer.appendChild(doneBtn);

    // ---------- THE MENU BUTTON ----------
    let open = false;
    function openPanel() {
        open = true;
        const menu = document.getElementById('menu');
        if (menu) menu.classList.add('hide'); // hide the main menu so you can see the car clearly
        panel.style.display = 'block';
        render();
    }
    function closePanel() {
        open = false;
        panel.style.display = 'none';
        const menu = document.getElementById('menu');
        if (menu && typeof gameState !== 'undefined' && gameState === 'menu') menu.classList.remove('hide');
        save();
    }

    const btn = el('button', null, 'Customize');
    btn.id = 'customBtn';
    btn.addEventListener('click', openPanel);
    const after = document.getElementById('playBtn') || document.getElementById('creditsBtn');
    const content = document.querySelector('.menu-content');
    if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
    else if (content) content.appendChild(btn);

    // If the game starts (Enter key) while the panel is open, close it
    (function watch() {
        requestAnimationFrame(watch);
        if (open && typeof gameState !== 'undefined' && gameState !== 'menu') {
            open = false;
            panel.style.display = 'none';
            save();
        }
    })();

})();