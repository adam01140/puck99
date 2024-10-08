const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Constants
const PORT = process.env.PORT || 3000;
const GAME_WIDTH = 600;
const GAME_HEIGHT = 400;
const GOAL_WIDTH = 10;
const GOAL_HEIGHT = 100;
const FRAME_RATE = 1000 / 60; // 60 FPS

// Game State
let players = {};
let puck = { x: 300, y: 200, vx: 0, vy: 0, heldBy: null, radius: 10 };
let mousePos = {};
let playerCount = 0;
const MAX_PLAYERS = 2;
let score = { player1: 0, player2: 0 };

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Assign player numbers
function assignPlayerNumber() {
    if (playerCount === 1) return 'player1';
    if (playerCount === 2) return 'player2';
    return null;
}

// Calculate distance between two points
function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Handle scoring and resetting positions
function handleGoalScoring(playerNumber) {
    score[playerNumber]++;
    io.emit('updateScore', score);
    console.log(`Point for ${playerNumber.replace('player', 'Player ')}!`);
    resetPositions();
    checkWin();
}

// Reset positions after a goal
function resetPositions() {
    puck.x = 300;
    puck.y = 200;
    puck.vx = 0;
    puck.vy = 0;
    puck.heldBy = null;

    // Assign starting positions based on player number
    for (let id in players) {
        const player = players[id];
        if (player.number === 'player1') {
            player.x = 100;
            player.y = 200;
        } else if (player.number === 'player2') {
            player.x = 500;
            player.y = 200;
        }
        player.vx = 0;
        player.vy = 0;
        player.hasPuck = false;
        player.speedModifier = 1;
        player.canJolt = true;
    }

    io.emit('currentPlayers', players);
    io.emit('puckUpdate', puck);
}

// Check if someone has won the game
function checkWin() {
    if (score.player1 >= 10) {
        io.emit('gameOver', 'Player 1');
        resetGame();
    } else if (score.player2 >= 10) {
        io.emit('gameOver', 'Player 2');
        resetGame();
    }
}

// Reset the entire game after someone wins
function resetGame() {
    score.player1 = 0;
    score.player2 = 0;
    resetPositions();
    io.emit('updateScore', score);
}

// Handle scoring when the puck enters a goal
// Handle scoring when the puck enters a goal
function checkGoal() {
    // Left Goal (Player 2 scores)
    if (
        puck.x - puck.radius <= GOAL_WIDTH && // Adjusted to check if puck's left edge touches goal
        puck.y > (GAME_HEIGHT - GOAL_HEIGHT) / 2 &&
        puck.y < (GAME_HEIGHT + GOAL_HEIGHT) / 2
    ) {
        handleGoalScoring('player2');
    }
    // Right Goal (Player 1 scores)
    else if (
        puck.x + puck.radius >= GAME_WIDTH - GOAL_WIDTH && // Adjusted to check if puck's right edge touches goal
        puck.y > (GAME_HEIGHT - GOAL_HEIGHT) / 2 &&
        puck.y < (GAME_HEIGHT + GOAL_HEIGHT) / 2
    ) {
        handleGoalScoring('player1');
    }
}


// Handle puck stealing
function checkSteal(playerId) {
    const player = players[playerId];
    if (!player) return;

    if (
        puck.heldBy &&
        puck.heldBy !== player.number &&
        distance(player, puck) < player.radius + puck.radius
    ) {
        // Steal the puck
        const previousHolder = Object.values(players).find(p => p.number === puck.heldBy);
        if (previousHolder) {
            previousHolder.hasPuck = false;
        }
        puck.heldBy = player.number;
        player.hasPuck = true;
        io.to(player.socketId).emit('puckPossession', { hasPuck: true });
        console.log(`Player ${player.number.replace('player', '')} stole the puck!`);
    }
}

// Update puck position based on the player holding it
function updatePuckPosition(playerNumber) {
    const player = Object.values(players).find(p => p.number === playerNumber);
    if (player && player.hasPuck && mousePos[player.socketId]) {
        const dx = mousePos[player.socketId].x - player.x;
        const dy = mousePos[player.socketId].y - player.y;
        const angle = Math.atan2(dy, dx);
        const offset = player.radius + puck.radius + 5; // Slight offset to prevent overlap

        puck.x = player.x + Math.cos(angle) * offset;
        puck.y = player.y + Math.sin(angle) * offset;
    }
}

// Handle puck possession
function checkPuckPossession() {
    for (let id in players) {
        const player = players[id];
        if (!player.hasPuck && distance(player, puck) < player.radius + puck.radius) {
            puck.heldBy = player.number;
            player.hasPuck = true;

            io.to(id).emit('puckPossession', { hasPuck: true });
            console.log(`Player ${player.number.replace('player', '')} has possessed the puck.`);
        }
    }
}

// Handle a new player connection
io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // Handle joining the game
    socket.on('joinGame', () => {
        if (playerCount >= MAX_PLAYERS) {
            socket.emit('playerJoined', { success: false, message: 'Sorry, the lobby is full.' });
            console.log(`Player ${socket.id} attempted to join, but the lobby is full.`);
            return;
        }

        playerCount++;
        const playerNumber = assignPlayerNumber();
        const startX = playerNumber === 'player1' ? 100 : 500;

        players[socket.id] = {
            socketId: socket.id,
            id: socket.id,
            number: playerNumber, // 'player1' or 'player2'
            x: startX,
            y: 200,
            radius: 20,
            hasPuck: false,
            canJolt: true,
            speedModifier: 1,
            vx: 0,
            vy: 0
        };

        const message = `You are ${playerNumber.replace('player', 'Player ')}`;
        socket.emit('playerJoined', { success: true, message });
        socket.emit('currentPlayers', players);
        socket.emit('puckData', puck);
        io.emit('updateScore', score);
        socket.broadcast.emit('newPlayer', {
            socketId: socket.id,
            id: socket.id,
            number: playerNumber,
            x: startX,
            y: 200,
            radius: 20,
            hasPuck: false
        });

        console.log(`Player ${socket.id} joined as ${playerNumber.replace('player', 'Player ')}`);

        // Track mouse movement for each player
        socket.on('mouseMove', (position) => {
            mousePos[socket.id] = position;
        });

        // Handle player movement
        socket.on('playerMovement', (movementData) => {
            const player = players[socket.id];
            if (!player) return;

            const speed = 1 * player.speedModifier; // Base speed

            // Update velocity based on input
            player.vx += movementData.dx * speed;
            player.vy += movementData.dy * speed;
        });

        // Handle jolting
        socket.on('jolt', (data) => {
            const player = players[socket.id];
            if (!player || !player.canJolt || player.hasPuck) return;

            // Calculate direction based on mouse position
            let dx = data.mousePos.x - player.x;
            let dy = data.mousePos.y - player.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length > 0) {
                dx /= length;
                dy /= length;
            }

            // Apply jolt velocity
            const joltSpeed = 15; // Adjust for jolt intensity
            player.vx += dx * joltSpeed;
            player.vy += dy * joltSpeed;

            // Reduce speed temporarily
            player.speedModifier = 0.7;
            socket.emit('modifySpeed', player.speedModifier);

            // Reset speed after 1.5 seconds
            setTimeout(() => {
                player.speedModifier = 1;
                socket.emit('modifySpeed', player.speedModifier);
            }, 1500);

            // Start cooldown (1 second)
            player.canJolt = false;
            setTimeout(() => {
                player.canJolt = true;
            }, 1000);

            console.log(`Player ${player.number.replace('player', '')} performed a jolt.`);
        });

        // Handle shooting the puck
        socket.on('shootPuck', (direction) => {
            const player = players[socket.id];
            if (player && puck.heldBy === player.number) {
                puck.vx = direction.vx;
                puck.vy = direction.vy;
                puck.heldBy = null;
                player.hasPuck = false;

                socket.emit('puckPossession', { hasPuck: false });
                io.emit('puckShot', puck);
                console.log(`Player ${player.number.replace('player', '')} shot the puck.`);
            }
        });

        // Handle player disconnect
        socket.on('disconnect', () => {
            console.log('Player disconnected:', socket.id);
            playerCount--;
            const disconnectedPlayer = players[socket.id];
            if (disconnectedPlayer) {
                if (puck.heldBy === disconnectedPlayer.number) {
                    puck.heldBy = null;
                }
                delete players[socket.id];
                io.emit('playerDisconnected', socket.id);
            }
        });
    });
});

// Game update loop
setInterval(() => {
    // Update puck position
    if (!puck.heldBy) {
        puck.x += puck.vx;
        puck.y += puck.vy;

        // Apply friction to puck
        puck.vx *= 0.99;
        puck.vy *= 0.99;

        // Bounce off walls
        if (puck.x < puck.radius || puck.x > GAME_WIDTH - puck.radius) {
            puck.vx = -puck.vx;
            puck.x = clamp(puck.x, puck.radius, GAME_WIDTH - puck.radius);
        }
        if (puck.y < puck.radius || puck.y > GAME_HEIGHT - puck.radius) {
            puck.vy = -puck.vy;
            puck.y = clamp(puck.y, puck.radius, GAME_HEIGHT - puck.radius);
        }

        checkPuckPossession();
        checkGoal();
    } else {
        updatePuckPosition(puck.heldBy);
    }

    // Update players
    for (let id in players) {
        const player = players[id];

        // Update position based on velocity
        player.x += player.vx;
        player.y += player.vy;

        // Apply friction to player velocity
        player.vx *= 0.9;
        player.vy *= 0.9;

        // Clamp positions within game area
        player.x = clamp(player.x, player.radius, GAME_WIDTH - player.radius);
        player.y = clamp(player.y, player.radius, GAME_HEIGHT - player.radius);

        // Check for collision with other players
        for (let otherId in players) {
            if (otherId === id) continue;

            const otherPlayer = players[otherId];
            const dx = player.x - otherPlayer.x;
            const dy = player.y - otherPlayer.y;
            const distanceBetweenPlayers = distance(player, otherPlayer);
            const minDistance = player.radius + otherPlayer.radius;

            if (distanceBetweenPlayers < minDistance) {
                // Collision detected, resolve it
                const overlap = (minDistance - distanceBetweenPlayers) / 2;
                const nx = dx / distanceBetweenPlayers;
                const ny = dy / distanceBetweenPlayers;

                // Adjust positions to resolve overlap
                player.x += nx * overlap;
                player.y += ny * overlap;
                otherPlayer.x -= nx * overlap;
                otherPlayer.y -= ny * overlap;

                // Adjust velocities for simple collision response
                const combinedMass = 2; // Assuming equal mass
                const collisionDamping = 0.5;

                const vxTotal = player.vx - otherPlayer.vx;
                const vyTotal = player.vy - otherPlayer.vy;

                player.vx -= collisionDamping * vxTotal / combinedMass;
                player.vy -= collisionDamping * vyTotal / combinedMass;

                otherPlayer.vx += collisionDamping * vxTotal / combinedMass;
                otherPlayer.vy += collisionDamping * vyTotal / combinedMass;

                // Emit updated positions and velocities
                io.emit('playerMoved', { id: id, x: player.x, y: player.y });
                io.emit('playerMoved', { id: otherId, x: otherPlayer.x, y: otherPlayer.y });
            }
        }

        // Emit updated player position
        io.emit('playerMoved', { id: id, x: player.x, y: player.y });

        // Check for puck steal
        checkSteal(id);
    }

    // Emit updated puck position
    io.emit('puckUpdate', puck);

}, FRAME_RATE);

// Helper Functions

// Clamp a value between min and max
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});