// wheels.js - load this AFTER graphics.js.
// Makes the wheels of your car and every NPC car roll with the real speed,
// spin backwards when reversing, and turn the front wheels when steering.
(function () {

    const WHEEL_R = 0.45;   // tyre radius (matches the cylinders in script.js)
    const WHEELBASE = 2.6;  // distance between front and rear axle
    const MAX_STEER = 0.5;  // how far the front wheels can turn (radians)
    const DT = 1 / 60;

    // A 5-spoke star on each wheel, so you can actually see it rotating
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 0.26 : 0.1;
        if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.44, bevelEnabled: false });
    starGeo.translate(0, 0, -0.22);
    starGeo.rotateX(-Math.PI / 2); // axle now runs along the wheel's own up axis
    const starMat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.35 });
    starMat.color.set(0x55595e).convertSRGBToLinear();
    starMat.userData.srgbFixed = true;

    // Wrap each wheel so it can turn (pivot) and roll (spin) independently
    function rig(parent) {
        const wheels = parent.children.filter(c => c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' &&
            Math.abs(c.geometry.parameters.radiusTop - WHEEL_R) < 0.01);
        const out = { fronts: [], spins: [] };
        wheels.forEach(w => {
            const pos = w.position.clone();
            parent.remove(w);
            const pivot = new THREE.Group();
            const spin = new THREE.Group();
            pivot.position.copy(pos);
            w.position.set(0, 0, 0);
            w.add(new THREE.Mesh(starGeo, starMat));
            spin.add(w);
            pivot.add(spin);
            parent.add(pivot);
            out.spins.push(spin);
            if (pos.z < 0) out.fronts.push(pivot); // the front of the car is -z
        });
        return out;
    }

    function apply(r, roll, steer) {
        r.spins.forEach(s => { s.rotation.x = roll; });
        r.fronts.forEach(p => { p.rotation.y = steer; });
    }

    // Your car
    const player = { rig: rig(carMesh), roll: 0, steer: 0 };

    // NPC cars: the groups graphics.js built (a group holding one inner group of car parts)
    const npcs = [];
    scene.children.filter(g => g.isGroup && g.children.length === 1 && g.children[0].isGroup).forEach(g => {
        const r = rig(g.children[0]);
        if (r.spins.length) npcs.push({ g: g, rig: r, roll: 0, steer: 0, px: 0, pz: 0, ph: 0, ready: false });
    });

    function wrap(a) {
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return a;
    }

    world.addEventListener('postStep', function () {
        // --- your car: roll with the real speed, steer with the keys ---
        const f = carBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
        const v = carBody.velocity.x * f.x + carBody.velocity.z * f.z;
        player.roll = (player.roll - (v * DT) / WHEEL_R) % (Math.PI * 2);

        // The front wheels show the real steering, and they turn less at speed
        const lock = MAX_STEER * 0.9 / (1 + Math.pow(Math.abs(v) / 25, 2));
        player.steer = (typeof steerInput !== 'undefined' ? steerInput : 0) * lock;
        apply(player.rig, player.roll, player.steer);

        // --- NPC cars: roll by how far they moved, steer by how fast they turned ---
        npcs.forEach(n => {
            const x = n.g.position.x, z = n.g.position.z;
            if (!n.ready) { n.px = x; n.pz = z; n.ready = true; return; }
            const dx = x - n.px, dz = z - n.pz;
            const dist = Math.hypot(dx, dz);
            if (dist > 1e-4 && dist < 20) { // (a big jump means the car looped back to the start)
                const heading = Math.atan2(-dx, -dz);
                const dh = wrap(heading - n.ph);
                const t = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan((WHEELBASE * dh) / dist)));
                n.steer += (t - n.steer) * 0.25;
                n.ph = heading;
                n.roll = (n.roll - dist / WHEEL_R) % (Math.PI * 2);
            }
            n.px = x;
            n.pz = z;
            apply(n.rig, n.roll, n.steer);
        });
    });

})();