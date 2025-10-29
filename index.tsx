// --- Setup ---
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

let width, height;
let isTouchDevice = false;

// --- Dynamic Constants (calculated on resize) ---
let TANK_WIDTH, TANK_HEIGHT, TURRET_LENGTH, JOYSTICK_RADIUS, JOYSTICK_KNOB_RADIUS, FIRE_BUTTON_RADIUS, POWERUP_RADIUS;

// --- Static Constants ---
const TANK_SPEED = 2;
const TANK_TURN_SPEED = 0.04;
const BULLET_SPEED = 6;
const BULLET_SIZE = 5;
const WINNING_SCORE = 3;
const P1_COLOR = '#00ff00'; // Neon Green
const P2_COLOR = '#ff00ff'; // Neon Pink
const BARRIER_COLOR = '#555'; // Dim Gray
const FIRE_COOLDOWN = 600;

// --- Power-up Constants ---
const POWERUP_SPAWN_INTERVAL = 10000; // 10 seconds
const POWERUP_LIFESPAN = 8000;       // 8 seconds on map
const POWERUP_EFFECT_DURATION = 10000; // 10 seconds for the effect

const PowerUpType = {
    SPEED_BOOST: 'SPEED_BOOST',
    RAPID_FIRE: 'RAPID_FIRE',
    SHIELD: 'SHIELD',
    PIERCING_SHOT: 'PIERCING_SHOT'
};

const POWERUP_CONFIG = {
    [PowerUpType.SPEED_BOOST]: { color: '#00ffff', letter: 'S' }, // Cyan
    [PowerUpType.RAPID_FIRE]: { color: '#ffff00', letter: 'F' }, // Yellow
    [PowerUpType.SHIELD]: { color: '#ffffff', letter: 'H' },     // White
    [PowerUpType.PIERCING_SHOT]: { color: '#ff8800', letter: 'P' } // Orange
};

// --- AI Pathfinding ---
const GRID_CELL_SIZE = 30; // Size of each cell in the navigation grid
let navGrid = [];
let gridWidth, gridHeight;
const DEBUG_AI_PATH = false; // Set to true to visualize the grid and path


function resizeCanvas() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    // Calculate dynamic sizes based on screen dimensions
    TANK_WIDTH = Math.min(width, height) * 0.05;
    TANK_HEIGHT = TANK_WIDTH * 1.2;
    TURRET_LENGTH = TANK_HEIGHT * 0.8;
    JOYSTICK_RADIUS = Math.min(width, height) * 0.1;
    JOYSTICK_KNOB_RADIUS = JOYSTICK_RADIUS * 0.4;
    FIRE_BUTTON_RADIUS = Math.min(width, height) * 0.08;
    POWERUP_RADIUS = Math.min(width, height) * 0.02;

    createBarriers();
    createNavGrid();
}
window.addEventListener('resize', resizeCanvas);


// --- Game State ---
const GameState = {
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER',
};
let gameState = GameState.MENU;
let numPlayers = 2;

let player1, player2;
let bullets = [];
let barriers = [];
let powerUps = [];
let lastPowerUpSpawnTime = 0;
let touches = {}; // To track which touch ID controls which element
let winner = null;
let currentLayoutIndex = 0;
// Fix: Use 'any' type for menuButtons to allow dynamic property assignment at runtime.
let menuButtons: any = {};

// --- Sound Engine ---
// Fix: Cast window to `any` to allow access to the deprecated `webkitAudioContext` for older browser compatibility.
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

function playSound(type) {
    if (!audioCtx) return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    if (type === 'fire') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(660, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
        oscillator.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
    } else if (type === 'hit') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(100, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);
        oscillator.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
    } else if (type === 'bounce') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(330, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
    } else if (type === 'powerup') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
        oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
    } else if (type === 'shield_break') {
        oscillator.type = 'noise';
        gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
    }

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.2);
}

// --- Game Object Factory ---
function createTank(color) {
    return {
        x: 0, y: 0, angle: 0, color,
        width: TANK_WIDTH, height: TANK_HEIGHT,
        score: 0, lastShotTime: 0, recoil: 0,
        joystick: { id: null, active: false, x: 0, y: 0, baseX: 0, baseY: 0 },
        fireButton: { id: null, active: false, x: 0, y: 0 },
        keys: { up: false, down: false, left: false, right: false, fire: false },
        powerUp: { type: null, endTime: 0 },
        hasShield: false,
        nextShotPiercing: false,
        vx: 0, vy: 0, // Velocity for prediction
        // AI properties
        aiDecisionTimer: 0,
        aiTarget: null,
        aiEvasionData: { active: false, moveAngle: 0, timer: 0 },
        aiPath: [],
        aiPathIndex: 0,
    };
}

// --- Barrier Layouts ---
function createLayout0() { // Original Layout
    const barrierWidth = width * 0.02;
    const longBarrierHeight = height * 0.25;
    const shortBarrierWidth = width * 0.15;
    barriers.push({ x: width / 2 - barrierWidth / 2, y: height * 0.15, width: barrierWidth, height: longBarrierHeight });
    barriers.push({ x: width / 2 - barrierWidth / 2, y: height * 0.85 - longBarrierHeight, width: barrierWidth, height: longBarrierHeight });
    barriers.push({ x: width * 0.25 - shortBarrierWidth / 2, y: height / 2 - barrierWidth / 2, width: shortBarrierWidth, height: barrierWidth });
    barriers.push({ x: width * 0.75 - shortBarrierWidth / 2, y: height / 2 - barrierWidth / 2, width: shortBarrierWidth, height: barrierWidth });
}

function createLayout1() { // Central Box
    const boxSize = Math.min(width, height) * 0.25;
    const thickness = width * 0.02;
    const boxX = width / 2 - boxSize / 2;
    const boxY = height / 2 - boxSize / 2;
    barriers.push({ x: boxX, y: boxY, width: boxSize, height: thickness });
    barriers.push({ x: boxX, y: boxY + boxSize - thickness, width: boxSize, height: thickness });
    barriers.push({ x: boxX, y: boxY + thickness, width: thickness, height: boxSize - thickness * 2 });
    barriers.push({ x: boxX + boxSize - thickness, y: boxY + thickness, width: thickness, height: boxSize - thickness * 2 });
}

function createLayout2() { // Offset Pillars
    const pillarWidth = width * 0.02;
    const pillarHeight = height * 0.3;
    const hPillarWidth = width * 0.2;
    barriers.push({ x: width * 0.3 - pillarWidth / 2, y: height * 0.1, width: pillarWidth, height: pillarHeight });
    barriers.push({ x: width * 0.7 - pillarWidth / 2, y: height * 0.9 - pillarHeight, width: pillarWidth, height: pillarHeight });
    barriers.push({ x: width / 2 - hPillarWidth / 2, y: height / 2 - pillarWidth / 2, width: hPillarWidth, height: pillarWidth });
}

function createLayout3() { // Funnel
    const barrierWidth = width * 0.15;
    const barrierHeight = height * 0.03;
    const centerPillarWidth = width * 0.02;
    const centerPillarHeight = height * 0.15;
    barriers.push({ x: width * 0.2, y: height * 0.3, width: barrierWidth, height: barrierHeight });
    barriers.push({ x: width * 0.8 - barrierWidth, y: height * 0.3, width: barrierWidth, height: barrierHeight });
    barriers.push({ x: width * 0.2, y: height * 0.7 - barrierHeight, width: barrierWidth, height: barrierHeight });
    barriers.push({ x: width * 0.8 - barrierWidth, y: height * 0.7 - barrierHeight, width: barrierWidth, height: barrierHeight });
    barriers.push({ x: width / 2 - centerPillarWidth / 2, y: height / 2 - centerPillarHeight / 2, width: centerPillarWidth, height: centerPillarHeight });
}

const barrierLayouts = [createLayout0, createLayout1, createLayout2, createLayout3];

function createBarriers() {
    barriers = [];
    barrierLayouts[currentLayoutIndex]();
}


// --- Game Logic ---
function startGame(players) {
    numPlayers = players;
    player1.score = 0;
    player2.score = 0;
    currentLayoutIndex = 0;
    createBarriers();
    createNavGrid();
    resetRound();
    winner = null;
    gameState = GameState.PLAYING;
}


function resetRound() {
    player1.x = width * 0.15;
    player1.y = height / 2;
    player1.angle = 0; // Pointing right
    player1.powerUp = { type: null, endTime: 0 };
    player1.hasShield = false;
    player1.nextShotPiercing = false;
    player1.vx = 0;
    player1.vy = 0;

    player2.x = width * 0.85;
    player2.y = height / 2;
    player2.angle = Math.PI; // Pointing left
    player2.powerUp = { type: null, endTime: 0 };
    player2.hasShield = false;
    player2.nextShotPiercing = false;
    player2.vx = 0;
    player2.vy = 0;
    player2.aiPath = [];
    player2.aiPathIndex = 0;


    bullets = [];
    powerUps = [];
    lastPowerUpSpawnTime = Date.now();
}

function init(isTouch) {
    isTouchDevice = isTouch;
    currentLayoutIndex = 0;
    resizeCanvas(); // Initial call
    player1 = createTank(P1_COLOR);
    player2 = createTank(P2_COLOR);
    gameState = GameState.MENU;
    winner = null;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function update() {
    if (gameState !== GameState.PLAYING) return;
    spawnPowerUp();
    updatePowerUps();
    updateTank(player1);
    if (numPlayers === 1) {
        updateAITank(player2, player1);
    } else {
        updateTank(player2);
    }
    updateBullets();
    checkTankCollisions();
    checkPowerUpCollisions();
}

function spawnPowerUp() {
    if (Date.now() - lastPowerUpSpawnTime < POWERUP_SPAWN_INTERVAL || powerUps.length >= 2) return;

    lastPowerUpSpawnTime = Date.now();

    const types = Object.values(PowerUpType);
    const type = types[Math.floor(Math.random() * types.length)];

    let x, y, colliding;
    do {
        colliding = false;
        x = POWERUP_RADIUS + Math.random() * (width - POWERUP_RADIUS * 2);
        y = POWERUP_RADIUS + Math.random() * (height - POWERUP_RADIUS * 2);

        for (const barrier of barriers) {
            if (x > barrier.x - POWERUP_RADIUS && x < barrier.x + barrier.width + POWERUP_RADIUS &&
                y > barrier.y - POWERUP_RADIUS && y < barrier.y + barrier.height + POWERUP_RADIUS) {
                colliding = true;
                break;
            }
        }
    } while (colliding);

    powerUps.push({ x, y, type, spawnTime: Date.now() });
}

function updatePowerUps() {
    const now = Date.now();
    powerUps = powerUps.filter(p => now - p.spawnTime < POWERUP_LIFESPAN);
}

function checkPowerUpCollisions() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const powerUp = powerUps[i];
        if (isColliding(powerUp, player1, POWERUP_RADIUS)) {
            collectPowerUp(player1, powerUp.type);
            powerUps.splice(i, 1);
        } else if (isColliding(powerUp, player2, POWERUP_RADIUS)) {
            collectPowerUp(player2, powerUp.type);
            powerUps.splice(i, 1);
        }
    }
}

function collectPowerUp(tank, type) {
    playSound('powerup');
    tank.powerUp = { type: null, endTime: 0 };
    tank.hasShield = false;
    tank.nextShotPiercing = false;

    if (type === PowerUpType.SHIELD) {
        tank.hasShield = true;
    } else if (type === PowerUpType.PIERCING_SHOT) {
        tank.nextShotPiercing = true;
    } else {
        tank.powerUp.type = type;
        tank.powerUp.endTime = Date.now() + POWERUP_EFFECT_DURATION;
    }
}

function updateTank(tank) {
    if (tank.recoil > 0) tank.recoil -= 1;
    if (tank.powerUp.type && Date.now() > tank.powerUp.endTime) {
        tank.powerUp.type = null;
    }

    const oldX_for_velocity = tank.x;
    const oldY_for_velocity = tank.y;

    let isMoving = false;
    const currentSpeed = tank.powerUp.type === PowerUpType.SPEED_BOOST ? TANK_SPEED * 1.5 : TANK_SPEED;

    if (isTouchDevice) {
        const joy = tank.joystick;
        if (joy.active) {
            const dx = joy.x - joy.baseX;
            const dy = joy.y - joy.baseY;
            const dist = Math.hypot(dx, dy);

            if (dist > JOYSTICK_RADIUS * 0.2) { // Deadzone
                isMoving = true;
                const targetAngle = Math.atan2(dy, dx);
                let angleDiff = targetAngle - tank.angle;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                tank.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TANK_TURN_SPEED);

                const speedRatio = Math.min(1, dist / JOYSTICK_RADIUS);
                const forwardComponent = Math.cos(tank.angle) * dx + Math.sin(tank.angle) * dy;
                const moveSpeed = (forwardComponent / dist) * currentSpeed * speedRatio;

                const oldX = tank.x;
                const oldY = tank.y;

                tank.x += Math.cos(tank.angle) * moveSpeed;
                if (isTankCollidingWithBarriers(tank)) tank.x = oldX;

                tank.y += Math.sin(tank.angle) * moveSpeed;
                if (isTankCollidingWithBarriers(tank)) tank.y = oldY;
            }
        }
    } else { // Keyboard logic
        if (tank.keys.left) {
            tank.angle -= TANK_TURN_SPEED;
        }
        if (tank.keys.right) {
            tank.angle += TANK_TURN_SPEED;
        }

        let moveSpeed = 0;
        if (tank.keys.up) {
            moveSpeed = currentSpeed;
            isMoving = true;
        } else if (tank.keys.down) {
            moveSpeed = -currentSpeed * 0.7; // Slower backwards
            isMoving = true;
        }

        if (moveSpeed !== 0) {
            const oldX = tank.x;
            const oldY = tank.y;
            tank.x += Math.cos(tank.angle) * moveSpeed;
            if (isTankCollidingWithBarriers(tank)) tank.x = oldX;
            tank.y += Math.sin(tank.angle) * moveSpeed;
            if (isTankCollidingWithBarriers(tank)) tank.y = oldY;
        }
    }

    tank.x = Math.max(tank.width / 2, Math.min(width - tank.width / 2, tank.x));
    tank.y = Math.max(tank.height / 2, Math.min(height - tank.height / 2, tank.y));

    // After all position updates, calculate final velocity for this frame.
    tank.vx = tank.x - oldX_for_velocity;
    tank.vy = tank.y - oldY_for_velocity;

    const currentCooldown = tank.powerUp.type === PowerUpType.RAPID_FIRE ? FIRE_COOLDOWN * 0.4 : FIRE_COOLDOWN;
    const isFiring = isTouchDevice ? tank.fireButton.active : tank.keys.fire;
    
    if (isFiring && Date.now() - tank.lastShotTime > currentCooldown) {
        fire(tank);
    }
}

function fire(tank) {
    playSound('fire');
    tank.lastShotTime = Date.now();
    tank.recoil = 10;
    const bulletX = tank.x + Math.cos(tank.angle) * (TURRET_LENGTH - tank.recoil);
    const bulletY = tank.y + Math.sin(tank.angle) * (TURRET_LENGTH - tank.recoil);
    bullets.push({
        x: bulletX, y: bulletY, angle: tank.angle, owner: tank, bounces: 0, trail: [],
        isPiercing: tank.nextShotPiercing
    });
    if (tank.nextShotPiercing) tank.nextShotPiercing = false;
}

function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];

        bullet.trail.push({ x: bullet.x, y: bullet.y });
        if (bullet.trail.length > 10) bullet.trail.shift();

        bullet.x += Math.cos(bullet.angle) * BULLET_SPEED;
        bullet.y += Math.sin(bullet.angle) * BULLET_SPEED;

        if (checkBulletWallAndBarrierCollision(bullet)) {
            bullets.splice(i, 1);
            continue;
        }

        if (isColliding(bullet, player1) && bullet.owner !== player1) {
            handleHit(player2, i);
            return;
        } else if (isColliding(bullet, player2) && bullet.owner !== player2) {
            handleHit(player1, i);
            return;
        }
    }
}

function checkBulletWallAndBarrierCollision(bullet) {
    let bounced = false;

    // Wall collision
    if (bullet.x < BULLET_SIZE || bullet.x > width - BULLET_SIZE) {
        bullet.angle = Math.PI - bullet.angle;
        bullet.x = Math.max(BULLET_SIZE, Math.min(width - BULLET_SIZE, bullet.x));
        bounced = true;
    }
    if (bullet.y < BULLET_SIZE || bullet.y > height - BULLET_SIZE) {
        bullet.angle = -bullet.angle;
        bullet.y = Math.max(BULLET_SIZE, Math.min(height - BULLET_SIZE, bullet.y));
        bounced = true;
    }

    // Barrier collision
    if (!bounced) {
        for (const barrier of barriers) {
            if (bullet.x > barrier.x && bullet.x < barrier.x + barrier.width &&
                bullet.y > barrier.y && bullet.y < barrier.y + barrier.height) {

                if (bullet.isPiercing) {
                    bullet.isPiercing = false;
                    playSound('bounce');
                    break;
                }

                bounced = true;
                const prevX = bullet.x - Math.cos(bullet.angle) * BULLET_SPEED;
                
                if (prevX <= barrier.x || prevX >= barrier.x + barrier.width) {
                    bullet.angle = Math.PI - bullet.angle;
                } else {
                    bullet.angle = -bullet.angle;
                }
                bullet.x = prevX; // Move out to prevent getting stuck
                break;
            }
        }
    }

    if (bounced) {
        if (bullet.bounces > 0) return true; // Remove after 1 bounce
        bullet.bounces++;
        playSound('bounce');
    }
    return false;
}

function handleHit(scorer, bulletIndex) {
    const hitTank = scorer === player1 ? player2 : player1;
    if (hitTank.hasShield) {
        hitTank.hasShield = false;
        bullets.splice(bulletIndex, 1);
        playSound('shield_break');
        return;
    }

    scorer.score++;
    bullets.splice(bulletIndex, 1);
    playSound('hit');

    currentLayoutIndex = (currentLayoutIndex + 1) % barrierLayouts.length;
    createBarriers();
    createNavGrid();

    checkWin();
    if (gameState !== GameState.GAME_OVER) resetRound();
}

function isColliding(obj, tank, objRadius = BULLET_SIZE) {
    return Math.hypot(obj.x - tank.x, obj.y - tank.y) < tank.width / 2 + objRadius;
}

function isRectColliding(rect1, rect2) {
    const rect1Left = rect1.x - rect1.width / 2;
    const rect1Right = rect1.x + rect1.width / 2;
    const rect1Top = rect1.y - rect1.height / 2;
    const rect1Bottom = rect1.y + rect1.height / 2;

    return rect1Left < rect2.x + rect2.width &&
        rect1Right > rect2.x &&
        rect1Top < rect2.y + rect2.height &&
        rect1Bottom > rect2.y;
}

function isTankCollidingWithBarriers(tank) {
    for (const barrier of barriers) {
        if (isRectColliding({ x: tank.x, y: tank.y, width: TANK_WIDTH, height: TANK_WIDTH }, barrier)) {
            return true;
        }
    }
    return false;
}

function checkTankCollisions() {
    const dx = player1.x - player2.x;
    const dy = player1.y - player2.y;
    const dist = Math.hypot(dx, dy);
    if (dist < TANK_WIDTH) {
        const overlap = (TANK_WIDTH - dist) / 2;
        const angle = Math.atan2(dy, dx);
        player1.x += Math.cos(angle) * overlap;
        player1.y += Math.sin(angle) * overlap;
        player2.x -= Math.cos(angle) * overlap;
        player2.y -= Math.sin(angle) * overlap;
    }
}

function checkWin() {
    if (player1.score >= WINNING_SCORE) {
        gameState = GameState.GAME_OVER;
        winner = player1;
    } else if (player2.score >= WINNING_SCORE) {
        gameState = GameState.GAME_OVER;
        winner = player2;
    }
}

// --- AI Logic ---
function createNavGrid() {
    gridWidth = Math.floor(width / GRID_CELL_SIZE);
    gridHeight = Math.floor(height / GRID_CELL_SIZE);
    navGrid = [];
    for (let y = 0; y < gridHeight; y++) {
        const row = [];
        for (let x = 0; x < gridWidth; x++) {
            const worldX = x * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
            const worldY = y * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
            let isWall = false;
            // Add a buffer around barriers
            const checkRadius = TANK_WIDTH / 2;
            for (const barrier of barriers) {
                if (worldX > barrier.x - checkRadius && worldX < barrier.x + barrier.width + checkRadius &&
                    worldY > barrier.y - checkRadius && worldY < barrier.y + barrier.height + checkRadius) {
                    isWall = true;
                    break;
                }
            }
            row.push({
                x, y,
                isWall,
                g: 0, h: 0, f: 0,
                parent: null
            });
        }
        navGrid.push(row);
    }
}

function findPath(startPos, endPos) {
    const startNodeX = Math.floor(startPos.x / GRID_CELL_SIZE);
    const startNodeY = Math.floor(startPos.y / GRID_CELL_SIZE);
    const endNodeX = Math.floor(endPos.x / GRID_CELL_SIZE);
    const endNodeY = Math.floor(endPos.y / GRID_CELL_SIZE);

    if (startNodeX < 0 || startNodeX >= gridWidth || startNodeY < 0 || startNodeY >= gridHeight ||
        endNodeX < 0 || endNodeX >= gridWidth || endNodeY < 0 || endNodeY >= gridHeight) {
        return [];
    }

    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            navGrid[y][x].g = 0;
            navGrid[y][x].h = 0;
            navGrid[y][x].f = 0;
            navGrid[y][x].parent = null;
        }
    }

    const findClosestValidNode = (nodeX, nodeY) => {
        let root = navGrid[nodeY][nodeX];
        if (!root.isWall) return root;

        const queue = [root];
        const visited = new Set([root]);

        while(queue.length > 0) {
            const current = queue.shift();
            if (!current.isWall) {
                return current;
            }
            const neighbors = [[0,-1], [1,0], [0,1], [-1,0], [-1,-1], [1,-1], [1,1], [-1,1]];
            for (const [dx, dy] of neighbors) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                    const neighbor = navGrid[ny][nx];
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                }
            }
        }
        return null; 
    };

    const startNode = findClosestValidNode(startNodeX, startNodeY);
    const endNode = findClosestValidNode(endNodeX, endNodeY);

    if (!startNode || !endNode || startNode === endNode) {
        return [];
    }
    
    const openSet = [startNode];
    const closedSet = new Set();

    while (openSet.length > 0) {
        let lowestFIndex = 0;
        for (let i = 1; i < openSet.length; i++) {
            if (openSet[i].f < openSet[lowestFIndex].f) {
                lowestFIndex = i;
            }
        }

        const currentNode = openSet[lowestFIndex];

        if (currentNode === endNode) {
            const path = [];
            let temp = currentNode;
            while (temp) {
                path.push({
                    x: temp.x * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
                    y: temp.y * GRID_CELL_SIZE + GRID_CELL_SIZE / 2
                });
                temp = temp.parent;
            }
            return path.reverse();
        }

        openSet.splice(lowestFIndex, 1);
        closedSet.add(currentNode);

        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;

                const neighborX = currentNode.x + i;
                const neighborY = currentNode.y + j;

                if (neighborX >= 0 && neighborX < gridWidth && neighborY >= 0 && neighborY < gridHeight) {
                    const neighbor = navGrid[neighborY][neighborX];

                    if (closedSet.has(neighbor) || neighbor.isWall) {
                        continue;
                    }
                    
                    // Prevent cutting corners
                    if (i !== 0 && j !== 0) {
                        if (navGrid[neighborY][currentNode.x].isWall || navGrid[currentNode.y][neighborX].isWall) {
                            continue;
                        }
                    }

                    const gScore = currentNode.g + Math.hypot(i, j);
                    let gScoreIsBest = false;

                    if (!openSet.includes(neighbor)) {
                        gScoreIsBest = true;
                        neighbor.h = Math.hypot(neighbor.x - endNode.x, neighbor.y - endNode.y);
                        openSet.push(neighbor);
                    } else if (gScore < neighbor.g) {
                        gScoreIsBest = true;
                    }

                    if (gScoreIsBest) {
                        neighbor.parent = currentNode;
                        neighbor.g = gScore;
                        neighbor.f = neighbor.g + neighbor.h;
                    }
                }
            }
        }
    }
    return [];
}

function smoothPath(path) {
    if (path.length <= 2) {
        return path;
    }

    const smoothedPath = [path[0]];
    let lastPointInSmoothedPath = path[0];

    for (let i = 2; i < path.length; i++) {
        if (!isLineOfSightClear(lastPointInSmoothedPath, path[i])) {
            smoothedPath.push(path[i - 1]);
            lastPointInSmoothedPath = path[i - 1];
        }
    }
    
    smoothedPath.push(path[path.length - 1]);
    
    return smoothedPath;
}


function predictOpponentPosition(ai, opponent) {
    const dx = opponent.x - ai.x;
    const dy = opponent.y - ai.y;
    const dist = Math.hypot(dx, dy);

    if (dist < TANK_WIDTH * 2 || (opponent.vx === 0 && opponent.vy === 0)) {
        return { x: opponent.x, y: opponent.y };
    }

    const timeToTarget = dist / BULLET_SPEED;
    let predictedX = opponent.x + opponent.vx * timeToTarget;
    let predictedY = opponent.y + opponent.vy * timeToTarget;

    const spreadFactor = dist / (width * 0.5);
    predictedX += (Math.random() - 0.5) * TANK_WIDTH * spreadFactor;
    predictedY += (Math.random() - 0.5) * TANK_WIDTH * spreadFactor;

    predictedX = Math.max(0, Math.min(width, predictedX));
    predictedY = Math.max(0, Math.min(height, predictedY));

    return { x: predictedX, y: predictedY };
}


function findIncomingBullet(ai) {
    let closestThreat = null;
    let minTimeToAction = Infinity;

    for (const bullet of bullets) {
        if (bullet.owner === ai) continue;

        const dx = ai.x - bullet.x;
        const dy = ai.y - bullet.y;
        const dist = Math.hypot(dx, dy);

        if (dist > width * 0.4) continue;

        const angleToAI = Math.atan2(dy, dx);
        let angleDiff = bullet.angle - angleToAI;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) < 0.5) {
            const timeToImpact = dist / BULLET_SPEED;
            if (timeToImpact < minTimeToAction) {
                 minTimeToAction = timeToImpact;
                 closestThreat = bullet;
            }
        }
    }
    return closestThreat;
}

function findClosestPowerUp(ai) {
    let closest = null;
    let closestDist = Infinity;
    for (const p of powerUps) {
        const dist = Math.hypot(ai.x - p.x, ai.y - p.y);
        if (dist < closestDist) {
            closestDist = dist;
            closest = p;
        }
    }
    return closest;
}

function isLineOfSightClear(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.floor(dist / BULLET_SIZE);

    for (let i = 1; i < steps; i++) {
        const checkX = p1.x + (dx * i) / steps;
        const checkY = p1.y + (dy * i) / steps;
        for (const barrier of barriers) {
            if (checkX > barrier.x && checkX < barrier.x + barrier.width &&
                checkY > barrier.y && checkY < barrier.y + barrier.height) {
                return false;
            }
        }
    }
    return true;
}

function findCover(ai, opponent, barriers) {
    let bestCoverSpot = null;
    let minDistance = Infinity;

    for (const barrier of barriers) {
        const barrierCenterX = barrier.x + barrier.width / 2;
        const barrierCenterY = barrier.y + barrier.height / 2;

        const dirX = barrierCenterX - opponent.x;
        const dirY = barrierCenterY - opponent.y;
        const distToOpponent = Math.hypot(dirX, dirY);
        if (distToOpponent === 0) continue;

        const normX = dirX / distToOpponent;
        const normY = dirY / distToOpponent;

        const coverPadding = TANK_WIDTH * 0.8;
        const coverX = barrierCenterX + normX * (Math.max(barrier.width, barrier.height) / 2 + coverPadding);
        const coverY = barrierCenterY + normY * (Math.max(barrier.width, barrier.height) / 2 + coverPadding);
        const potentialSpot = { x: coverX, y: coverY };

        if (potentialSpot.x < TANK_WIDTH / 2 || potentialSpot.x > width - TANK_WIDTH / 2 ||
            potentialSpot.y < TANK_HEIGHT / 2 || potentialSpot.y > height - TANK_HEIGHT / 2) {
            continue;
        }

        let isInsideBarrier = false;
        for (const otherBarrier of barriers) {
            if (potentialSpot.x > otherBarrier.x && potentialSpot.x < otherBarrier.x + otherBarrier.width &&
                potentialSpot.y > otherBarrier.y && potentialSpot.y < otherBarrier.y + otherBarrier.height) {
                isInsideBarrier = true;
                break;
            }
        }
        if (isInsideBarrier) continue;

        if (!isLineOfSightClear(potentialSpot, opponent)) {
            const distToAI = Math.hypot(ai.x - potentialSpot.x, ai.y - potentialSpot.y);
            if (distToAI < minDistance) {
                minDistance = distToAI;
                bestCoverSpot = potentialSpot;
            }
        }
    }
    return bestCoverSpot;
}

function updateAITank(ai, opponent) {
    ai.aiDecisionTimer -= 16; // rough delta time
    if (ai.recoil > 0) ai.recoil -= 1;
    if (ai.powerUp.type && Date.now() > ai.powerUp.endTime) {
        ai.powerUp.type = null;
    }

    // --- High-priority Evasion Logic ---
    const incomingBullet = findIncomingBullet(ai);
    if (!ai.aiEvasionData.active && incomingBullet && !ai.hasShield) {
        ai.aiEvasionData.active = true;
        ai.aiEvasionData.timer = 15;
        const dodgeDirection = Math.random() > 0.5 ? 1 : -1;
        ai.aiEvasionData.moveAngle = incomingBullet.angle + (Math.PI / 2) * dodgeDirection;
    }

    if (ai.aiEvasionData.active) {
        ai.aiEvasionData.timer--;
        if (ai.aiEvasionData.timer <= 0) {
            ai.aiEvasionData.active = false;
        } else {
            const currentSpeed = ai.powerUp.type === PowerUpType.SPEED_BOOST ? TANK_SPEED * 1.5 : TANK_SPEED;
            const oldX = ai.x, oldY = ai.y;
            ai.x += Math.cos(ai.aiEvasionData.moveAngle) * currentSpeed;
            if (isTankCollidingWithBarriers(ai)) ai.x = oldX;
            ai.y += Math.sin(ai.aiEvasionData.moveAngle) * currentSpeed;
            if (isTankCollidingWithBarriers(ai)) ai.y = oldY;
            
            const predictedPos = predictOpponentPosition(ai, opponent);
            const angleToOpponent = Math.atan2(predictedPos.y - ai.y, predictedPos.x - ai.x);
            let angleDiff = angleToOpponent - ai.angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            ai.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TANK_TURN_SPEED);

            const aimDiff = Math.abs(angleDiff);
            const currentCooldown = ai.powerUp.type === PowerUpType.RAPID_FIRE ? FIRE_COOLDOWN * 0.4 : FIRE_COOLDOWN;
            if (aimDiff < 0.15 && isLineOfSightClear(ai, opponent) && Date.now() - ai.lastShotTime > currentCooldown) {
                fire(ai);
            }
            
            ai.x = Math.max(ai.width / 2, Math.min(width - ai.width / 2, ai.x));
            ai.y = Math.max(ai.height / 2, Math.min(height - ai.height / 2, ai.y));
            return;
        }
    }
    // --- End of Evasion Logic ---

    // --- Pathfinding and Goal Selection ---
    if (ai.aiDecisionTimer <= 0) {
        ai.aiDecisionTimer = 1000 + Math.random() * 500;
        
        let primaryTarget = findClosestPowerUp(ai);
        const distToOpponent = Math.hypot(ai.x - opponent.x, ai.y - opponent.y);
        if (!primaryTarget || (distToOpponent < width * 0.3 && (ai.hasShield || ai.powerUp.type))) {
             primaryTarget = opponent;
        }

        const isUnderFire = !ai.hasShield && isLineOfSightClear(ai, opponent);
        if (isUnderFire) {
            const bestCover = findCover(ai, opponent, barriers);
            ai.aiTarget = bestCover ? bestCover : (primaryTarget || opponent);
        } else {
            ai.aiTarget = primaryTarget || opponent;
        }
        
        if (ai.aiTarget) {
            const rawPath = findPath({ x: ai.x, y: ai.y }, { x: ai.aiTarget.x, y: ai.aiTarget.y });
            ai.aiPath = smoothPath(rawPath);
            ai.aiPathIndex = 0;
        } else {
            ai.aiPath = [];
        }
    }

    // --- Movement Logic ---
    let isMoving = false;
    let turnDirection = 0;
    
    if (ai.aiPath.length > 0 && ai.aiPathIndex < ai.aiPath.length) {
        const pathTarget = ai.aiPath[ai.aiPathIndex];
        const distToWaypoint = Math.hypot(pathTarget.x - ai.x, pathTarget.y - ai.y);

        if (distToWaypoint < GRID_CELL_SIZE * 1.5) {
            ai.aiPathIndex++;
        }
        
        if (ai.aiPathIndex < ai.aiPath.length) {
            const nextWaypoint = ai.aiPath[ai.aiPathIndex];
            const targetAngle = Math.atan2(nextWaypoint.y - ai.y, nextWaypoint.x - ai.x);
            let angleDiff = targetAngle - ai.angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            turnDirection = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TANK_TURN_SPEED);
            isMoving = Math.abs(angleDiff) < Math.PI / 2; // Only move forward
        }
    } else {
        const targetAngle = Math.atan2(opponent.y - ai.y, opponent.x - ai.x);
        let angleDiff = targetAngle - ai.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        turnDirection = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TANK_TURN_SPEED);
        isMoving = false;
    }
    
    ai.angle += turnDirection;

    // --- Firing Logic ---
    const predictedPosForFiring = predictOpponentPosition(ai, opponent);
    const angleToOpponent = Math.atan2(predictedPosForFiring.y - ai.y, predictedPosForFiring.x - ai.x);
    let aimDiff = angleToOpponent - ai.angle;
    while (aimDiff > Math.PI) aimDiff -= 2 * Math.PI;
    while (aimDiff < -Math.PI) aimDiff += 2 * Math.PI;

    let currentCooldown = ai.powerUp.type === PowerUpType.RAPID_FIRE ? FIRE_COOLDOWN * 0.4 : FIRE_COOLDOWN;

    if (Math.abs(aimDiff) < 0.2 && isLineOfSightClear(ai, opponent) && Date.now() - ai.lastShotTime > currentCooldown) {
        fire(ai);
    }
    
    // --- Apply Movement ---
    const oldX = ai.x, oldY = ai.y;
    let currentSpeed = ai.powerUp.type === PowerUpType.SPEED_BOOST ? TANK_SPEED * 1.5 : TANK_SPEED;
    if (isMoving) {
        ai.x += Math.cos(ai.angle) * currentSpeed;
        if (isTankCollidingWithBarriers(ai)) ai.x = oldX;
        ai.y += Math.sin(ai.angle) * currentSpeed;
        if (isTankCollidingWithBarriers(ai)) ai.y = oldY;
    }

    ai.x = Math.max(ai.width / 2, Math.min(width - ai.width / 2, ai.x));
    ai.y = Math.max(ai.height / 2, Math.min(height - ai.height / 2, ai.y));
}


// --- Drawing ---
function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (gameState === GameState.MENU) {
        drawMenu();
        return;
    }

    drawBarriers();

    if (DEBUG_AI_PATH && numPlayers === 1) {
        drawNavGrid();
        drawAiPath(player2);
    }
    
    drawPowerUps();
    drawTank(player1);
    drawTank(player2);
    drawBullets();
    drawUI();

    if (gameState === GameState.GAME_OVER) {
        drawGameOver();
    }
}

function drawNavGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            if (navGrid[y][x].isWall) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
                ctx.fillRect(x * GRID_CELL_SIZE, y * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
            }
            ctx.strokeRect(x * GRID_CELL_SIZE, y * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
        }
    }
}

function drawAiPath(tank) {
    if (tank.aiPath.length > 0) {
        ctx.strokeStyle = tank.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(tank.x, tank.y);
        for (let i = tank.aiPathIndex; i < tank.aiPath.length; i++) {
            const point = tank.aiPath[i];
            ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();

        for (let i = tank.aiPathIndex; i < tank.aiPath.length; i++) {
            const point = tank.aiPath[i];
            ctx.fillStyle = i === tank.aiPathIndex ? '#00ffff' : tank.color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 1;
    }
}

function drawMenu() {
    const titleFontSize = Math.min(width, height) * 0.1;
    ctx.font = `${titleFontSize}px "Press Start 2P"`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('TANK', width / 2, height * 0.2);
    ctx.fillText('COMBAT', width / 2, height * 0.2 + titleFontSize * 1.2);

    const buttonFontSize = Math.min(width, height) * 0.05;
    ctx.font = `${buttonFontSize}px "Press Start 2P"`;
    
    const buttonWidth = width * 0.4;
    const buttonHeight = height * 0.1;
    const onePlayerY = height * 0.45;
    const twoPlayerY = height * 0.6;
    
    menuButtons.onePlayer = { x: width/2 - buttonWidth/2, y: onePlayerY, width: buttonWidth, height: buttonHeight };
    menuButtons.twoPlayer = { x: width/2 - buttonWidth/2, y: twoPlayerY, width: buttonWidth, height: buttonHeight };
    
    ctx.strokeStyle = P1_COLOR;
    ctx.strokeRect(menuButtons.onePlayer.x, menuButtons.onePlayer.y, buttonWidth, buttonHeight);
    ctx.fillStyle = '#fff';
    ctx.fillText('1 PLAYER', width / 2, onePlayerY + buttonHeight / 2 + buttonFontSize/2);
    
    ctx.strokeStyle = P2_COLOR;
    ctx.strokeRect(menuButtons.twoPlayer.x, menuButtons.twoPlayer.y, buttonWidth, buttonHeight);
    ctx.fillStyle = '#fff';
    ctx.fillText('2 PLAYER', width / 2, twoPlayerY + buttonHeight / 2 + buttonFontSize/2);

    if (!isTouchDevice) {
        const controlsFontSize = Math.min(width, height) * 0.02;
        ctx.font = `${controlsFontSize}px "Press Start 2P"`;
        ctx.fillStyle = P1_COLOR;
        ctx.fillText('P1: WASD to Move, F or Space to Fire', width / 2, height * 0.8);
        ctx.fillStyle = P2_COLOR;
        ctx.fillText('P2: Arrows to Move, Enter to Fire', width / 2, height * 0.8 + controlsFontSize * 1.5);
    }
}


function drawBarriers() {
    ctx.fillStyle = BARRIER_COLOR;
    barriers.forEach(b => {
        ctx.fillRect(b.x, b.y, b.width, b.height);
    });
}

function drawPowerUps() {
    const now = Date.now();
    powerUps.forEach(p => {
        const config = POWERUP_CONFIG[p.type];
        const lifeRatio = 1 - (now - p.spawnTime) / POWERUP_LIFESPAN;

        ctx.save();
        ctx.globalAlpha = lifeRatio;

        const pulse = Math.abs(Math.sin(now / 200));
        const glowRadius = POWERUP_RADIUS + pulse * 5;
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
        gradient.addColorStop(0, `${config.color}ff`);
        gradient.addColorStop(0.7, `${config.color}88`);
        gradient.addColorStop(1, `${config.color}00`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#111';
        ctx.font = `bold ${POWERUP_RADIUS * 1.2}px "Press Start 2P"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(config.letter, p.x, p.y + 2);

        ctx.restore();
    });
}

function drawTank(tank) {
    ctx.save();
    ctx.translate(tank.x, tank.y);

    if (tank.hasShield) {
        const now = Date.now();
        const pulse = Math.sin(now / 150) * 0.15 + 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.3 + pulse * 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, tank.height * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    ctx.rotate(tank.angle);
    ctx.fillStyle = tank.color;
    ctx.fillRect(-tank.height / 2, -tank.width / 2, tank.height, tank.width);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(-tank.recoil, -4, TURRET_LENGTH, 8);
    ctx.restore();
}

function drawBullets() {
    bullets.forEach(b => {
        b.trail.forEach((trailPoint, index) => {
            const trailProgress = index / b.trail.length;
            ctx.fillStyle = b.owner.color;
            ctx.globalAlpha = trailProgress * 0.6;
            ctx.beginPath();
            ctx.arc(trailPoint.x, trailPoint.y, BULLET_SIZE * trailProgress, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = b.owner.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_SIZE, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;
}

function drawUI() {
    const scoreFontSize = Math.min(width, height) * 0.05;
    ctx.font = `${scoreFontSize}px "Press Start 2P"`;
    ctx.textAlign = 'center';
    ctx.fillStyle = P1_COLOR;
    ctx.fillText(player1.score, width / 2 - 50, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText('-', width / 2, 50);
    ctx.fillStyle = P2_COLOR;
    ctx.fillText(player2.score, width / 2 + 50, 50);

    drawPowerUpStatus(player1);
    drawPowerUpStatus(player2);
    
    if (isTouchDevice) {
        drawJoystick(player1);
        drawFireButton(player1);
        if (numPlayers === 2) {
            drawJoystick(player2);
            drawFireButton(player2);
        }
    }
}

function drawPowerUpStatus(tank) {
    let icon = null, config = null, timer = 0;

    if (tank.powerUp.type) {
        config = POWERUP_CONFIG[tank.powerUp.type];
        icon = config.letter;
        timer = (tank.powerUp.endTime - Date.now()) / 1000;
    } else if (tank.hasShield) {
        config = POWERUP_CONFIG[PowerUpType.SHIELD];
        icon = config.letter;
    } else if (tank.nextShotPiercing) {
        config = POWERUP_CONFIG[PowerUpType.PIERCING_SHOT];
        icon = config.letter;
    }

    if (icon) {
        const isP1 = tank.color === P1_COLOR;
        const x = isP1 ? width / 2 - 120 : width / 2 + 120;
        const y = 50;
        const radius = Math.min(width, height) * 0.025;
        
        ctx.fillStyle = config.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#000';
        ctx.font = `bold ${radius}px "Press Start 2P"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, x, y + 2);
        
        if (timer > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = `${radius * 0.6}px "Press Start 2P"`;
            ctx.fillText(timer.toFixed(1), x, y + radius + 10);
        }
    }
}

function drawJoystick(tank) {
    const joy = tank.joystick;
    joy.baseX = tank.color === P1_COLOR ? width * 0.15 : width * 0.85;
    joy.baseY = height - JOYSTICK_RADIUS * 1.2;

    ctx.strokeStyle = tank.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(joy.baseX, joy.baseY, JOYSTICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    const knobX = joy.active ? joy.x : joy.baseX;
    const knobY = joy.active ? joy.y : joy.baseY;
    ctx.fillStyle = tank.color;
    ctx.beginPath();
    ctx.arc(knobX, knobY, JOYSTICK_KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
}

function drawFireButton(tank) {
    const button = tank.fireButton;
    button.x = tank.color === P1_COLOR ? width * 0.35 : width * 0.65;
    button.y = height - FIRE_BUTTON_RADIUS * 1.5;

    ctx.strokeStyle = tank.color;
    ctx.fillStyle = button.active ? tank.color : 'transparent';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(button.x, button.y, FIRE_BUTTON_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1.0;
}

function drawGameOver() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = winner.color;
    ctx.font = `${Math.min(width, height) * 0.08}px "Press Start 2P"`;
    ctx.textAlign = 'center';
    
    let winnerText;
    if (numPlayers === 1) {
        winnerText = winner === player1 ? 'You Win!' : 'You Lose!';
    } else {
        winnerText = winner === player1 ? 'Player 1 Wins!' : 'Player 2 Wins!';
    }
    ctx.fillText(winnerText, width / 2, height / 2 - 40);

    ctx.fillStyle = '#fff';
    ctx.font = `${Math.min(width, height) * 0.04}px "Press Start 2P"`;
    ctx.fillText('Tap or Click to Return to Menu', width / 2, height / 2 + 40);
}

// --- Input Handling ---
function getTouchTarget(touch) {
    const maxPlayers = numPlayers === 1 ? 1 : 2;
    const isLeft = touch.clientX < width / 2;
    const p = isLeft ? player1 : player2;

    if (numPlayers === 1 && !isLeft) return null;

    const distToJoy = Math.hypot(touch.clientX - p.joystick.baseX, touch.clientY - p.joystick.baseY);
    const distToFire = Math.hypot(touch.clientX - p.fireButton.x, touch.clientY - p.fireButton.y);

    if (distToJoy < JOYSTICK_RADIUS * 1.5) return { type: 'joystick', player: p };
    if (distToFire < FIRE_BUTTON_RADIUS * 1.5) return { type: 'fire', player: p };
    return null;
}

function handleTouchStart(e) {
    e.preventDefault();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (gameState === GameState.GAME_OVER) {
        init(true); // Return to menu
        return;
    }
    
    if (gameState === GameState.MENU) {
        const touch = e.changedTouches[0];
        const tx = touch.clientX;
        const ty = touch.clientY;
        if (tx > menuButtons.onePlayer.x && tx < menuButtons.onePlayer.x + menuButtons.onePlayer.width &&
            ty > menuButtons.onePlayer.y && ty < menuButtons.onePlayer.y + menuButtons.onePlayer.height) {
            startGame(1);
        } else if (tx > menuButtons.twoPlayer.x && tx < menuButtons.twoPlayer.x + menuButtons.twoPlayer.width &&
            ty > menuButtons.twoPlayer.y && ty < menuButtons.twoPlayer.y + menuButtons.twoPlayer.height) {
            startGame(2);
        }
        return;
    }

    // --- GameState.PLAYING ---
    for (const touch of e.changedTouches) {
        const target = getTouchTarget(touch);
        if (!target) continue;

        touches[touch.identifier] = target;
        if (target.type === 'joystick') {
            target.player.joystick.active = true;
            target.player.joystick.id = touch.identifier;
        } else if (target.type === 'fire') {
            target.player.fireButton.active = true;
            target.player.fireButton.id = touch.identifier;
        }
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (gameState !== GameState.PLAYING) return;

    for (const touch of e.changedTouches) {
        const target = touches[touch.identifier];
        if (!target || target.type !== 'joystick') continue;

        const joy = target.player.joystick;
        const dx = touch.clientX - joy.baseX;
        const dy = touch.clientY - joy.baseY;
        const dist = Math.hypot(dx, dy);

        if (dist > JOYSTICK_RADIUS) {
            joy.x = joy.baseX + (dx / dist) * JOYSTICK_RADIUS;
            joy.y = joy.baseY + (dy / dist) * JOYSTICK_RADIUS;
        } else {
            joy.x = touch.clientX;
            joy.y = touch.clientY;
        }
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    if (gameState !== GameState.PLAYING) return;

    for (const touch of e.changedTouches) {
        const target = touches[touch.identifier];
        if (!target) continue;

        if (target.type === 'joystick') {
            target.player.joystick.active = false;
            target.player.joystick.id = null;
        } else if (target.type === 'fire') {
            target.player.fireButton.active = false;
            target.player.fireButton.id = null;
        }
        delete touches[touch.identifier];
    }
}

function handleMenuOrGameOverClick(e) {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (gameState === GameState.GAME_OVER) {
        init(false); // Return to menu
        return;
    }
    
    if (gameState === GameState.MENU) {
        const tx = e.clientX;
        const ty = e.clientY;
        if (tx > menuButtons.onePlayer.x && tx < menuButtons.onePlayer.x + menuButtons.onePlayer.width &&
            ty > menuButtons.onePlayer.y && ty < menuButtons.onePlayer.y + menuButtons.onePlayer.height) {
            startGame(1);
        } else if (tx > menuButtons.twoPlayer.x && tx < menuButtons.twoPlayer.x + menuButtons.twoPlayer.width &&
            ty > menuButtons.twoPlayer.y && ty < menuButtons.twoPlayer.y + menuButtons.twoPlayer.height) {
            startGame(2);
        }
    }
}

function handleKeyDown(e) {
    if (gameState !== GameState.PLAYING) return;
    
    // Player 1
    if (e.key === 'w' || e.key === 'W') player1.keys.up = true;
    if (e.key === 's' || e.key === 'S') player1.keys.down = true;
    if (e.key === 'a' || e.key === 'A') player1.keys.left = true;
    if (e.key === 'd' || e.key === 'D') player1.keys.right = true;
    if (e.key === 'f' || e.key === 'F' || e.key === ' ') player1.keys.fire = true;

    // Player 2
    if (numPlayers === 2) {
        if (e.key === 'ArrowUp') player2.keys.up = true;
        if (e.key === 'ArrowDown') player2.keys.down = true;
        if (e.key === 'ArrowLeft') player2.keys.left = true;
        if (e.key === 'ArrowRight') player2.keys.right = true;
        if (e.key === 'Enter') player2.keys.fire = true;
    }
}

function handleKeyUp(e) {
    if (gameState !== GameState.PLAYING) return;
    
    // Player 1
    if (e.key === 'w' || e.key === 'W') player1.keys.up = false;
    if (e.key === 's' || e.key === 'S') player1.keys.down = false;
    if (e.key === 'a' || e.key === 'A') player1.keys.left = false;
    if (e.key === 'd' || e.key === 'D') player1.keys.right = false;
    if (e.key === 'f' || e.key === 'F' || e.key === ' ') player1.keys.fire = false;
    
    // Player 2
    if (numPlayers === 2) {
        if (e.key === 'ArrowUp') player2.keys.up = false;
        if (e.key === 'ArrowDown') player2.keys.down = false;
        if (e.key === 'ArrowLeft') player2.keys.left = false;
        if (e.key === 'ArrowRight') player2.keys.right = false;
        if (e.key === 'Enter') player2.keys.fire = false;
    }
}

// --- Game Loop ---
function gameLoop() {
    if (gameState === GameState.PLAYING) {
        update();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

// --- Initialization ---
const supportsTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

if (supportsTouch) {
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);
} else {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('click', handleMenuOrGameOverClick);
}

// Start game
init(supportsTouch);
gameLoop();