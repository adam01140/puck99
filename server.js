const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

let players = {};
let puck = { x: 300, y: 200, vx: 0, vy: 0, heldBy: null, radius: 10 };
let mousePos = {};
let playerCount = 0;
const MAX_PLAYERS = 2;
let score = { player1: 0, player2: 0 };

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // Handle joining the game
    socket.on('joinGame', () => {
        if (playerCount >= MAX_PLAYERS) {
            socket.emit('playerJoined', { success: false, message: 'Sorry lobby is full' });
            return;
        }

        playerCount++;
        let startX = playerCount === 1 ? 100 : 500;
        players[socket.id] = {
            x: startX,
            y: 200,
            radius: 20,
            hasPuck: false,
            canJolt: true, // Tracks if the player can jolt
            speedModifier: 1, // Modifies the player's speed (reduced after jolting)
            vx: 0, // Velocity in x-direction
            vy: 0  // Velocity in y-direction
        };

        const message = `You are player ${playerCount}`;
        socket.emit('playerJoined', { success: true, message });
        socket.emit('currentPlayers', players);
        socket.emit('puckData', puck);
        io.emit('updateScore', score);
        socket.broadcast.emit('newPlayer', { id: socket.id, x: startX, y: 200, radius: 20 });

        // Track mouse movement for each player
        socket.on('mouseMove', (position) => {
            mousePos[socket.id] = position;
        });

        // Handle player movement
        socket.on('playerMovement', (movementData) => {
            const player = players[socket.id];

            const speed = 0.7 * player.speedModifier; // Reduced speed from 2 to 1
            let dx = movementData.dx * speed;
            let dy = movementData.dy * speed;

            player.vx += dx;
            player.vy += dy;
        });

        // Handle jolting
        socket.on('jolt', (data) => {
            const player = players[socket.id];

            if (player.canJolt && !player.hasPuck) {
                // Calculate movement direction
                let dx = 0;
                let dy = 0;

                if (data.mousePos) {
                    dx = data.mousePos.x - player.x;
                    dy = data.mousePos.y - player.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    if (length > 0) {
                        dx /= length;
                        dy /= length;
                    }
                }

                // Jolt speed
                const joltSpeed = 15; // Adjust as needed
                player.vx += dx * joltSpeed;
                player.vy += dy * joltSpeed;

                // Reduce speed temporarily
                player.speedModifier = 0.7;
                socket.emit('modifySpeed', player.speedModifier);

                // Reset speed after 1.5 seconds
                setTimeout(() => {
                    player.speedModifier = 1;
                    socket.emit('modifySpeed', player.speedModifier);
                }, 1500); // Reduced speed duration

                // Start cooldown
                player.canJolt = false;
                setTimeout(() => {
                    player.canJolt = true;
                }, 1000); // Changed from 3000 to 1000 milliseconds
            }
        });

        // Handle shooting the puck
        socket.on('shootPuck', (direction) => {
            if (puck.heldBy === socket.id) {
                puck.vx = direction.vx;
                puck.vy = direction.vy;
                puck.heldBy = null;
                players[socket.id].hasPuck = false;

                socket.emit('puckPossession', { hasPuck: false });
                io.emit('puckShot', puck);
            }
        });

        // Handle player disconnect
        socket.on('disconnect', () => {
            console.log('Player disconnected:', socket.id);
            playerCount--;
            delete players[socket.id];
            if (puck.heldBy === socket.id) puck.heldBy = null;
            io.emit('playerDisconnected', socket.id);
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
        if (puck.x < puck.radius || puck.x > 600 - puck.radius) puck.vx = -puck.vx;
        if (puck.y < puck.radius || puck.y > 400 - puck.radius) puck.vy = -puck.vy;

        checkPuckPossession();
        checkGoal();
    } else {
        updatePuckPosition(puck.heldBy);
    }

    // Update players
    for (let id in players) {
        const player = players[id];

        // Update position
        player.x += player.vx;
        player.y += player.vy;

        // Apply friction to player velocity
        player.vx *= 0.9;
        player.vy *= 0.9;

        // Clamp positions within game area
        const GAME_WIDTH = 600;
        const GAME_HEIGHT = 400;

        function clamp(value, min, max) {
            return Math.max(min, Math.min(max, value));
        }

        player.x = clamp(player.x, player.radius, GAME_WIDTH - player.radius);
        player.y = clamp(player.y, player.radius, GAME_HEIGHT - player.radius);

        // Check for collision with other players
        for (let otherId in players) {
            if (otherId !== id) {
                const otherPlayer = players[otherId];
                const dx = player.x - otherPlayer.x;
                const dy = player.y - otherPlayer.y;
                const distanceBetweenPlayers = Math.sqrt(dx * dx + dy * dy);
                const minDistance = player.radius + otherPlayer.radius;

                if (distanceBetweenPlayers < minDistance) {
                    // Collision detected, resolve it
                    const overlap = (minDistance - distanceBetweenPlayers) / 2;

                    // Normalize the displacement vector
                    const nx = dx / distanceBetweenPlayers;
                    const ny = dy / distanceBetweenPlayers;

                    // Adjust positions
                    player.x += nx * overlap;
                    player.y += ny * overlap;
                    otherPlayer.x -= nx * overlap;
                    otherPlayer.y -= ny * overlap;

                    // Adjust velocities (simple collision response)
                    const combinedMass = 2; // Assuming equal mass
                    const collisionDamping = 0.5;

                    const vxTotal = player.vx - otherPlayer.vx;
                    const vyTotal = player.vy - otherPlayer.vy;

                    player.vx -= collisionDamping * vxTotal / combinedMass;
                    player.vy -= collisionDamping * vyTotal / combinedMass;

                    otherPlayer.vx += collisionDamping * vxTotal / combinedMass;
                    otherPlayer.vy += collisionDamping * vyTotal / combinedMass;
                }
            }
        }

        io.emit('playerMoved', { id: id, x: player.x, y: player.y });
    }

    io.emit('puckUpdate', puck);

}, 1000 / 60);

// Check if the puck (or player carrying it) goes into a goal
function checkGoal() {
    for (let id in players) {
        const player = players[id];
        if (puck.heldBy === id && puck.x < 10 && puck.y > 150 && puck.y < 250) { // Left goal (Player 2 scores)
            score.player2++;
            alertPoint("Point for player 2");
            resetPositions();
            checkWin();
        } else if (puck.heldBy === id && puck.x > 590 && puck.y > 150 && puck.y < 250) { // Right goal (Player 1 scores)
            score.player1++;
            alertPoint("Point for player 1");
            resetPositions();
            checkWin();
        }
    }
}

// Alert point and reset positions
function alertPoint(message) {
    io.emit('updateScore', score);
    io.emit('resetPositions');
    console.log(message);
}

// Reset positions after a goal
function resetPositions() {
    puck.x = 300;
    puck.y = 200;
    puck.vx = 0;
    puck.vy = 0;
    for (let id in players) {
        if (players[id]) {
            players[id].x = id === Object.keys(players)[0] ? 100 : 500;
            players[id].y = 200;
            players[id].vx = 0;
            players[id].vy = 0;
        }
    }
    io.emit('puckUpdate', puck);
    io.emit('currentPlayers', players);
}

// Check if someone won
function checkWin() {
    if (score.player1 >= 10) {
        io.emit('gameOver', 'Player 1');
    } else if (score.player2 >= 10) {
        io.emit('gameOver', 'Player 2');
    }
}

// Check for a puck steal if the non-possession player touches the puck
function checkSteal(playerId) {
    const player = players[playerId];
    if (puck.heldBy && puck.heldBy !== playerId && distance(player, puck) < player.radius + puck.radius) {
        // Steal the puck
        players[puck.heldBy].hasPuck = false;
        puck.heldBy = playerId;
        player.hasPuck = true;
        io.to(playerId).emit('puckPossession', { hasPuck: true });
        console.log(`Player ${playerId} stole the puck!`);
    }
}

// Update puck position for the player holding it
function updatePuckPosition(playerId) {
    const player = players[playerId];
    if (player && player.hasPuck && mousePos[playerId]) {
        const dx = mousePos[playerId].x - player.x;
        const dy = mousePos[playerId].y - player.y;
        const angle = Math.atan2(dy, dx);
        const offset = 25;

        puck.x = player.x + Math.cos(angle) * offset;
        puck.y = player.y + Math.sin(angle) * offset;
    }
}

// Check if a player touches the puck
function checkPuckPossession() {
    for (let id in players) {
        const player = players[id];
        if (!player.hasPuck && distance(player, puck) < player.radius + puck.radius) {
            puck.heldBy = id;
            player.hasPuck = true;

            io.to(id).emit('puckPossession', { hasPuck: true });
        }
    }
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
