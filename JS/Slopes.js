// slopes.js - load this LAST (after wheels.js).
// 1) Your car's body tilts up and down to match the ground under it.
// 2) Hills affect your speed: uphill slows you down, downhill lets you roll faster.
(function () {

    const M = window.MAP;
    if (!M) { console.error('slopes.js: map.js must load first.'); return; }

    // ---------- SETTINGS ----------
    const SLOPE_FEEL = 6;     // 1 = real gravity (you would barely notice); higher = hills matter more
    const MAX_SLOPE = 0.25;   // steepest slope that counts (stops very steep ground stalling you completely)
    const TILT_SMOOTH = 0.15; // how quickly the body follows the ground (smaller = floatier)
    const LOOK = 2;           // how far in front of and behind the car the ground is measured

    // Put every part of the car inside one group, so the body can tilt without
    // changing the car's heading (the physics body stays level and does the steering)
    const tilt = new THREE.Group();
    carMesh.children.slice().forEach(c => tilt.add(c));
    carMesh.add(tilt);

    let pitch = 0;
    const fwd = new CANNON.Vec3();

    world.addEventListener('postStep', function () {
        carBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1), fwd);
        const px = carBody.position.x, pz = carBody.position.z;

        // slope in the direction the car is facing (positive = the ground rises in front of you)
        const rise = M.terrainHeight(px + fwd.x * LOOK, pz + fwd.z * LOOK) -
                     M.terrainHeight(px - fwd.x * LOOK, pz - fwd.z * LOOK);
        const slope = rise / (LOOK * 2);

        // 1. Tilt the body: nose up going uphill, nose down going downhill
        pitch += (Math.atan(slope) - pitch) * TILT_SMOOTH;
        tilt.rotation.x = pitch;

        // 2. Hills push and pull your speed
        if (typeof gameState !== 'undefined' && gameState === 'playing') {
            const pedal = keys['ArrowUp'] || keys['KeyW'] || keys['ArrowDown'] || keys['KeyS'];
            // (when you are stopped and not on a pedal, the car stays put like a parked car)
            if (pedal || Math.abs(currentSpeed) > 0.5) {
                const s = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
                currentSpeed -= (9.82 * SLOPE_FEEL * s) / 60;
            }
        }
    });

})();