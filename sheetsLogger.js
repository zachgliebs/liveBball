const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Configure your Google Sheets credentials
// You'll need to set up a Google Cloud project and download the credentials JSON
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SHEETS_API_KEY = process.env.SHEETS_API_KEY;
// spreadsheetId should be passed into each function; don't hardcode here

let sheetsClient = null;

// Store team letters (default to H and A, but can be overridden from Setup sheet)
let homeTeamLetter = 'H';
let awayTeamLetter = 'A';

// Initialize the Google Sheets API client
async function initializeSheetsClient() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        
        sheetsClient = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets client initialized');
        return true;
    } catch (error) {
        console.error('Failed to initialize Google Sheets client:', error.message);
        return false;
    }
}

// Fetch team letters from Setup sheet (C2 = home, D2 = away)
async function fetchTeamLetters(spreadsheetId) {
    if (!sheetsClient) {
        console.warn('Sheets client not initialized, using default letters H and A');
        return { home: 'H', away: 'A' };
    }
    
    try {
        const range = 'Setup!C2:D2';
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range
        });
        
        const values = response?.data?.values?.[0] || [];
        const home = values[0]?.trim() || 'H';
        const away = values[1]?.trim() || 'A';
        
        homeTeamLetter = home;
        awayTeamLetter = away;
        
        console.log(`Team letters loaded: Home='${home}', Away='${away}'`);
        return { home, away };
    } catch (error) {
        console.error('Failed to fetch team letters from Setup sheet:', error.message);
        console.log('Using default letters H and A');
        return { home: 'H', away: 'A' };
    }
}

// Get current team letters
function getTeamLetters() {
    return { home: homeTeamLetter, away: awayTeamLetter };
}

// Update an entire row (A:G) at a specific row number
async function updateRow(spreadsheetId, sheetName, rowNumber, rowValues) {
    if (!sheetsClient) return false;
    try {
        const range = `${sheetName}!A${rowNumber}:G${rowNumber}`;
        console.log(`Updating row ${rowNumber} at range ${range} with:`, rowValues);
        const response = await sheetsClient.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED', // Changed from RAW to properly handle booleans
            resource: {
                values: [rowValues]
            }
        });
        console.log('Update response:', response && response.data ? response.data : response);
        return response && response.data ? response.data : null;
    } catch (err) {
        console.error('Error updating row in Google Sheets:', err.message || err);
        return false;
    }
}

// Format player identifier (H23, A34, etc)
function formatPlayer(team, playerNumber) {
    const teamLetter = team === 'home' ? homeTeamLetter : awayTeamLetter;
    // If playerNumber is null/undefined, return just the team letter
    if (playerNumber === null || playerNumber === undefined) {
        return teamLetter;
    }
    return `${teamLetter}${playerNumber}`;
}

// Log a shot to the Google Sheet
async function logShot(spreadsheetId, sheetName, shotData) {
    if (!sheetsClient) return false;
    
    try {
        const {
            team,           // 'home' or 'away'
            player,         // player number
            points,         // 2 or 3
            made,           // true or false
            assist,         // player number or null
            assistTeam,     // 'home' or 'away' or null
            isFastBreak,    // true or false
            isSecondChance, // true or false
            isPaint         // true or false
        } = shotData;

        // Column 1: Player who shot
        const shooter = formatPlayer(team, player);
        
        // Column 2: Event (1 YES/NO, 2 YES/NO, 3 YES/NO)
            // Column 2: Event codes without spaces (e.g. 2YES, 3NO)
            const eventType = points === 2 ? '2' : '3';
            const event = made ? `${eventType}YES` : `${eventType}NO`;
        
        // Column 3: Assist or Rebound (if assist exists)
        const assister = assist && assistTeam ? formatPlayer(assistTeam, assist) : '';
        
        // Column 4: Fast Break (boolean - true/false, not string)
        const fastBreakBool = isFastBreak === true;
        
        // Column 5: Second Chance (boolean - true/false, not string)
        const secondChanceBool = isSecondChance === true;
        
        // Column 6: (placeholder)
        const placeholder = '';

        // Column 7: Paint (boolean - true/false, not string)
        const paintBool = isPaint === true;

            const values = [
                [shooter, event, assister, fastBreakBool, secondChanceBool, placeholder, paintBool]
            ];

            // Validate event against allowed codes to avoid data-validation rejection
            const allowedEvents = new Set(['1YES','1NO','2YES','2NO','3YES','3NO','TO','STL','BLK','REB']);
            if (!allowedEvents.has(String(event).toUpperCase())) {
                console.warn('sheetsLogger: event value not in whitelist, sending anyway:', event);
            }

            console.log('Writing shot row to Google Sheet:', values[0]);
            // Get the next empty row and write to it explicitly
            const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
            const range = `${sheetName}!A${nextRow}:G${nextRow}`;
            const response = await sheetsClient.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED', // Changed from RAW to properly handle booleans
                resource: {
                    values: values
                }
            });

            console.log(`Play-by-play logged: ${shooter} - ${event} to row ${nextRow}`);
            if (response && response.data) {
                console.log('Sheets update response:', response.data);
                const updatedRange = response.data.updatedRange || range;
                console.log('Sheets updatedRange:', updatedRange);
                // Return the updatedRange so callers can track which row was written
                return { updatedRange: updatedRange };
            }
            return { updatedRange: null };
    } catch (error) {
        console.error('Error logging shot to Google Sheets:', error.message);
        return false;
    }
}

// Log a turnover/steal/block to the Google Sheet
async function logEvent(spreadsheetId, sheetName, eventData) {
    if (!sheetsClient) return false;
    
    try {
        const {
            eventType,      // 'turnover', 'steal', 'block'
            team,           // 'home' or 'away' (steal/block team)
            player,         // player number (stealer/blocker/turnover player)
            isFastBreak,    // true or false (only relevant for steals leading to scoring)
            turnoverTeam,   // team that lost the ball (for steals)
            turnoverPlayer, // player who lost the ball (for steals)
            stealByTeam,    // team that made the steal (optional override)
            stealByPlayer   // player who made the steal (optional override)
        } = eventData;

        // Column 1: actor (ball carrier for steals/turnovers, blocker for block)
        let actorTeam = team;
        let actorPlayer = player;
        if (eventType === 'steal') {
            actorTeam = turnoverTeam || (team === 'home' ? 'away' : 'home');
            actorPlayer = turnoverPlayer || null;
        }

        const actor = actorPlayer ? formatPlayer(actorTeam, actorPlayer) : '';

        // Column 2: Event type (TO for turnovers/steals, BLK for blocks)
        let eventCode;
        if (eventType === 'turnover' || eventType === 'steal') eventCode = 'TO';
        else if (eventType === 'block') eventCode = 'BLK';

        // Column 3: For steals, put the stealer here; otherwise empty
        let assister = '';
        if (eventType === 'steal' && stealByTeam && stealByPlayer) {
            assister = formatPlayer(stealByTeam, stealByPlayer);
        }
        
        // Column 4: Fast Break (boolean)
        const fastBreak = isFastBreak === true;
        
        // Column 5: Second Chance (FALSE for defensive events)
        const secondChance = false;
        
        // Column 6: (placeholder)
        const placeholder = '';
        
        // Column 7: Paint (FALSE)
        const paint = false;

        const values = [
            [actor, eventCode, assister, fastBreak, secondChance, placeholder, paint]
        ];

            console.log('Writing event row to Google Sheet:', values[0]);
            // Get the next empty row and write to it explicitly
            const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
            const range = `${sheetName}!A${nextRow}:G${nextRow}`;
            const response = await sheetsClient.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: range,
                valueInputOption: 'USER_ENTERED', // Changed from RAW to properly handle booleans
                resource: {
                    values: values
                }
            });        console.log(`Event logged: ${actor} - ${eventCode} to row ${nextRow}`);
        if (response && response.data) console.log('Sheets update response:', response.data);
        return true;
    } catch (error) {
        console.error('Error logging event to Google Sheets:', error.message);
        return false;
    }
}

// Log a free throw to the Google Sheet
async function logFreeThrow(spreadsheetId, sheetName, ftData) {
    if (!sheetsClient) return false;
    
    try {
        const {
            team,           // 'home' or 'away'
            player,         // player number
            made            // true or false
        } = ftData;

        // Column 1: Player who shot
        const shooter = formatPlayer(team, player);
        
        // Column 2: Event (1YES/1NO for free throw)
        const event = made ? '1YES' : '1NO';

        // Column 3: Empty for free throws
        const assister = '';

        // Column 4: Fast Break (boolean false for free throws)
        const fastBreakBool = false;

        // Column 5: Second Chance (boolean false)
        const secondChanceBool = false;

        // Column 6: (placeholder)
        const placeholder = '';

        // Column 7: Paint (boolean false)
        const paintBool = false;

        const values = [
            [shooter, event, assister, fastBreakBool, secondChanceBool, placeholder, paintBool]
        ];

        console.log('Writing free throw row to Google Sheet:', values[0]);
        // Get the next empty row and write to it explicitly
        const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
        const range = `${sheetName}!A${nextRow}:G${nextRow}`;
        const response = await sheetsClient.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED', // Changed from RAW to properly handle booleans
            resource: {
                values: values
            }
        });

        console.log(`Free throw logged: ${shooter} - ${event} to row ${nextRow}`);
        if (response && response.data) console.log('Sheets update response:', response.data);
        return true;
    } catch (error) {
        console.error('Error logging free throw to Google Sheets:', error.message);
        return false;
    }
}

// Log a rebound to the Google Sheet
async function logRebound(spreadsheetId, sheetName, reboundData) {
    if (!sheetsClient) return false;
    
    try {
        const {
            team,           // 'home' or 'away'
            player,         // player number
            type            // 'offensive' or 'defensive'
        } = reboundData;
        // Standalone rebound rows should not be appended to the sheet.
        // Rebounds are recorded by updating the missed-shot row (if present)
        // or otherwise are tracked in the server state only. Return true
        // to indicate the rebound was handled server-side.
        console.log(`Rebound recorded server-side (no sheet append): ${formatPlayer(team, player)} (${type})`);
        return true;
    } catch (error) {
        console.error('Error logging rebound to Google Sheets:', error.message);
        return false;
    }
}

module.exports = {
    initializeSheetsClient,
    fetchTeamLetters,
    getTeamLetters,
    logShot,
    logEvent,
    logFreeThrow,
    logRebound,
    clearSheetData,
    updateRow,
    findLastNonEmptyRow,
    getNextEmptyRow,
    fetchPlayByPlay,
    resetRowCache
};

// Cache for the next empty row (reset on server restart)
let cachedNextRow = null;

// Clear all play-by-play values while keeping validation/dropdowns intact
async function clearSheetData(spreadsheetId, sheetName, maxRows = 2000) {
    if (!sheetsClient) return false;
    try {
        const topRow = 2;
        const lastRow = Math.max(topRow, maxRows);

        // 1) Clear text/number columns (A-D and H) but leave checkbox columns (E-G) untouched.
        const clearRanges = [
            `${sheetName}!A${topRow}:D${lastRow}`,
            `${sheetName}!H${topRow}:H${lastRow}`
        ];
        console.log('Clearing ranges:', clearRanges.join(', '));
        await sheetsClient.spreadsheets.values.batchClear({
            spreadsheetId,
            resource: { ranges: clearRanges }
        });

        // 2) Reset checkbox columns (E-G) to unchecked (FALSE) while keeping validation intact.
        const checkboxRange = `${sheetName}!E${topRow}:G${lastRow}`;
        const checkboxRows = Array.from({ length: lastRow - topRow + 1 }, () => ['FALSE', 'FALSE', 'FALSE']);
        await sheetsClient.spreadsheets.values.update({
            spreadsheetId,
            range: checkboxRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: checkboxRows }
        });

        // 3) Reapply the marker formula in column I for each row (I2 = A2, I3 = A3, ...).
        const markerRange = `${sheetName}!I${topRow}:I${lastRow}`;
        const markerRows = Array.from({ length: lastRow - topRow + 1 }, (_, idx) => {
            const rowNum = topRow + idx;
            return [`=IF(ISBLANK(A${rowNum}),"F","T")`];
        });
        await sheetsClient.spreadsheets.values.update({
            spreadsheetId,
            range: markerRange,
            valueInputOption: 'USER_ENTERED',
            resource: { values: markerRows }
        });

        resetRowCache(2);
        console.log(`Sheet cleared; next writes will start at row ${topRow}`);
        return true;
    } catch (err) {
        console.error('Error clearing sheet data:', err.message || err);
        return false;
    }
}

// Find the first empty row using column I markers (T = filled, F/blank = empty), starting at row 2
async function findNextEmptyRow(spreadsheetId, sheetName) {
    if (!sheetsClient) return null;
    try {
        const range = `${sheetName}!I:I`; // Column I holds T/F markers
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range
        });
        const rows = (response && response.data && response.data.values) || [];
        
        // Starting at row 2 (index 1), find first row where column I is not 'T'
        for (let i = 1; i < rows.length; i++) { // Start at index 1 (row 2)
            const row = rows[i];
            const cellValue = row && row[0] ? String(row[0]).trim() : '';
            if (cellValue.toUpperCase() !== 'T') {
                const emptyRow = i + 1; // convert to 1-based row number
                console.log(`findNextEmptyRow: First empty row found at ${emptyRow}`);
                return emptyRow;
            }
        }
        
        // If all inspected rows are 'T', next empty is after the last row we saw
        const nextRow = rows.length + 1;
        console.log(`findNextEmptyRow: All rows filled, next empty row is ${nextRow}`);
        return nextRow;
    } catch (err) {
        console.error('Error finding next empty row:', err.message || err);
        return 2; // Default to row 2 on error
    }
}

// Get the next empty row number for appending (uses cache after first call)
async function getNextEmptyRow(spreadsheetId, sheetName) {
    if (cachedNextRow === null) {
        cachedNextRow = await findNextEmptyRow(spreadsheetId, sheetName);
    }
    const rowToUse = cachedNextRow;
    cachedNextRow++; // Increment for next call
    return rowToUse;
}

function resetRowCache(startRow = 2) {
    cachedNextRow = startRow;
}

// Legacy function for compatibility
async function findLastNonEmptyRow(spreadsheetId, sheetName, maxRows = 2000) {
    const nextEmpty = await findNextEmptyRow(spreadsheetId, sheetName);
    return nextEmpty ? nextEmpty - 1 : 1;
}

// Fetch recent play-by-play rows (A:G) with row numbers for editing.
// Uses column I marker (T = filled) to include only populated rows.
// Pulls all data rows starting at A2, trims empties, and applies an optional limit from the end.
async function fetchPlayByPlay(spreadsheetId, sheetName, limit = null) {
    if (!sheetsClient) return [];
    try {
        const range = `${sheetName}!A2:I`; // include marker column I
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range
        });
        const rows = (response && response.data && response.data.values) || [];
        const annotated = rows
            .map((vals, idx) => ({ rowNumber: idx + 2, values: vals }))
            .filter(r => {
                if (!r.values) return false;
                const marker = r.values[8]; // column I
                return String(marker).trim().toUpperCase() === 'T';
            });
        if (limit && annotated.length > limit) {
            return annotated.slice(annotated.length - limit);
        }
        return annotated;
    } catch (err) {
        console.error('Error fetching play-by-play:', err.message || err);
        return [];
    }
}

