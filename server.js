const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const sheetsLogger = require('./sheetsLogger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// File paths and admin config
const USERS_FILE = path.join(__dirname, 'users.json');
const ROSTERS_FILE = path.join(__dirname, 'rosters.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'BlueGreenBullshit'; // Change in production

// Google Sheets configuration
const SPREADSHEET_ID = '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE';
const SHEET_NAME = 'Entry';
const ENABLE_SHEETS_LOGGING = SPREADSHEET_ID !== null;

// Initialize Google Sheets logger if configured
if (ENABLE_SHEETS_LOGGING) {
    sheetsLogger.initializeSheetsClient().catch(err => {
        console.error('Failed to initialize Google Sheets:', err);
    });
}

function createEmptyTeam(defaultName) {
    return {
        name: defaultName,
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
    };
}

function createInitialGameState() {
    return {
        team1: createEmptyTeam("Team 1"),
        team2: createEmptyTeam("Team 2"),
        possessionTeam: null,
        teamTouches: {
            team1: [],
            team2: []
        },
        lastSteal: null,
        lastRebound: null,
        lastMissedShot: null,
        gameTime: "00:00",
        period: "1ST HALF",
        isGameRunning: true,
        setTeamRoster: function(teamKey, players) {
            // Normalize players to include stat fields
            this[teamKey].players = (players || []).map(p => ({
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
            this[teamKey].activePlayers = Array(5).fill(null);
            this[teamKey].shotStats = {
                made: { two: 0, three: 0 },
                missed: { two: 0, three: 0 }
            };
            this[teamKey].score = 0;
        }
    };
}

// Game state
let gameState = createInitialGameState();

// Bootstrap saved rosters on server start (if present)
const savedRosters = loadRosters();
if (savedRosters.home) {
    gameState.setTeamRoster('team1', savedRosters.home.players || savedRosters.home);
    if (savedRosters.home.name) gameState.team1.name = savedRosters.home.name;
    console.log('Loaded saved home roster');
}
if (savedRosters.away) {
    gameState.setTeamRoster('team2', savedRosters.away.players || savedRosters.away);
    if (savedRosters.away.name) gameState.team2.name = savedRosters.away.name;
    console.log('Loaded saved away roster');
}

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Protected route must come BEFORE static files
app.get('/v1.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'v1.html'));
});

// Now serve static files
app.use(express.static(__dirname));

function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading users file:', err);
        return { users: [] };
    }
}

function saveUsers(data) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing users file:', err);
        return false;
    }
}

function loadRosters() {
    try {
        if (!fs.existsSync(ROSTERS_FILE)) return { home: null, away: null };
        const data = fs.readFileSync(ROSTERS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return {
            home: parsed.home || null,
            away: parsed.away || null
        };
    } catch (err) {
        console.error('Error reading rosters file:', err);
        return { home: null, away: null };
    }
}

function saveRosters(rosters) {
    try {
        fs.writeFileSync(ROSTERS_FILE, JSON.stringify(rosters, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing rosters file:', err);
        return false;
    }
}

// Simple token-based auth (in production, use proper JWT)
function generateToken(username) {
    return Buffer.from(username + ':' + Date.now()).toString('base64');
}

function verifyToken(token) {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [username] = decoded.split(':');
        return username;
    } catch (err) {
        return null;
    }
}

// Authentication middleware to check for valid token
function checkAuth(req, res, next) {
    const token = req.cookies.authToken || req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
    
    if (!token) {
        return res.redirect('/');
    }

    const username = verifyToken(token);
    if (!username) {
        res.clearCookie('authToken');
        return res.redirect('/');
    }

    req.user = { username };
    next();
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/addnewuser', (req, res) => {
    res.sendFile(path.join(__dirname, 'addnewuser.html'));
});

// Authentication endpoints
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }

    const usersData = loadUsers();
    const user = usersData.users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = generateToken(username);
    res.cookie('authToken', token, { 
        httpOnly: true, 
        secure: false, // Set to true if using HTTPS
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.json({ message: 'Login successful', token });
});

app.post('/api/register', (req, res) => {
    const { username, password, adminKey } = req.body;

    if (adminKey !== ADMIN_KEY) {
        return res.status(403).json({ message: 'Invalid admin key' });
    }

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }

    const usersData = loadUsers();
    
    if (usersData.users.some(u => u.username === username)) {
        return res.status(409).json({ message: 'Username already exists' });
    }

    usersData.users.push({ username, password });
    
    if (saveUsers(usersData)) {
        res.json({ message: 'User added successfully' });
    } else {
        res.status(500).json({ message: 'Failed to save user' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('authToken');
    res.json({ message: 'Logged out successfully' });
});

// API endpoints
app.get('/api/gameState', (req, res) => {
    res.json(gameState);
});

app.post('/api/loadRoster', (req, res) => {
    const { team, players, teamName } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    gameState.setTeamRoster(teamKey, players);
    if (teamName) gameState[teamKey].name = teamName;

    // Reset team touches for both teams on roster load to avoid stale data
    gameState.teamTouches.team1 = [];
    gameState.teamTouches.team2 = [];
    gameState.possessionTeam = null;

    // Persist roster to disk
    const existing = loadRosters();
    existing[team] = { name: teamName || gameState[teamKey].name, players };
    saveRosters(existing);

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
                const placeholder = '';
                const paint = false;

                const rowValues = [shooter, event, rebounder, fastBreak, secondChance, placeholder, paint];
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
    const { eventType, team, player, isFastBreak, turnoverTeam, turnoverPlayer, stealByTeam, stealByPlayer } = req.body;
    const teamKey = team === 'home' ? 'team1' : 'team2';

    // Defensive: only accept known event types
    const validEvents = ['steal', 'block', 'turnover'];
    if (!validEvents.includes(eventType)) {
        return res.status(400).json({ error: 'Invalid event type' });
    }

    // Update team/player stats (steals are credited to stealByTeam/player)
    let statsTeamKey = teamKey;
    let statsPlayer = player;
    if (eventType === 'steal') {
        statsTeamKey = stealByTeam ? (stealByTeam === 'home' ? 'team1' : 'team2') : teamKey;
        statsPlayer = stealByPlayer || player;
    }

    gameState[statsTeamKey].stats[eventType + 's']++;

    const statsPlayerIndex = gameState[statsTeamKey].players.findIndex(p => p.number === statsPlayer);
    if (statsPlayerIndex >= 0) {
        if (!gameState[statsTeamKey].players[statsPlayerIndex][eventType + 's']) {
            gameState[statsTeamKey].players[statsPlayerIndex][eventType + 's'] = 0;
        }
        gameState[statsTeamKey].players[statsPlayerIndex][eventType + 's']++;
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
            isFastBreak: isFastBreak || false,
            turnoverTeam: turnoverTeam || null,
            turnoverPlayer: turnoverPlayer || null,
            stealByTeam: stealByTeam || null,
            stealByPlayer: stealByPlayer || null
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
                const m = String(result.updatedRange).match(/!A(\d+):G\d+/);
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

app.post('/api/resetGame', async (req, res) => {
    let sheetCleared = false;
    let sheetError = null;

    if (ENABLE_SHEETS_LOGGING) {
        try {
            sheetCleared = await sheetsLogger.clearSheetData(SPREADSHEET_ID, SHEET_NAME);
            if (!sheetCleared) {
                sheetError = 'Sheet clear returned false; values may not have been cleared.';
            }
        } catch (err) {
            sheetError = err.message || 'Failed to clear Google Sheet.';
        }
    } else if (typeof sheetsLogger.resetRowCache === 'function') {
        sheetsLogger.resetRowCache(2);
    }

    gameState = createInitialGameState();
    io.emit('gameState', gameState);

    if (sheetError) {
        return res.status(500).json({ error: sheetError, gameState, sheetCleared });
    }

    res.json({ ok: true, gameState, sheetCleared });
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

// Play-by-play: fetch recent rows
app.get('/api/pbp', async (req, res) => {
    if (!ENABLE_SHEETS_LOGGING) return res.status(400).json({ error: 'Sheets logging not enabled' });
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : null; // null => no cap
    try {
        const plays = await sheetsLogger.fetchPlayByPlay(SPREADSHEET_ID, SHEET_NAME, limit);
        res.json({ plays });
    } catch (err) {
        console.error('pbp fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch play-by-play' });
    }
});

// Play-by-play: edit a row
app.post('/api/pbp/update', async (req, res) => {
    if (!ENABLE_SHEETS_LOGGING) return res.status(400).json({ error: 'Sheets logging not enabled' });
    const { rowNumber, values } = req.body;
    if (!rowNumber || !Array.isArray(values) || values.length < 7) {
        return res.status(400).json({ error: 'rowNumber and 7 values required' });
    }
    try {
        await sheetsLogger.updateRow(SPREADSHEET_ID, SHEET_NAME, rowNumber, values.slice(0, 7));
        res.json({ ok: true });
    } catch (err) {
        console.error('pbp update error:', err);
        res.status(500).json({ error: 'Failed to update play' });
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