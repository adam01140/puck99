const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
let players = {};
let puck = { x: 300, y: 200, radius: 10 };
let localPlayerId = null;
let mousePos = { x: 0, y: 0 };
let isPlaying = false;

// Input handling
const keys = {};
document.addEventListener('keydown', (e) => { keys[e.key] = true; });
document.addEventListener('keyup', (e) => { keys[e.key] = false; });

// Track mouse position and send it to the server
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;

    if (isPlaying) {
        socket.emit('mouseMove', { x: mousePos.x, y: mousePos.y });
    }
});

// Shoot the puck when the player clicks
canvas.addEventListener('click', () => {
    const player = players[localPlayerId];

    if (player && player.hasPuck) {
        const dx = mousePos.x - player.x;
        const dy = mousePos.y - player.y;
        const angle = Math.atan2(dy, dx);
        const speed = 7;
        const vx = speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);

        socket.emit('shootPuck', { vx, vy });
    }
});

// Handle play button click
playButton.addEventListener('click', () => {
    socket.emit('joinGame');
});

// Handle game join confirmation
socket.on('playerJoined', (data) => {
    if (data.success) {
        localPlayerId = socket.id;
        playButton.style.display = 'none';
        canvas.style.display = 'block';
        alert(data.message);
        isPlaying = true;
    } else {
        alert(data.message);
    }
});

// Listen for puck possession updates from the server
socket.on('puckPossession', (data) => {
    const player = players[localPlayerId];
    if (player) {
        player.hasPuck = data.hasPuck;
    }
});

// Player movement logic
function handleMovement() {
    let dx = 0, dy = 0;

    if (keys['ArrowUp']) dy = -2;
    if (keys['ArrowDown']) dy = 2;
    if (keys['ArrowLeft']) dx = -2;
    if (keys['ArrowRight']) dx = 2;

    if (dx || dy) {
        socket.emit('playerMovement', { dx, dy });
    }
}

// Listen for game state updates from server
socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    if (!localPlayerId) {
        localPlayerId = socket.id;
    }
});

socket.on('newPlayer', (newPlayer) => {
    players[newPlayer.id] = { x: newPlayer.x, y: newPlayer.y, radius: newPlayer.radius, hasPuck: false };
});

socket.on('playerMoved', (playerData) => {
    players[playerData.id].x = playerData.x;
    players[playerData.id].y = playerData.y;
});

socket.on('playerDisconnected', (playerId) => {
    delete players[playerId];
});

socket.on('puckData', (serverPuck) => {
    puck = serverPuck;
});

socket.on('puckShot', (serverPuck) => {
    puck = serverPuck;
});

socket.on('puckUpdate', (updatedPuck) => {
    puck = updatedPuck;
});

// Draw loop
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw players
    for (let id in players) {
        const player = players[id];
        ctx.fillStyle = player.hasPuck ? 'green' : 'blue';
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Draw puck
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, puck.radius, 0, 2 * Math.PI);
    ctx.fill();
}

function gameLoop() {
    if (isPlaying) {
        handleMovement();
        draw();
    }
    requestAnimationFrame(gameLoop);
}

gameLoop();
