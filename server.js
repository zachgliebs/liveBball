const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game state
let gameState = {
    team1: {
        name: "Team 1",
        score: 0,
        players: []
    },
    team2: {
        name: "Team 2",
        score: 0,
        players: []
    },
    gameTime: "00:00",
    period: "1ST HALF",
    isGameRunning: false
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'v1.html'));
});

// API endpoints
app.get('/api/gameState', (req, res) => {
    res.json(gameState);
});

app.post('/api/updateScore', (req, res) => {
    const { team, points } = req.body;
    if (team === 1) {
        gameState.team1.score += points;
    } else if (team === 2) {
        gameState.team2.score += points;
    }
    io.emit('scoreUpdate', gameState);
    res.json(gameState);
});

app.post('/api/updateTime', (req, res) => {
    const { time, period } = req.body;
    gameState.gameTime = time;
    if (period) gameState.period = period;
    io.emit('timeUpdate', gameState);
    res.json(gameState);
});

app.post('/api/updatePlayer', (req, res) => {
    const { team, playerData } = req.body;
    if (team === 1) {
        const playerIndex = gameState.team1.players.findIndex(p => p.number === playerData.number);
        if (playerIndex >= 0) {
            gameState.team1.players[playerIndex] = playerData;
        } else {
            gameState.team1.players.push(playerData);
        }
    } else if (team === 2) {
        const playerIndex = gameState.team2.players.findIndex(p => p.number === playerData.number);
        if (playerIndex >= 0) {
            gameState.team2.players[playerIndex] = playerData;
        } else {
            gameState.team2.players.push(playerData);
        }
    }
    io.emit('playerUpdate', gameState);
    res.json(gameState);
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected');
    socket.emit('gameState', gameState);

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});