const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

let players = {};
let puck = { x: 300, y: 200, vx: 0, vy: 0, heldBy: null, radius: 10 };
let mousePos = {}; // Track mouse positions per player

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);
    
    // Add new player to the game
    players[socket.id] = { x: 100, y: 100, radius: 20, hasPuck: false };

    // Send current game state to new player
    socket.emit('currentPlayers', players);
    socket.emit('puckData', puck);

    // Notify other players about the new player
    socket.broadcast.emit('newPlayer', { id: socket.id, x: 100, y: 100, radius: 20 });

    // Track mouse movement for each player
    socket.on('mouseMove', (position) => {
        mousePos[socket.id] = position;
    });

    // Move player on input
    socket.on('playerMovement', (movementData) => {
        const player = players[socket.id];

        // Temporary move coordinates
        let newX = player.x + movementData.dx;
        let newY = player.y + movementData.dy;

        // Check for player collisions
        let collision = false;
        for (let id in players) {
            if (id !== socket.id) {
                const otherPlayer = players[id];
                const distanceBetweenPlayers = distance({ x: newX, y: newY }, otherPlayer);
                if (distanceBetweenPlayers < player.radius + otherPlayer.radius) {
                    collision = true; // Collision detected, stop movement
                    break;
                }
            }
        }

        // Only move if no collision
        if (!collision) {
            player.x = newX;
            player.y = newY;
        }

        // If the player is holding the puck, calculate the bulging position
        if (puck.heldBy === socket.id) {
            const dx = mousePos[socket.id].x - player.x;
            const dy = mousePos[socket.id].y - player.y;
            const angle = Math.atan2(dy, dx);
            const offset = 25;

            puck.x = player.x + Math.cos(angle) * offset;
            puck.y = player.y + Math.sin(angle) * offset;
        }

        // Check if the puck is free or if another player touches the puck while it's bulging out (for stealing)
        if (puck.heldBy !== socket.id && distance(player, puck) < player.radius + puck.radius) {
            puck.heldBy = socket.id; // Player steals the puck
            player.hasPuck = true;

            // Notify the original holder they lost the puck
            for (let id in players) {
                if (players[id].hasPuck && id !== socket.id) {
                    players[id].hasPuck = false;
                    io.to(id).emit('puckPossession', { hasPuck: false });
                }
            }

            // Notify the new holder they now have the puck
            socket.emit('puckPossession', { hasPuck: true });
        }

        io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y });
        io.emit('puckUpdate', puck); // Ensure puck updates for all players
    });

    // Player shoots the puck
    socket.on('shootPuck', (direction) => {
        if (puck.heldBy === socket.id) {
            puck.vx = direction.vx;
            puck.vy = direction.vy;
            puck.heldBy = null; // Player no longer holds the puck
            players[socket.id].hasPuck = false;

            // Notify the player that they no longer have the puck
            socket.emit('puckPossession', { hasPuck: false });

            console.log(`Player ${socket.id} shot the puck!`);  // Debugging log
            io.emit('puckShot', puck);
        }
    });

    // Remove player when disconnected
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        if (puck.heldBy === socket.id) puck.heldBy = null; // If the player was holding the puck, release it
        io.emit('playerDisconnected', socket.id);
    });
});

// Update puck position and broadcast to players
setInterval(() => {
    if (!puck.heldBy) {
        puck.x += puck.vx;
        puck.y += puck.vy;

        // Simple boundary check
        if (puck.x < puck.radius || puck.x > 600 - puck.radius) puck.vx = -puck.vx;
        if (puck.y < puck.radius || puck.y > 400 - puck.radius) puck.vy = -puck.vy;

        io.emit('puckUpdate', puck);
    }
}, 1000 / 60);

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
