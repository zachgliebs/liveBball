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
        players: [],
        activePlayers: Array(5).fill(null),
        shotStats: {
            made: { two: 0, three: 0 },
            missed: { two: 0, three: 0 }
        },
        stats: {
            rebounds: 0,
            blocks: 0,
            steals: 0,
            turnovers: 0
        }
    },
    team2: {
        name: "Team 2",
        score: 0,
        players: [],
        activePlayers: Array(5).fill(null),
        shotStats: {
            made: { two: 0, three: 0 },
            missed: { two: 0, three: 0 }
        },
        stats: {
            rebounds: 0,
            blocks: 0,
            steals: 0,
            turnovers: 0
        }
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

app.post('/api/loadRoster', (req, res) => {
    const { team, players } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';
    
    // Reset team's players array and active players
    gameState[teamKey].players = players;
    gameState[teamKey].activePlayers = Array(5).fill(null);
    
    // Reset team's shot stats
    gameState[teamKey].shotStats = {
        made: { two: 0, three: 0 },
        missed: { two: 0, three: 0 }
    };
    
    // Reset team's score
    gameState[teamKey].score = 0;
    
    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/substitute', (req, res) => {
    const { team, playerNumber, action } = req.body;
    
    // Validate team has enough/not too many players
    const activeCount = gameState[team].activePlayers.filter(p => p !== null).length;
    
    if (action === 'in' && activeCount >= 5) {
        res.status(400).json({ error: 'Cannot have more than 5 players on the court' });
        return;
    }
    
    if (action === 'out' && activeCount <= 1) {
        res.status(400).json({ error: 'Must have at least one player on the court' });
        return;
    }
    
    if (action === 'in') {
        // Find first empty slot
        const emptyIndex = gameState[team].activePlayers.findIndex(p => p === null);
        if (emptyIndex !== -1) {
            gameState[team].activePlayers[emptyIndex] = playerNumber;
        }
    } else if (action === 'out') {
        // Remove player from active players
        const playerIndex = gameState[team].activePlayers.indexOf(playerNumber);
        if (playerIndex !== -1) {
            gameState[team].activePlayers[playerIndex] = null;
        }
    }
    
    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/recordRebound', (req, res) => {
    const { team, player } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Update team stats
    gameState[teamKey].stats.rebounds++;

    // Update player stats
    const playerIndex = gameState[teamKey].players.findIndex(p => p.number === player);
    if (playerIndex >= 0) {
        if (!gameState[teamKey].players[playerIndex].rebounds) {
            gameState[teamKey].players[playerIndex].rebounds = 0;
        }
        gameState[teamKey].players[playerIndex].rebounds++;
    }

    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/recordEvent', (req, res) => {
    const { eventType, team, player } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Update team stats
    gameState[teamKey].stats[eventType + 's']++;

    // Update player stats
    const playerIndex = gameState[teamKey].players.findIndex(p => p.number === player);
    if (playerIndex >= 0) {
        if (!gameState[teamKey].players[playerIndex][eventType + 's']) {
            gameState[teamKey].players[playerIndex][eventType + 's'] = 0;
        }
        gameState[teamKey].players[playerIndex][eventType + 's']++;
    }

    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/recordShot', (req, res) => {
    const { team, player, zone, points, made } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';
    const shotType = points === 3 ? 'three' : 'two';

    // Update shot statistics
    if (made) {
        gameState[teamKey].shotStats.made[shotType]++;
        gameState[teamKey].score += points;
    } else {
        gameState[teamKey].shotStats.missed[shotType]++;
    }

    // Update player statistics
    const playerIndex = gameState[teamKey].players.findIndex(p => p.number === player);
    if (playerIndex >= 0) {
        if (made) {
            gameState[teamKey].players[playerIndex].points += points;
        }
        gameState[teamKey].players[playerIndex].attempts++;
        if (made) gameState[teamKey].players[playerIndex].made++;
    }

    io.emit('scoreUpdate', gameState);
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