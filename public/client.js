const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
const scoreboard = document.getElementById('scoreboard');

let players = {};
let puck = { x: 300, y: 200, radius: 10 };
let localPlayerId = null;
let mousePos = { x: 0, y: 0 };
let isPlaying = false;
let score = { player1: 0, player2: 0 };

let canJolt = true; // Tracks if the player can jolt
let speedModifier = 1; // Modifies the player's speed (reduced after jolting)

// Input handling
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Track mouse position and send it to the server
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;

    if (isPlaying) {
        socket.emit('mouseMove', { x: mousePos.x, y: mousePos.y });
    }
});

// Handle mouse click for shooting or jolting
canvas.addEventListener('click', () => {
    const player = players[localPlayerId];

    if (player) {
        if (player.hasPuck) {
            // Shoot the puck
            const dx = mousePos.x - player.x;
            const dy = mousePos.y - player.y;
            const angle = Math.atan2(dy, dx);
            const speed = 7;
            const vx = speed * Math.cos(angle);
            const vy = speed * Math.sin(angle);

            socket.emit('shootPuck', { vx, vy });
        } else if (canJolt) {
            // Perform a jolt
            socket.emit('jolt', { mousePos });
            canJolt = false;

            // Start cooldown timer (1 second)
            setTimeout(() => {
                canJolt = true;
            }, 1000); // Changed from 3000 to 1000 milliseconds
        }
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

// Listen for game state updates from server
socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    if (!localPlayerId) {
        localPlayerId = socket.id;
    }
});

socket.on('newPlayer', (newPlayer) => {
    players[newPlayer.id] = {
        x: newPlayer.x,
        y: newPlayer.y,
        radius: newPlayer.radius,
        hasPuck: false
    };
});

socket.on('playerMoved', (playerData) => {
    if (players[playerData.id]) {
        players[playerData.id].x = playerData.x;
        players[playerData.id].y = playerData.y;
    }
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

// Update score and display it
socket.on('updateScore', (newScore) => {
    score = newScore;
    scoreboard.textContent = `Player 1: ${score.player1} | Player 2: ${score.player2}`;
});

socket.on('resetPositions', () => {
    alert("Positions reset. Game continues.");
});

// Listen for game win notification
socket.on('gameOver', (winner) => {
    alert(`${winner} won the game!`);
    location.reload(); // Reload the page to reset the game
});

// Listen for speed modification after jolting
socket.on('modifySpeed', (modifier) => {
    speedModifier = modifier;

    // Reset speed after 1.5 seconds
    setTimeout(() => {
        speedModifier = 1;
    }, 1500);
});

// Player movement logic with WASD controls
function handleMovement() {
    let dx = 0, dy = 0;

    const speed = 0.7 * speedModifier; // Reduced speed from 2 to 1

    if (keys['w']) dy = -speed;
    if (keys['s']) dy = speed;
    if (keys['a']) dx = -speed;
    if (keys['d']) dx = speed;

    if (dx || dy) {
        socket.emit('playerMovement', { dx, dy });
    }
}

// Draw loop
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw border
    ctx.strokeStyle = 'black';
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Draw goals
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 150, 10, 100);  // Left goal
    ctx.fillRect(590, 150, 10, 100); // Right goal

    // Draw players (always blue)
    for (let id in players) {
        const player = players[id];
        ctx.fillStyle = 'blue';
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
