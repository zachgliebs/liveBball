const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const sheetsLogger = require('./sheetsLogger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Google Sheets configuration
const SPREADSHEET_ID = '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE';
const SHEET_NAME = 'EntryTesting';
const ENABLE_SHEETS_LOGGING = SPREADSHEET_ID !== null;

// Initialize Google Sheets logger if configured
if (ENABLE_SHEETS_LOGGING) {
    sheetsLogger.initializeSheetsClient().catch(err => {
        console.error('Failed to initialize Google Sheets:', err);
    });
}

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
            turnovers: 0,
            assists: 0
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
            turnovers: 0,
            assists: 0
        }
    },
    // Which team currently has possession ('home' | 'away' | null)
    possessionTeam: null,
    // Keep the last two players who touched the ball for each team after a
    // possession switch. Useful for assist-crediting logic.
    teamTouches: {
        team1: [],
        team2: []
    },
    // Track the most recent steal for fast break detection
    // { team: 'home'|'away', player: number, timestamp: ms }
    lastSteal: null,
    // Track if a rebound was just recorded (for second chance points detection)
    // { team: 'home'|'away', player: number, timestamp: ms }
    lastRebound: null,
    gameTime: "00:00",
    period: "1ST HALF",
    isGameRunning: true
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
    // Normalize players to include stat fields
    gameState[teamKey].players = players.map(p => ({
        number: p.number,
        name: p.name,
        points: p.points || 0,
        attempts: p.attempts || 0,
        made: p.made || 0,
        rebounds: p.rebounds || 0,
        steals: p.steals || 0,
        blocks: p.blocks || 0,
        turnovers: p.turnovers || 0,
        assists: p.assists || 0
    }));
    gameState[teamKey].activePlayers = Array(5).fill(null);
    
    // Reset team's shot stats
    gameState[teamKey].shotStats = {
        made: { two: 0, three: 0 },
        missed: { two: 0, three: 0 }
    };
    
    // Reset team's score
    gameState[teamKey].score = 0;

    // Reset team touches for both teams on roster load to avoid stale data
    gameState.teamTouches.team1 = [];
    gameState.teamTouches.team2 = [];
    gameState.possessionTeam = null;
    
    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/substitute', (req, res) => {
    const { team, playerNumber, action } = req.body;
    
    const activeCount = gameState[team].activePlayers.filter(p => p !== null).length;
    
    if (action === 'out' && activeCount <= 1) {
        res.status(400).json({ error: 'Must have at least one player on the court' });
        return;
    }
    
    if (action === 'in') {
        // Find first empty slot, or add to the end if all slots filled
        const emptyIndex = gameState[team].activePlayers.findIndex(p => p === null);
        if (emptyIndex !== -1) {
            gameState[team].activePlayers[emptyIndex] = playerNumber;
        } else {
            // Allow more than 5 players
            gameState[team].activePlayers.push(playerNumber);
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

app.post('/api/recordRebound', async (req, res) => {
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

    // Track rebounds for second chance points detection
    gameState.lastRebound = {
        team: team,
        player: player,
        timestamp: Date.now()
    };

    // If there was a recent missed shot by this same team, update that missed-shot row
    // instead of appending a separate rebound row so the sheet shows: shooter,event,rebounder,...
    if (ENABLE_SHEETS_LOGGING) {
        try {
            if (gameState.lastMissedShot && gameState.lastMissedShot.team === team && gameState.lastMissedShot.sheetRow) {
                // Build values to write into the missed-shot row
                const rowNum = gameState.lastMissedShot.sheetRow;
                const shooter = gameState.lastMissedShot.shooter || (team === 'home' ? `H${gameState.lastMissedShot.player}` : `A${gameState.lastMissedShot.player}`);
                const event = gameState.lastMissedShot.event || '';
                const rebounder = (team === 'home' ? 'H' : 'A') + player;
                const fastBreak = false;
                const secondChance = false;
                const paint = false;

                const rowValues = [shooter, event, rebounder, fastBreak, secondChance, paint];
                console.log(`Updating missed-shot row ${rowNum} with rebounder ${rebounder}:`, rowValues);
                await sheetsLogger.updateRow(SPREADSHEET_ID, SHEET_NAME, rowNum, rowValues);

                // Clear lastMissedShot since it's been handled
                gameState.lastMissedShot = null;
            } else {
                // No recent missed shot to update — do NOT append a standalone rebound row.
                // Rebounds are tracked in server state; we intentionally avoid creating
                // separate 'REB' rows in the sheet to keep the play-by-play tidy.
                console.log('Standalone rebound recorded server-side; not logged to sheet:', { team, player });
            }
        } catch (err) {
            console.error('Error handling rebound sheet update:', err);
        }
    }

    io.emit('gameState', gameState);
    res.json(gameState);
});

// Set the current ball handler. This updates possession and the last two
// players who touched the ball for the team in possession.
app.post('/api/setBallHandler', (req, res) => {
    const { team, player } = req.body; // team: 'home'|'away', player: number/string
    const teamKey = team === 'home' ? 'team1' : 'team2';
    const otherTeamKey = team === 'home' ? 'team2' : 'team1';

    // If possession switched, reset the touches for the new possession team.
    if (gameState.possessionTeam !== team) {
        gameState.possessionTeam = team;
        gameState.teamTouches[teamKey] = [];
    }

    // Push this player into the team's touch history (max 2)
    const touches = gameState.teamTouches[teamKey];
    // Avoid pushing consecutive duplicates
    if (touches.length === 0 || String(touches[touches.length - 1]) !== String(player)) {
        touches.push(player);
        if (touches.length > 2) touches.shift();
    }

    io.emit('playerUpdate', gameState);
    res.json(gameState);
});

// Record an assist for a player
app.post('/api/recordAssist', (req, res) => {
    const { team, player } = req.body; // team: 'home'|'away'
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Update team assists
    if (!gameState[teamKey].stats.assists) gameState[teamKey].stats.assists = 0;
    gameState[teamKey].stats.assists++;

    // Update player assists
    const playerIndex = gameState[teamKey].players.findIndex(p => p.number === player);
    if (playerIndex >= 0) {
        if (!gameState[teamKey].players[playerIndex].assists) gameState[teamKey].players[playerIndex].assists = 0;
        gameState[teamKey].players[playerIndex].assists++;
    }

    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/recordEvent', (req, res) => {
    const { eventType, team, player, isFastBreak } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Defensive: only accept known event types
    const validEvents = ['steal', 'block', 'turnover'];
    if (!validEvents.includes(eventType)) {
        return res.status(400).json({ error: 'Invalid event type' });
    }

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

    // Track steals for fast break detection
    if (eventType === 'steal') {
        gameState.lastSteal = {
            team: team,
            player: player,
            timestamp: Date.now()
        };
    }

    // Log to Google Sheets if enabled
    if (ENABLE_SHEETS_LOGGING) {
        const payload = {
            eventType: eventType,
            team: team,
            player: player,
            isFastBreak: isFastBreak || false
        };
        console.log('Logging event to Google Sheets:', payload);
        sheetsLogger.logEvent(SPREADSHEET_ID, SHEET_NAME, payload).catch(err => console.error('Failed to log event:', err));
    }

    io.emit('gameState', gameState);
    res.json(gameState);
});

app.post('/api/recordShot', async (req, res) => {
    const { team, player, zone, points, made, assist, assistTeam, isFastBreak, isSecondChance, isPaint } = req.body;
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

    // Log to Google Sheets if enabled
    if (ENABLE_SHEETS_LOGGING) {
        const payload = {
            team: team,
            player: player,
            points: points,
            made: made,
            assist: assist || null,
            assistTeam: assistTeam || null,
            isFastBreak: isFastBreak || false,
            isSecondChance: isSecondChance || false,
            isPaint: isPaint || false
        };
        console.log('Logging shot to Google Sheets:', payload);
        try {
            const result = await sheetsLogger.logShot(SPREADSHEET_ID, SHEET_NAME, payload);
            // If it was a missed shot, remember which sheet row was used so rebounds can update it
            if (!made && result && result.updatedRange) {
                const m = String(result.updatedRange).match(/!A(\d+):F\d+/);
                if (m && m[1]) {
                    const rowNum = parseInt(m[1], 10);
                    gameState.lastMissedShot = {
                        team: team,
                        player: player,
                        timestamp: Date.now(),
                        sheetRow: rowNum,
                        shooter: (team === 'home' ? `H${player}` : `A${player}`),
                        event: `${points === 2 ? '2NO' : '3NO'}`
                    };
                    console.log('Recorded lastMissedShot with sheetRow:', gameState.lastMissedShot);
                }
            }
        } catch (err) {
            console.error('Failed to log shot:', err);
        }
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

// Diagnostics endpoint: report last non-empty row in the sheet
app.get('/api/sheetDiagnostics', async (req, res) => {
    if (!ENABLE_SHEETS_LOGGING) return res.status(400).json({ error: 'Sheets logging not enabled' });
    try {
        const lastRow = await sheetsLogger.findLastNonEmptyRow(SPREADSHEET_ID, SHEET_NAME, 2000);
        res.json({ lastNonEmptyRow: lastRow });
    } catch (err) {
        console.error('sheetDiagnostics error:', err);
        res.status(500).json({ error: 'Diagnostics failed' });
    }
});

// Record a single free throw
app.post('/api/recordFreeThrow', (req, res) => {
    const { team, player, made, isSecondChance } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Update player and team stats
    if (made) {
        gameState[teamKey].score += 1;
        if (gameState[teamKey].shotStats && gameState[teamKey].shotStats.made) {
            // there's no separate free throw counters currently; you can add if desired
        }
    }

    const playerIndex = gameState[teamKey].players.findIndex(p => p.number === player);
    if (playerIndex >= 0) {
        if (made) {
            gameState[teamKey].players[playerIndex].points += 1;
        }
        gameState[teamKey].players[playerIndex].attempts++;
        if (made) gameState[teamKey].players[playerIndex].made++;
    }

    // Log to Google Sheets if enabled
    if (ENABLE_SHEETS_LOGGING) {
        const payload = { team, player, made: !!made };
        console.log('Logging free throw to Google Sheets:', payload);
        sheetsLogger.logFreeThrow(SPREADSHEET_ID, SHEET_NAME, payload).catch(err => console.error('Failed to log free throw:', err));
    }

    io.emit('scoreUpdate', gameState);
    res.json(gameState);
});