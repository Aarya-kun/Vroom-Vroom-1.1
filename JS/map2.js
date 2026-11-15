// extras.js - load AFTER map.js (see index.html).
// Adds: street lamps, AI traffic, minimap, and a checkpoint race with a timer (press T).
(function () {

    const M = window.MAP;
    if (!M) { console.error('extras.js: map.js must load before it.'); return; }

    // ---------- HELPERS ----------
    function segDist(px, pz, a, b) {
        const vx = b.x - a.x, vz = b.z - a.z;
        const l2 = vx * vx + vz * vz;
        let t = l2 ? ((px - a.x) * vx + (pz - a.z) * vz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
    }

    // Add extra points so corners and curves are smooth
    function resample(pts, step) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const L = Math.hypot(b.x - a.x, b.z - a.z);
            const n = Math.max(1, Math.round(L / step));
            for (let k = 1; k <= n; k++) {
                out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
            }
        }
        return out;
    }

    // ======================================================
    // 1. STREET LAMPS
    // ======================================================
    function nearOtherRoad(x, z, self) {
        for (const r of M.roads) {
            if (r === self) continue;
            for (let i = 0; i < r.pts.length - 1; i++) {
                if (segDist(x, z, r.pts[i], r.pts[i + 1]) < r.width / 2 + 1.5) return true;
            }
        }
        return false;
    }

    function lampsAlong(road, spacing, filter) {
        const spots = [];
        [1, -1].forEach(side => {
            const p = M.offsetPts(road.pts, side * (road.width / 2 + 2));
            let acc = 0, next = spacing / 2;
            for (let i = 0; i < p.length - 1; i++) {
                const a = p[i], b = p[i + 1];
                const L = Math.hypot(b.x - a.x, b.z - a.z);
                while (next < acc + L) {
                    const t = (next - acc) / L;
                    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
                    if ((!filter || filter(x, z)) && !nearOtherRoad(x, z, road)) spots.push({ x: x, z: z });
                    next += spacing;
                }
                acc += L;
            }
        });
        return spots;
    }

    (function buildLamps() {
        const C = M.CITY;
        let spots = [];

        M.roads.forEach(road => {
            if (road.style === 'highway') {
                spots = spots.concat(lampsAlong(road, 70));
            } else if (road.style === 'road') {
                // main road: skip the city, where the corner lamps below take over
                spots = spots.concat(lampsAlong(road, 45, (x, z) => !(z < C.z1 + 12 && z > C.z0 - 12)));
            }
        });

        // City: a lamp on every corner of every intersection
        const xs = [-240, -160, -80, 0, 80, 160, 240];
        const zs = [-480, -400, -320, -240, -160];
        xs.forEach(x => zs.forEach(z => {
            [[-9, -9], [9, -9], [-9, 9], [9, 9]].forEach(o => spots.push({ x: x + o[0], z: z + o[1] }));
        }));

        const poles = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.15, 0.2, 8, 6),
            new THREE.MeshLambertMaterial({ color: 0x555a60 }),
            spots.length
        );
        const heads = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.7, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
            spots.length
        );
        const o = new THREE.Object3D();
        spots.forEach((s, i) => {
            const gy = M.terrainHeight(s.x, s.z); // lamps stand on the hills too
            o.position.set(s.x, 4 + gy, s.z);
            o.updateMatrix();
            poles.setMatrixAt(i, o.matrix);
            o.position.set(s.x, 8.2 + gy, s.z);
        })
        poles.frustumCulled = false;
        heads.frustumCulled = false;
        scene.add(poles);
        scene.add(heads);
    })();

    // ======================================================
    // 2. AI TRAFFIC (right-hand traffic, drives in lanes)
    // ======================================================
    const AXIS = new CANNON.Vec3(0, 1, 0);
    const bodyGeo = new THREE.BoxGeometry(2, 0.7, 4.2);
    const cabGeo = new THREE.BoxGeometry(1.7, 0.6, 2);
    const underGeo = new THREE.BoxGeometry(1.9, 0.4, 3.8);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fc5e8 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const colors = [0xd32f2f, 0x1976d2, 0xfbc02d, 0xffffff, 0x388e3c, 0x7b1fa2, 0xff6f00, 0x455a64];
    const colorMats = colors.map(c => new THREE.MeshLambertMaterial({ color: c }));

    function makeTrafficMesh() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, colorMats[Math.floor(Math.random() * colorMats.length)]);
        body.position.y = 0.1;
        g.add(body);
        const cab = new THREE.Mesh(cabGeo, glassMat);
        cab.position.set(0, 0.7, 0.2);
        g.add(cab);
        const under = new THREE.Mesh(underGeo, darkMat);
        under.position.y = -0.25;
        g.add(under);
        return g;
    }

    function makeRoute(pts, off, reverse) {
        let p = reverse ? pts.slice().reverse() : pts.slice();
        p = M.offsetPts(resample(p, 12), off); // + offset = right-hand lane
        const cum = [0];
        for (let i = 1; i < p.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
        }
        return { p: p, cum: cum, total: cum[cum.length - 1] };
    }

    // Rounds the corners of a closed loop (the last point must equal the first)
    function roundCorners(pts, radius) {
        const p = pts.slice(0, -1), n = p.length, out = [];
        for (let i = 0; i < n; i++) {
            const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
            const abx = a.x - b.x, abz = a.z - b.z, cbx = c.x - b.x, cbz = c.z - b.z;
            const la = Math.hypot(abx, abz), lc = Math.hypot(cbx, cbz);
            const t = Math.min(radius, la / 2, lc / 2);
            const s = { x: b.x + abx / la * t, z: b.z + abz / la * t };
            const e = { x: b.x + cbx / lc * t, z: b.z + cbz / lc * t };
            for (let k = 0; k <= 24; k++) {
                const u = k / 24, w = 1 - u;
                out.push({ x: w * w * s.x + 2 * w * u * b.x + u * u * e.x, z: w * w * s.z + 2 * w * u * b.z + u * u * e.z });
            }
        }
        out.push({ x: out[0].x, z: out[0].z });
        return out;
    }

    function posOn(route, s) {
        s = ((s % route.total) + route.total) % route.total;
        const cum = route.cum;
        let lo = 0, hi = cum.length - 2;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (cum[mid] <= s) lo = mid; else hi = mid - 1;
        }
        const a = route.p[lo], b = route.p[lo + 1];
        const L = (cum[lo + 1] - cum[lo]) || 1;
        const t = (s - cum[lo]) / L;
        return {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            dx: (b.x - a.x) / L,
            dz: (b.z - a.z) / L
        };
    }

    const cars = [];

    function addTraffic(route, count, speed) {
        for (let k = 0; k < count; k++) {
            const mesh = makeTrafficMesh();
            scene.add(mesh);
            const body = new CANNON.Body({
                mass: 0,
                shape: new CANNON.Box(new CANNON.Vec3(1, 0.75, 2.1))
            });
            body.type = CANNON.Body.KINEMATIC;
            world.addBody(body);
            cars.push({ route: route, s: (k / count) * route.total, speed: speed, mesh: mesh, body: body });
        }
    }

    const ring = M.roads[0];  // roads are stored in the order map.js created them
    const ew = M.roads[1];

    addTraffic(makeRoute(ring.pts, ring.width / 4, false), 8, 30);
    addTraffic(makeRoute(ring.pts, ring.width / 4, true), 8, 30);
    addTraffic(makeRoute(ew.pts, ew.width / 4, false), 4, 30);
    addTraffic(makeRoute(ew.pts, ew.width / 4, true), 4, 30);

    const loopOuter = [{ x: -240, z: -480 }, { x: 240, z: -480 }, { x: 240, z: -160 }, { x: -240, z: -160 }, { x: -240, z: -480 }];
    const loopInner = [{ x: -80, z: -400 }, { x: 80, z: -400 }, { x: 80, z: -240 }, { x: -80, z: -240 }, { x: -80, z: -400 }];
    addTraffic(makeRoute(roundCorners(loopOuter, 14), 3.5, false), 6, 14);
    addTraffic(makeRoute(roundCorners(loopInner, 14), 3.5, false), 3, 10);

    // Move the traffic after every physics step (so it freezes when the game is paused)
    world.addEventListener('postStep', function () {
        const dt = 1 / 60;
        for (const c of cars) {
            c.s += c.speed * dt;
            const q = posOn(c.route, c.s);
            const yaw = Math.atan2(-q.dx, -q.dz);
            const gy = M.terrainHeight(q.x, q.z);
            // tilt the car up or down to match the slope in front of it
            const pitch = Math.atan2(M.terrainHeight(q.x + q.dx * 2, q.z + q.dz * 2) - M.terrainHeight(q.x - q.dx * 2, q.z - q.dz * 2), 4);
            c.mesh.position.set(q.x, 0.85 + gy, q.z);
            c.mesh.rotation.order = 'YXZ';
            c.mesh.rotation.set(pitch, yaw, 0);
            c.body.position.set(q.x, 0.85 + gy, q.z);
        }
    });

    // ======================================================
    // 3. RACE WITH CHECKPOINTS (press T to start)
    // ======================================================
    const cps = [
        { x: 0, z: -300 },                                           // city centre
        { x: Math.cos(-Math.PI / 3) * M.RING_R, z: Math.sin(-Math.PI / 3) * M.RING_R }, // ring north-east
        { x: M.ringEnd.x, z: M.ringEnd.z },                          // start of the mountain road
        M.pass[24],                                                  // middle of the mountain road
        { x: 250, z: 250 },                                          // highway junction
        { x: -300, z: 250 },                                         // highway west
        { x: -M.RING_R, z: 0 },                                      // ring west
        { x: Math.cos(-2 * Math.PI / 3) * M.RING_R, z: Math.sin(-2 * Math.PI / 3) * M.RING_R }, // ring north-west
        { x: 0, z: -120 }                                            // finish: city entrance
    ];

    const race = { active: false, index: 0, time: 0, msg: '', msgUntil: 0 };

    function loadBest() {
        try { return parseFloat(localStorage.getItem('vroomBest')) || 0; } catch (e) { return 0; }
    }
    function saveBest(t) {
        try { localStorage.setItem('vroomBest', String(t)); } catch (e) { /* ignore */ }
    }
    function fmt(t) {
        const m = Math.floor(t / 60), s = t - m * 60;
        return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
    }

    // Beam + ground disc that mark the next checkpoint (ignores fog so you can see it from far away)
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(9, 9, 60, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    const disc = new THREE.Mesh(
        new THREE.CircleGeometry(9, 32),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    disc.rotation.x = -Math.PI / 2;
    beam.visible = false;
    disc.visible = false;
    scene.add(beam);
    scene.add(disc);

    function moveBeam() {
        const c = cps[race.index];
        const isFinish = race.index === cps.length - 1;
        const col = isFinish ? 0xffd600 : 0x00e5ff;
        beam.material.color.setHex(col);
        disc.material.color.setHex(col);
        const gy = M.terrainHeight(c.x, c.z);
        beam.position.set(c.x, 30 + gy, c.z);
        disc.position.set(c.x, 0.12 + gy, c.z);
    }

    function startRace() {
        race.active = true;
        race.index = 0;
        race.time = 0;
        race.msg = '';
        beam.visible = true;
        disc.visible = true;
        moveBeam();
    }

    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyT' && gameState === 'playing') startRace();
    });

    const hud = document.createElement('div');
    hud.style.cssText =
        'position:fixed; top:16px; left:50%; transform:translateX(-50%);' +
        'padding:8px 22px; background:rgba(0,0,0,0.6); color:white;' +
        'font:bold 22px sans-serif; border-radius:10px; z-index:5;' +
        'text-align:center; display:none;';
    document.body.appendChild(hud);

    // ======================================================
    // 4. MINIMAP
    // ======================================================
    const MM = 200;
    const SC = (MM / 2 - 6) / 950;
    const mx = x => MM / 2 + x * SC;
    const my = z => MM / 2 + z * SC;

    const mm = document.createElement('canvas');
    mm.width = MM;
    mm.height = MM;
    mm.style.cssText =
        'position:fixed; left:20px; bottom:20px; width:200px; height:200px;' +
        'border-radius:50%; border:3px solid rgba(255,255,255,0.85);' +
        'box-shadow:0 0 12px rgba(0,0,0,0.6); z-index:5; display:none; background:#1f5a24;';
    document.body.appendChild(mm);
    const ctx = mm.getContext('2d');

    // Draw everything that never moves once, into a hidden canvas
    const base = document.createElement('canvas');
    base.width = MM;
    base.height = MM;
    (function drawBase() {
        const g = base.getContext('2d');
        g.fillStyle = '#2e7d32';
        g.fillRect(0, 0, MM, MM);

        g.fillStyle = '#6d7b8d';                       // mountains
        M.mountains.forEach(m => {
            g.beginPath();
            g.arc(mx(m.x), my(m.z), Math.max(2, m.r * SC), 0, Math.PI * 2);
            g.fill();
        });

        g.fillStyle = '#2d7bb6';                       // lake
        g.beginPath();
        g.arc(mx(M.LAKE.x), my(M.LAKE.z), M.LAKE.r * SC, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = '#8a8d93';                       // city
        const C = M.CITY;
        g.fillRect(mx(C.x0), my(C.z0), (C.x1 - C.x0) * SC, (C.z1 - C.z0) * SC);

        g.lineJoin = 'round';                          // roads
        M.roads.forEach(r => {
            g.strokeStyle = r.style === 'highway' ? '#ffd54f' : '#d9d9d9';
            g.lineWidth = Math.max(1, r.width * SC * (r.style === 'highway' ? 1.4 : 1.1));
            g.beginPath();
            r.pts.forEach((p, i) => { if (i) g.lineTo(mx(p.x), my(p.z)); else g.moveTo(mx(p.x), my(p.z)); });
            g.stroke();
        });

        g.fillStyle = 'rgba(0,229,255,0.9)';           // checkpoint dots
        cps.forEach(c => {
            g.beginPath();
            g.arc(mx(c.x), my(c.z), 2, 0, Math.PI * 2);
            g.fill();
        });
    })();

    const fwdVec = new CANNON.Vec3();

    function drawMinimap(now) {
        ctx.drawImage(base, 0, 0);

        if (race.active) {                             // pulsing marker on the next checkpoint
            const c = cps[race.index];
            const pulse = 4 + Math.sin(now / 150) * 1.5;
            ctx.fillStyle = race.index === cps.length - 1 ? '#ffd600' : '#00e5ff';
            ctx.beginPath();
            ctx.arc(mx(c.x), my(c.z), pulse, 0, Math.PI * 2);
            ctx.fill();
        }

        carBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1), fwdVec);
        const heading = Math.atan2(fwdVec.x, -fwdVec.z);
        ctx.save();
        ctx.translate(mx(carBody.position.x), my(carBody.position.z));
        ctx.rotate(heading);
        ctx.fillStyle = '#ff3d3d';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // ======================================================
    // MAIN LOOP FOR HUD, TIMER AND CHECKPOINTS
    // ======================================================
    let last = performance.now();

    function loop(now) {
        requestAnimationFrame(loop);
        now = now || performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const inGame = gameState !== 'menu';
        hud.style.display = inGame ? 'block' : 'none';
        mm.style.display = inGame ? 'block' : 'none';
        if (!inGame) return;

        // The timer only runs while you are actually playing (not paused, not in the menu)
        if (race.active && gameState === 'playing') {
            race.time += dt;
            const c = cps[race.index];
            if (Math.hypot(carBody.position.x - c.x, carBody.position.z - c.z) < 15) {
                race.index++;
                if (race.index >= cps.length) {
                    race.active = false;
                    beam.visible = false;
                    disc.visible = false;
                    const best = loadBest();
                    const isBest = !best || race.time < best;
                    if (isBest) saveBest(race.time);
                    race.msg = 'FINISHED! ' + fmt(race.time) + (isBest ? '  NEW BEST!' : '  (best ' + fmt(best) + ')');
                    race.msgUntil = now + 6000;
                } else {
                    moveBeam();
                }
            }
        }

        const best = loadBest();
        if (race.active) {
            hud.textContent = 'CP ' + (race.index + 1) + '/' + cps.length + '   ' + fmt(race.time) + (best ? '   Best ' + fmt(best) : '');
        } else if (race.msg && now < race.msgUntil) {
            hud.textContent = race.msg;
        } else {
            hud.textContent = 'Press T to start a race' + (best ? '   Best ' + fmt(best) : '');
        }

        drawMinimap(now);
    }
    requestAnimationFrame(loop);

})();