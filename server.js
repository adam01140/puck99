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
        players[socket.id] = { x: startX, y: 200, radius: 20, hasPuck: false };

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

            let newX = player.x + movementData.dx;
            let newY = player.y + movementData.dy;

            let collision = false;
            for (let id in players) {
                if (id !== socket.id) {
                    const otherPlayer = players[id];
                    const distanceBetweenPlayers = distance({ x: newX, y: newY }, otherPlayer);
                    if (distanceBetweenPlayers < player.radius + otherPlayer.radius) {
                        collision = true;
                        break;
                    }
                }
            }

            if (!collision) {
                player.x = newX;
                player.y = newY;
            }

            io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y });
            updatePuckPosition(socket.id);
            checkGoal();
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

// Update puck position and check for goals
setInterval(() => {
    if (!puck.heldBy) {
        puck.x += puck.vx;
        puck.y += puck.vy;

        if (puck.x < puck.radius || puck.x > 600 - puck.radius) puck.vx = -puck.vx;
        if (puck.y < puck.radius || puck.y > 400 - puck.radius) puck.vy = -puck.vy;

        checkPuckPossession();
        checkGoal();
    } else {
        updatePuckPosition(puck.heldBy);
    }

    io.emit('puckUpdate', puck);
}, 1000 / 60);

// Check if the puck (or player carrying it) goes into a goal
function checkGoal() {
    for (let id in players) {
        const player = players[id];
        if (puck.heldBy === id && puck.x < 10 && puck.y > 150 && puck.y < 250) {  // Left goal (Player 2 scores)
            score.player2++;
            alertPoint("Point for player 2");
            resetPositions();
            checkWin();
        } else if (puck.heldBy === id && puck.x > 590 && puck.y > 150 && puck.y < 250) {  // Right goal (Player 1 scores)
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
