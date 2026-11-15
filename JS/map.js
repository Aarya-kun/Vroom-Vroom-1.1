// map.js - load this AFTER script.js (see index.html).
// Adds: highway ring, E-W highway, main road, winding mountain road, a city with
// streets and buildings, mountains, a lake, boundary walls, and keeps your trees
// off the roads and out of the city.
(function () {

    // ---------- SETTINGS (change these to reshape the map) ----------
    const CITY = { x0: -240, x1: 240, z0: -480, z1: -160 }; // city rectangle
    const RING_R = 700;                                     // highway ring radius
    const WALL_R = 860;                                     // invisible edge of the map
    const LAKE = { x: -380, z: 380, r: 90 };                // lake (driving in = die)

    // Gentle hills that the roads climb over. They sit on straight parts of roads, far from junctions.
    // x, z = centre, h = height, s = width
    const ringAt = deg => ({ x: Math.cos(deg * Math.PI / 180) * RING_R, z: Math.sin(deg * Math.PI / 180) * RING_R });
    const BUMPS = [
        { x: 0, z: 450, h: 6, s: 40 },                                   // main road, south
        { x: 0, z: -590, h: 5, s: 40 },                                  // main road, north of the city
        { x: -380, z: 250, h: 7, s: 42 },                                // east-west highway, west
        { x: 360, z: 250, h: 6, s: 42 },                                 // east-west highway, east
        { x: ringAt(40).x, z: ringAt(40).z, h: 6, s: 40 },               // ring road
        { x: ringAt(-150).x, z: ringAt(-150).z, h: 7, s: 40 },           // ring road
        { x: ringAt(135).x, z: ringAt(135).z, h: 5, s: 40 },             // ring road
        { x: 454, z: 5, h: 6, s: 36 }                                    // middle of the mountain road
    ];
    function bumpAt(x, z) {
        let h = 0;
        for (const b of BUMPS) {
            const dx = x - b.x, dz = z - b.z;
            h += b.h * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
        }
        return h;
    }

    // Height grid shared by the terrain mesh, the roads and the car (one cell = 10 units)
    const HILL = { size: 1900, cell: 10, amp: 8 };
    const HN = Math.round(HILL.size / HILL.cell);
    const HW = HN + 1;
    const hillHalf = HILL.size / 2;
    const hillGrid = new Float32Array(HW * HW);
    const bumpGrid = new Float32Array(HW * HW);
    for (let j = 0; j < HW; j++) {
        for (let i = 0; i < HW; i++) {
            bumpGrid[j * HW + i] = bumpAt(-hillHalf + i * HILL.cell, -hillHalf + j * HILL.cell);
        }
    }
    function sampleGrid(grid, x, z) {
        const fx = (x + hillHalf) / HILL.cell, fz = (z + hillHalf) / HILL.cell;
        if (fx < 0 || fz < 0 || fx >= HN || fz >= HN) return 0;
        const i = Math.floor(fx), j = Math.floor(fz);
        const u = fx - i, v = fz - j;
        const h00 = grid[j * HW + i], h10 = grid[j * HW + i + 1];
        const h01 = grid[(j + 1) * HW + i], h11 = grid[(j + 1) * HW + i + 1];
        return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
    }
    // How high the road surface sits above flat ground at (x, z)
    function roadLift(x, z) { return sampleGrid(bumpGrid, x, z); }

    const roadSegs = [];      // used to keep trees off roads
    const roadList = [];      // every road (shared with extras.js)
    const mountainSpots = []; // used to keep trees off mountains
    const dashes = [];        // lane-marking dashes (drawn as one instanced mesh)

    // ---------- HELPERS ----------
    function flatMat(color, offset) {
        return new THREE.MeshLambertMaterial({
            color: color,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -offset,
            polygonOffsetUnits: -offset
        });
    }

    function dirAt(pts, i) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        return { dx: dx / len, dz: dz / len };
    }

    // Shift a polyline sideways (used for lane lines)
    function offsetPts(pts, off) {
        return pts.map((p, i) => {
            const d = dirAt(pts, i);
            return { x: p.x - d.dz * off, z: p.z + d.dx * off };
        });
    }

    // Flat strip following a polyline
    function ribbon(pts, width, y, material) {
        const pos = [], idx = [];
        for (let i = 0; i < pts.length; i++) {
            const d = dirAt(pts, i);
            const nx = -d.dz, nz = d.dx, hw = width / 2;
            const lx = pts[i].x + nx * hw, lz = pts[i].z + nz * hw;
            const rx = pts[i].x - nx * hw, rz = pts[i].z - nz * hw;
            pos.push(lx, y + roadLift(lx, lz), lz);
            pos.push(rx, y + roadLift(rx, rz), rz);
            if (i > 0) {
                const k = (i - 1) * 2;
                idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, material);
    }

    function solidLine(pts, off, color) {
        scene.add(ribbon(offsetPts(pts, off), 0.35, 0.08, flatMat(color, 4)));
    }

    function dashedLine(pts, off) {
        const p = offsetPts(pts, off);
        const dashLen = 3.5, gap = 8.5, period = dashLen + gap;
        let acc = 0, next = dashLen / 2;
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i], b = p[i + 1];
            const L = Math.hypot(b.x - a.x, b.z - a.z);
            if (!L) continue;
            const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
            const ang = Math.atan2(dx, dz);
            while (next < acc + L) {
                const t = next - acc;
                dashes.push({ x: a.x + dx * t, z: a.z + dz * t, ang: ang });
                next += period;
            }
            acc += L;
        }
    }

    function buildDashes() {
        const m = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.4, 0.02, 3.5),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
            }),
            dashes.length
        );
        const o = new THREE.Object3D();
        o.rotation.order = 'YXZ';
        dashes.forEach((d, i) => {
            const dx = Math.sin(d.ang), dz = Math.cos(d.ang);
            const pitch = Math.atan2(roadLift(d.x + dx * 1.75, d.z + dz * 1.75) - roadLift(d.x - dx * 1.75, d.z - dz * 1.75), 3.5);
            o.position.set(d.x, 0.08 + roadLift(d.x, d.z), d.z);
            o.rotation.set(-pitch, d.ang, 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.frustumCulled = false; // instances are spread across the whole map
        scene.add(m);
    }

    // Adds points so no piece of road is longer than maxLen (so it can bend over hills)
    function subdivide(pts, maxLen) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxLen));
            for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
        }
        return out;
    }

    // style: 'highway' | 'road' | 'street'
    function addRoad(pts, width, color, style, keepTreesOff) {
        pts = subdivide(pts, 10);
        scene.add(ribbon(pts, width, 0.05, flatMat(color, 2)));
        if (keepTreesOff !== false) {
            for (let i = 0; i < pts.length - 1; i++) {
                roadSegs.push({ a: pts[i], b: pts[i + 1], hw: width / 2 });
            }
        }
        roadList.push({ pts: pts, width: width, style: style });
        const yellow = 0xf2c200, white = 0xffffff;
        if (style === 'highway') {
            solidLine(pts, 0.35, yellow);
            solidLine(pts, -0.35, yellow);
            solidLine(pts, width / 2 - 0.8, white);
            solidLine(pts, -(width / 2 - 0.8), white);
            dashedLine(pts, width / 4);
            dashedLine(pts, -width / 4);
        } else if (style === 'road') {
            solidLine(pts, 0, yellow);
            solidLine(pts, width / 2 - 0.8, white);
            solidLine(pts, -(width / 2 - 0.8), white);
        } else {
            dashedLine(pts, 0);
        }
    }

    function curvy(x0, z0, x1, z1, amp, waves, n) {
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
        const nx = -dz / L, nz = dx / L;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const w = Math.sin(t * Math.PI * waves) * amp * Math.sin(t * Math.PI);
            pts.push({ x: x0 + dx * t + nx * w, z: z0 + dz * t + nz * w });
        }
        return { pts: pts, nx: nx, nz: nz, dx: dx, dz: dz };
    }

    function segDist(px, pz, a, b) {
        const vx = b.x - a.x, vz = b.z - a.z;
        const l2 = vx * vx + vz * vz;
        let t = l2 ? ((px - a.x) * vx + (pz - a.z) * vz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const ex = px - (a.x + vx * t), ez = pz - (a.z + vz * t);
        return Math.sqrt(ex * ex + ez * ez);
    }

    // ---------- ROADS ----------
    // Highway ring
    const ring = [];
    for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        ring.push({ x: Math.cos(a) * RING_R, z: Math.sin(a) * RING_R });
    }
    addRoad(ring, 20, 0x2b2b2e, 'highway');

    // East-west highway across the map
    const ewX = Math.sqrt(RING_R * RING_R - 250 * 250);
    addRoad([{ x: -ewX, z: 250 }, { x: ewX, z: 250 }], 20, 0x2b2b2e, 'highway');

    // Main road: north-south through the whole map, past your spawn point and through the city
    addRoad([{ x: 0, z: RING_R }, { x: 0, z: -RING_R }], 14, 0x38383c, 'road');

    // Winding country road through the mountains (east side)
    const ringEnd = { x: Math.cos(-0.35) * RING_R, z: Math.sin(-0.35) * RING_R };
    const pass = curvy(250, 250, ringEnd.x, ringEnd.z, 40, 4, 48);
    addRoad(pass.pts, 10, 0x454545, 'street');

    // City streets
    const streetZ = [-480, -400, -320, -240, -160];
    const streetX = [-240, -160, -80, 80, 160, 240]; // x = 0 is the main road
    streetZ.forEach(z => addRoad([{ x: CITY.x0, z: z }, { x: CITY.x1, z: z }], 14, 0x333336, 'street'));
    streetX.forEach(x => addRoad([{ x: x, z: CITY.z0 }, { x: x, z: CITY.z1 }], 14, 0x333336, 'street'));

    buildDashes();

    // ---------- CITY BUILDINGS ----------
    function makeWindowTexture() {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const g = c.getContext('2d');
        g.fillStyle = '#c9ccd1';
        g.fillRect(0, 0, 32, 32);
        g.fillStyle = '#35506b';
        g.fillRect(4, 6, 10, 18);
        g.fillRect(18, 6, 10, 18);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    const winTex = makeWindowTexture();
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x666a70 });
    const wallColors = [0xffffff, 0xe8d9c0, 0xd0d8e0, 0xc0b0a0, 0xb8c4d0];

    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 4; j++) {
            const cx = -200 + 80 * i;
            const cz = -440 + 80 * j;

            if (i === 2 && j === 1) { // a park instead of buildings
                const park = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), flatMat(0x3f9b3f, 2));
                park.rotation.x = -Math.PI / 2;
                park.position.set(cx, 0.06, cz);
                scene.add(park);
                continue;
            }

            [-1, 1].forEach(sx => {
                [-1, 1].forEach(sz => {
                    if (Math.random() < 0.08) return; // a few empty lots
                    const bx = cx + sx * 16, bz = cz + sz * 16;
                    const size = 22 + Math.random() * 4;
                    const distC = Math.hypot(bx, bz + 320);
                    const h = 14 + Math.random() * 26 + Math.max(0, 1 - distC / 260) * 70;

                    const tex = winTex.clone();
                    tex.needsUpdate = true;
                    tex.repeat.set(Math.max(1, Math.round(size / 6)), Math.max(1, Math.round(h / 6)));
                    const side = new THREE.MeshLambertMaterial({
                        map: tex,
                        color: wallColors[Math.floor(Math.random() * wallColors.length)]
                    });

                    const b = new THREE.Mesh(
                        new THREE.BoxGeometry(size, h, size),
                        [side, side, roofMat, roofMat, side, side]
                    );
                    b.position.set(bx, h / 2, bz);
                    scene.add(b);

                    const bodyB = new CANNON.Body({
                        mass: 0,
                        shape: new CANNON.Box(new CANNON.Vec3(size / 2, h / 2, size / 2)),
                        position: new CANNON.Vec3(bx, h / 2, bz)
                    });
                    world.addBody(bodyB);
                });
            });
        }
    }

    // ---------- MOUNTAINS ----------
    const rockMats = [0x6d7b8d, 0x5f6f7a, 0x7a8590].map(c =>
        new THREE.MeshPhongMaterial({ color: c, flatShading: true, shininess: 4, fog: false }));
    const snowMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 4, fog: false });

    // A mountain may only be placed where it does not touch a road, the city or the lake
    function clearOfRoads(x, z, r) {
        for (const s of roadSegs) {
            if (segDist(x, z, s.a, s.b) < r + s.hw + 10) return false;
        }
        if (x > CITY.x0 - r - 20 && x < CITY.x1 + r + 20 && z > CITY.z0 - r - 20 && z < CITY.z1 + r + 20) return false;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + r + 20) return false;
        return true;
    }

    function tryMountain(x, z, r, h, solid) {
        if (!clearOfRoads(x, z, r)) return false;
        addMountain(x, z, r, h, solid);
        return true;
    }

    function addMountain(x, z, r, h, solid) {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(r, h, 7),
            rockMats[Math.floor(Math.random() * rockMats.length)]
        );
        cone.position.set(x, h / 2, z);
        cone.rotation.y = Math.random() * Math.PI;
        scene.add(cone);

        if (h > 150) { // snow cap on the tall ones
            const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.31, h * 0.3, 7), snowMat);
            cap.position.set(x, h * 0.85, z);
            cap.rotation.y = cone.rotation.y;
            scene.add(cap);
        }

        if (solid) {
            const hb = new CANNON.Body({
                mass: 0,
                shape: new CANNON.Box(new CANNON.Vec3(r * 0.65, 40, r * 0.65)),
                position: new CANNON.Vec3(x, 40, z)
            });
            world.addBody(hb);
        }
        mountainSpots.push({ x: x, z: z, r: r });
    }

    // Mountains beside the winding road (solid, so you can't drive through them)
    for (let k = 0; k < 8; k++) {
        const t = (k + 0.5) / 8;
        const side = k % 2 ? 1 : -1;
        const r = 55 + Math.random() * 25, h = 90 + Math.random() * 70;
        for (const extra of [0, 30, 60]) { // if it touches a road, push it further away
            const off = 170 + extra;
            if (tryMountain(250 + pass.dx * t + pass.nx * side * off, 250 + pass.dz * t + pass.nz * side * off, r, h, true)) break;
        }
    }

    // Big mountain range around the edge of the map
    for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
        const R = 950 + Math.random() * 60;
        tryMountain(Math.cos(a) * R, Math.sin(a) * R,
            100 + Math.random() * 70, 160 + Math.random() * 200, false);
    }

    // ---------- INVISIBLE WALLS AT THE MAP EDGE ----------
    const WALLS = 56;
    for (let i = 0; i < WALLS; i++) {
        const a = (i / WALLS) * Math.PI * 2;
        const w = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(Math.PI * WALL_R / WALLS + 4, 30, 6))
        });
        w.position.set(Math.cos(a) * WALL_R, 30, Math.sin(a) * WALL_R);
        w.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a - Math.PI / 2);
        world.addBody(w);
    }

    // ---------- LAKE ----------
    const sand = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 12, 48), flatMat(0xd8c690, 2));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(LAKE.x, 0.03, LAKE.z);
    scene.add(sand);

    const waterMat = flatMat(0x2d7bb6, 3);
    waterMat.transparent = true;
    waterMat.opacity = 0.9;
    const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 48), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, 0.06, LAKE.z);
    scene.add(water);

    // Driving into the lake resets you (uses your die() function)
    (function watchLake() {
        requestAnimationFrame(watchLake);
        if (typeof gameState !== 'undefined' && gameState === 'playing' &&
            Math.hypot(carBody.position.x - LAKE.x, carBody.position.z - LAKE.z) < LAKE.r - 2) {
            die();
        }
    })();

    // ---------- ROLLING HILLS ----------
    // Hills are flattened near roads, the city, the lake and the mountains.
    function smooth(a, b, x) {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    }

    function rawHill(x, z) {
        const n = Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 + 0.4)
                + Math.sin((x + z) * 0.006) * 0.8
                + Math.sin(x * 0.027) * Math.sin(z * 0.023) * 0.4;
        return Math.max(0, n + 0.3);
    }

    // Sort the road pieces into 100 x 100 unit boxes, so each point only checks the roads near it
    const BUCKET = 100, BN = Math.ceil(HILL.size / BUCKET) + 1;
    const buckets = [];
    for (let k = 0; k < BN * BN; k++) buckets.push([]);
    roadSegs.forEach(s => {
        const minx = Math.min(s.a.x, s.b.x) - s.hw - 50, maxx = Math.max(s.a.x, s.b.x) + s.hw + 50;
        const minz = Math.min(s.a.z, s.b.z) - s.hw - 50, maxz = Math.max(s.a.z, s.b.z) + s.hw + 50;
        const bx0 = Math.max(0, Math.floor((minx + hillHalf) / BUCKET)), bx1 = Math.min(BN - 1, Math.floor((maxx + hillHalf) / BUCKET));
        const bz0 = Math.max(0, Math.floor((minz + hillHalf) / BUCKET)), bz1 = Math.min(BN - 1, Math.floor((maxz + hillHalf) / BUCKET));
        for (let bx = bx0; bx <= bx1; bx++) {
            for (let bz = bz0; bz <= bz1; bz++) buckets[bx * BN + bz].push(s);
        }
    });

    function flatMask(x, z) {
        let m = 1;
        let d = Infinity;
        const bx = Math.floor((x + hillHalf) / BUCKET), bz = Math.floor((z + hillHalf) / BUCKET);
        const list = (bx >= 0 && bz >= 0 && bx < BN && bz < BN) ? buckets[bx * BN + bz] : [];
        for (const s of list) {
            d = Math.min(d, segDist(x, z, s.a, s.b) - s.hw);
            if (d <= 10) break; // already fully flat
        }
        m = Math.min(m, smooth(10, 50, d));
        const dx = Math.max(CITY.x0 - x, 0, x - CITY.x1);
        const dz = Math.max(CITY.z0 - z, 0, z - CITY.z1);
        m = Math.min(m, smooth(25, 80, Math.hypot(dx, dz)));
        m = Math.min(m, smooth(25, 70, Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r));
        for (const mt of mountainSpots) {
            const mdx = x - mt.x, mdz = z - mt.z, reach = mt.r + 70;
            if (mdx > reach || mdx < -reach || mdz > reach || mdz < -reach) continue;
            m = Math.min(m, smooth(mt.r + 20, reach, Math.sqrt(mdx * mdx + mdz * mdz)));
        }
        m = Math.min(m, 1 - smooth(740, 820, Math.hypot(x, z)));
        return m;
    }

    for (let j = 0; j < HW; j++) {
        for (let i = 0; i < HW; i++) {
            const x = -hillHalf + i * HILL.cell, z = -hillHalf + j * HILL.cell;
            const r = rawHill(x, z);
            // normal hills (flattened near roads) plus the bumps the roads climb over
            hillGrid[j * HW + i] = (r > 0.02 ? r * HILL.amp * flatMask(x, z) : 0) + bumpGrid[j * HW + i];
        }
    }

    function terrainHeight(x, z) { return sampleGrid(hillGrid, x, z); }

    // Visible hills: a subdivided plane whose heights come from the same grid
    const terrainGeo = new THREE.PlaneGeometry(HILL.size, HILL.size, HN, HN);
    terrainGeo.rotateX(-Math.PI / 2);
    const tPos = terrainGeo.attributes.position;
    for (let k = 0; k < HW * HW; k++) tPos.setY(k, hillGrid[k]);
    terrainGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ color: 0x2e7d32 })));

    // The old flat ground becomes the lit, slightly lower floor outside the hills
    ground.material = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
    ground.position.y = -0.1;

    // The car sticks to the hills: every step it is placed exactly on the ground,
    // so it never floats off a crest and never sinks into a slope
    world.addEventListener('postStep', function () {
        carBody.position.y = terrainHeight(carBody.position.x, carBody.position.z) + 0.78;
        carBody.velocity.y = 0;
    });

    // ---------- KEEP TREES OFF ROADS, CITY, LAKE AND MOUNTAINS ----------
    function blocked(x, z) {
        if (x > CITY.x0 - 25 && x < CITY.x1 + 25 && z > CITY.z0 - 25 && z < CITY.z1 + 25) return true;
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 18) return true;
        for (const m of mountainSpots) {
            if (Math.hypot(x - m.x, z - m.z) < m.r + 12) return true;
        }
        for (const s of roadSegs) {
            if (segDist(x, z, s.a, s.b) < s.hw + 5) return true;
        }
        return false;
    }

    // Wrap your existing placeTree: blocked trees are hidden until they get recycled
    const originalPlaceTree = placeTree;
    placeTree = function (t, x, z) {
        originalPlaceTree(t, x, z);
        const hide = blocked(x, z);
        const h = terrainHeight(x, z);
        t.mesh.visible = !hide;
        t.mesh.position.y = h;
        t.body.position.set(x, hide ? -100 : h + 1.5, z);
    };

    // Re-check the trees that were already placed before this file loaded
    trees.forEach(t => placeTree(t, t.mesh.position.x, t.mesh.position.z));

    // Shared with extras.js
    window.MAP = {
        CITY: CITY, RING_R: RING_R, WALL_R: WALL_R, LAKE: LAKE,
        roads: roadList, mountains: mountainSpots,
        offsetPts: offsetPts, terrainHeight: terrainHeight, bumps: BUMPS,
        pass: pass.pts, ringEnd: ringEnd
    };

})();