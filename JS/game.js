const DEBUG_HITBOXES = false;
const GROUND_SIZE = 10000;
const TREE_COUNT = 220;
const TREE_RANGE = 200;
const FOG_FAR = TREE_RANGE - 30;
const TREE_COLLISIONS = true;
const world = new CANNON.World();


// 2. Initialize Visual Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Blue Sky

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(20, 40, 10);
scene.add(sun);



const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// 4. Setup Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 5. Create Ground Mesh Floor
const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x2e7d32 }); 
const ground = new THREE.Mesh(groundGeometry, groundMaterial);

// Flatten ground and drop into world
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(5000, 0.5, 5000)), 
    position: new CANNON.Vec3(0, -0.5, 0)                
});
world.addBody(groundBody);

const carMesh = new THREE.Group();

const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.6, 4),
    new THREE.MeshLambertMaterial({ color: 0xd32f2f })
);

body.position.y = 0;
carMesh.add(body);

const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 2),
    new THREE.MeshLambertMaterial({ color: 0x90caf9 })
);
cabin.position.set(0, 0.6, 0.3);
carMesh.add(cabin);

const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x212121 });
[[-1.05, -0.3, -1.3], [1.05, -0.3, -1.3], [-1.05, -0.3, 1.3], [1.05, -0.3, 1.3]].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    carMesh.add(wheel);
});

const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
const lightMat = new THREE.MeshBasicMaterial({ color: 0xffff99 });
[-0.6, 0.6].forEach((x) => {
    const headlight = new THREE.Mesh(lightGeo, lightMat);
    headlight.position.set(x, 0.1, -2.02);
    carMesh.add(headlight);
});

scene.add(carMesh);

const carBody = new CANNON.Body({
    mass: 150,
    shape: new CANNON.Box(new CANNON.Vec3(1, 0.75, 2)), // half-sizes: 2 wide, 1.5 tall, 4 long
    position: new CANNON.Vec3(0, 2, 0),
    fixedRotation: true
});
carBody.updateMassProperties();
world.addBody(carBody);

if (DEBUG_HITBOXES) {
    const carBox = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.5, 4),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true })
    );
    carMesh.add(carBox);
}

const trees = [];

function placeTree(t, x, z) {
    const s = 0.8 + Math.random() * 0.8;
    const rot = Math.random() * Math.PI * 2;
    t.mesh.position.set(x, 0, z);
    t.mesh.scale.setScalar(s);
    t.mesh.rotation.y = rot;
    t.body.position.set(x, 1.5, z);
    t.body.quaternion.setFromEuler(0, rot, 0);
}

function randomInDisk(cx, cz, minR, maxR) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(minR * minR + Math.random() * (maxR * maxR - minR * minR));
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
}

for (let i = 0; i < TREE_COUNT; i++) {
    const mesh = new THREE.Group();

    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 2, 8),
        new THREE.MeshLambertMaterial({ color: 0x5d4037 })
    );
    trunk.position.y = 1;
    mesh.add(trunk);

    const leafMat = new THREE.MeshLambertMaterial({ color: 0x1b5e20 });
    const lower = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.5, 8), leafMat);
    lower.position.y = 3;
    mesh.add(lower);
    const upper = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2, 8), leafMat);
    upper.position.y = 4.5;
    mesh.add(upper);

    scene.add(mesh);

    const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(0.8, 1.5, 0.8))
    });
    if (TREE_COLLISIONS) world.addBody(body);

    const t = { mesh, body };
    trees.push(t);

    const p = randomInDisk(0, 0, 12, TREE_RANGE);
    placeTree(t, p.x, p.z);
}

function recycleTrees() {
    const cx = carBody.position.x;
    const cz = carBody.position.z;

    for (const t of trees) {
        const dx = t.mesh.position.x - cx;
        const dz = t.mesh.position.z - cz;
        const dist = Math.hypot(dx, dz);

        if (dist <= TREE_RANGE) continue;

        if (dist > TREE_RANGE * 2) {
            const p = randomInDisk(cx, cz, 12, TREE_RANGE);
            placeTree(t, p.x, p.z);
        } else {
            const angle = Math.atan2(dz, dx) + Math.PI + (Math.random() - 0.5) * 0.6;
            const r = TREE_RANGE - 5 - Math.random() * 25;
            placeTree(t, cx + Math.cos(angle) * r, cz + Math.sin(angle) * r);
        }
    }
}

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

let currentSpeed = 0;
let rearGrip = 0.9;
let driftAmount = 0;
let driftDir = 0;
let steerInput = 0; // -1 = full right, +1 = full left, eased so steering is not instant

// Cornering settings
const GRIP = 100;            // sideways acceleration the tyres can hold (higher = more grip, faster corners)
const MIN_TURN_RADIUS = 14;  // tightest turn the car can make at low speed
const DRIFT_GRIP = 1.3;     // how much sharper you can turn while drifting (1 = same as normal)
const DRIFT_SWING = 0.8;    // how hard the back end swings round in a drift

function drive() {
    const maxSpeed = 100;
    const maxReverse = -10;
    const acceleration = 0.4;
    const braking = 0.6;
    const coastDrag = 0.2;

    if (keys['ArrowUp'] || keys['KeyW']) {
        currentSpeed += acceleration * (1 - currentSpeed / maxSpeed) + 0.02;
    } else if (keys['ArrowDown'] || keys['KeyS']) {
        currentSpeed -= braking;
    } else {
        if (currentSpeed > 0) currentSpeed = Math.max(0, currentSpeed - coastDrag);
        if (currentSpeed < 0) currentSpeed = Math.min(0, currentSpeed + coastDrag);
    }

    currentSpeed = Math.max(maxReverse, Math.min(maxSpeed, currentSpeed));

    const turnLeft = keys['ArrowLeft'] || keys['KeyA'];
    const turnRight = keys['ArrowRight'] || keys['KeyD'];

    const isDrifting = keys['Space'] &&
                       (turnLeft || turnRight) &&
                       currentSpeed > maxSpeed * 0.4;

    if (isDrifting) {
        driftAmount = Math.min(1, driftAmount + 0.02);
        driftDir = turnLeft ? 1 : -1;
    } else {
        driftAmount = Math.max(0, driftAmount - 0.008);
    }

    // --- Steering: eased input, limited by what the tyres can hold at this speed ---
    let steerTarget = 0;
    if (turnLeft) steerTarget += 1;
    if (turnRight) steerTarget -= 1;
    steerInput += (steerTarget - steerInput) * (steerTarget === 0 ? 0.2 : 0.6);

    const speed = Math.abs(currentSpeed);
    const grip = isDrifting ? GRIP * DRIFT_GRIP : GRIP;

    // Fastest the car can turn (radians per second):
    //  - at low speed it is limited by the steering lock (minimum turn radius)
    //  - at high speed it is limited by grip: sideways acceleration = speed x turn rate
    const maxYaw = Math.min(speed / MIN_TURN_RADIUS, grip / Math.max(speed, 1));
    const yaw = steerInput * maxYaw * (currentSpeed >= 0 ? 1 : -1);

    // Turning hard scrubs off speed (tyre drag)
    if (!isDrifting) currentSpeed *= 1 - 0.0012 * Math.abs(steerInput) * Math.min(1, speed / 20);

    // Pushing the tyres hard at speed makes the rear slide a little (understeer feel)
    const slideLoad = Math.abs(steerInput) * Math.min(1, speed / 60);
    const targetRearGrip = isDrifting
        ? 0.1 - driftAmount * 0.08
        : Math.max(0.15, 0.9 - driftAmount * 0.8 - slideLoad * 0.3);
    rearGrip += (targetRearGrip - rearGrip) * (isDrifting ? 0.3 : 0.08);

    const forward = carBody.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
    const right = carBody.quaternion.vmult(new CANNON.Vec3(1, 0, 0));

    let sideSpeed = carBody.velocity.x * right.x + carBody.velocity.z * right.z;
    sideSpeed *= (1 - rearGrip);

    const maxSide = Math.abs(currentSpeed) * 0.8;
    sideSpeed = Math.max(-maxSide, Math.min(maxSide, sideSpeed));

    carBody.velocity.x = forward.x * currentSpeed + right.x * sideSpeed;
    carBody.velocity.z = forward.z * currentSpeed + right.z * sideSpeed;

    if (isDrifting) currentSpeed *= 0.995;

    const rearSwing = driftDir * driftAmount * DRIFT_SWING;
    carBody.angularVelocity.set(0, yaw + rearSwing, 0);
}   

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function die() {
    carBody.position.set(0, 2, 0);
    carBody.velocity.set(0, 0, 0);
    carBody.angularVelocity.set(0, 0, 0);
    carBody.quaternion.set(0, 0, 0, 1); // face forward again
    currentSpeed = 0;
    const msg = document.getElementById('msg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 1500);
}
function updateSpeedometer() {
    const kmh = Math.round(Math.abs(currentSpeed) * 2);
    document.getElementById('speedo').innerHTML =
        kmh + ' <span style="font-size:16px;">km/h</span>';
    
}
let gameState = 'menu';
let menuAngle = 0;

const menu = document.getElementById('menu');
const speedo = document.getElementById('speedo');
speedo.style.display = 'none';

function startGame() {
    gameState = 'playing';
    menu.classList.add('hide');
    speedo.style.display = 'block';
}

function showMenu() {
    gameState = 'menu';
    menu.classList.remove('hide');
    speedo.style.display = 'none';
    currentSpeed = 0;
    carBody.velocity.set(0, 0, 0);
    carBody.angularVelocity.set(0, 0, 0);
}


document.getElementById('playBtn').addEventListener('click', startGame);
document.getElementById('controlsBtn').addEventListener('click', () => {
    document.getElementById('controlsPanel').classList.toggle('open');
});
document.getElementById('creditsBtn').addEventListener('click', () => {
    document.getElementById('credits').classList.toggle('open');
});

window.addEventListener('keydown', (e) => {
    if (gameState === 'menu' && e.code === 'Enter') startGame();
    else if (gameState === 'playing' && e.code === 'Escape') showMenu();
    else if (gameState === 'playing' && e.code === 'KeyR') resetCar();
    else if (gameState === 'playing' && e.code === 'KeyP') pauseGame();
    else if (gameState === 'paused' && e.code === 'KeyP') resumeGame();
});

function resetCar() {
    carBody.position.set(0, 2, 0);
    carBody.velocity.set(0, 0, 0);
    carBody.angularVelocity.set(0, 0, 0);
    carBody.quaternion.set(0, 0, 0, 1);
    currentSpeed = 0;
}

const pauseOverlay = document.createElement('div');
pauseOverlay.style.cssText =
    'position:fixed; top:0; left:0; width:100%; height:100%;' +
    'display:none; flex-direction:column; align-items:center; justify-content:center;' +
    'background:rgba(0,0,0,0.4); color:white; z-index:20;' +
    'font:bold 64px sans-serif; text-shadow:3px 3px 8px black;';
pauseOverlay.innerHTML = 'PAUSED<div style="font-size:20px; margin-top:10px;">PRESS P TO RESUME</div>';
document.body.appendChild(pauseOverlay);

function pauseGame() {
    gameState = 'paused';
    pauseOverlay.style.display = 'flex';
}

function resumeGame() {
    gameState = 'playing';
    pauseOverlay.style.display = 'none';
}

function update() {
    requestAnimationFrame(update);

    if (gameState === 'paused') {
        renderer.render(scene, camera);
        return;
    }

    if (gameState === 'playing') drive();
    world.step(1 / 60);
    console.log('vel', carBody.velocity.x.toFixed(1), carBody.velocity.z.toFixed(1), 'pos', carBody.position.x.toFixed(1), carBody.position.z.toFixed(1), 'speed', currentSpeed.toFixed(1));

    // If something blocks the car, drop the target speed to the real speed
    if (gameState === 'playing') {
        const actualSpeed = Math.hypot(carBody.velocity.x, carBody.velocity.z);
        if (Math.abs(currentSpeed) > 2 && actualSpeed < Math.abs(currentSpeed) * 0.6) {
            currentSpeed = actualSpeed * (currentSpeed >= 0 ? 1 : -1);
        }
    }

    //recycleTrees();
    updateSpeedometer();

    if (carBody.position.y < -15) die();

    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);

    if (gameState === 'menu') {
        menuAngle += 0.005;
        camera.position.set(
            carMesh.position.x + Math.sin(menuAngle) * 12,
            4,
            carMesh.position.z + Math.cos(menuAngle) * 12
        );
        camera.lookAt(carMesh.position);
    } else {
        const offset = new THREE.Vector3(0, 5, 10).applyQuaternion(carMesh.quaternion);
        camera.position.copy(carMesh.position).add(offset);
        camera.lookAt(carMesh.position);
    }

    renderer.render(scene, camera);
}
update();