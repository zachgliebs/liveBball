const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Configure your Google Sheets credentials
// You'll need to set up a Google Cloud project and download the credentials JSON
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SHEETS_API_KEY = process.env.SHEETS_API_KEY;
// spreadsheetId should be passed into each function; don't hardcode here

let sheetsClient = null;

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

// Update an entire row (A:F) at a specific row number
async function updateRow(spreadsheetId, sheetName, rowNumber, rowValues) {
    if (!sheetsClient) return false;
    try {
        const range = `${sheetName}!A${rowNumber}:F${rowNumber}`;
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
    const teamLetter = team === 'home' ? 'H' : 'A';
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
        
        // Column 6: Paint (boolean - true/false, not string)
        const paintBool = isPaint === true;

            const values = [
                [shooter, event, assister, fastBreakBool, secondChanceBool, paintBool]
            ];

            // Validate event against allowed codes to avoid data-validation rejection
            const allowedEvents = new Set(['1YES','1NO','2YES','2NO','3YES','3NO','TO','STL','BLK','REB']);
            if (!allowedEvents.has(String(event).toUpperCase())) {
                console.warn('sheetsLogger: event value not in whitelist, sending anyway:', event);
            }

            console.log('Writing shot row to Google Sheet:', values[0]);
            // Get the next empty row and write to it explicitly
            const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
            const range = `${sheetName}!A${nextRow}:F${nextRow}`;
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
            team,           // 'home' or 'away'
            player,         // player number
            isFastBreak     // true or false (only relevant for steals leading to scoring)
        } = eventData;

        // Column 1: Player who caused event
        const actor = formatPlayer(team, player);
        
        // Column 2: Event type (TO, STL, BLK)
        let eventCode;
        if (eventType === 'turnover') eventCode = 'TO';
        else if (eventType === 'steal') eventCode = 'STL';
        else if (eventType === 'block') eventCode = 'BLK';
        
        // Column 3: Empty for turnovers/steals/blocks
        const assister = '';
        
        // Column 4: Fast Break (TRUE/FALSE - only if applicable)
        const fastBreak = isFastBreak ? 'TRUE' : 'FALSE';
        
        // Column 5: Second Chance (FALSE for defensive events)
        const secondChance = 'FALSE';
        
        // Column 6: Paint (TRUE/FALSE)
        const paint = 'FALSE';

        const values = [
            [actor, eventCode, assister, fastBreak, secondChance, paint]
        ];

            console.log('Writing event row to Google Sheet:', values[0]);
            // Get the next empty row and write to it explicitly
            const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
            const range = `${sheetName}!A${nextRow}:F${nextRow}`;
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

        // Column 6: Paint (boolean false)
        const paintBool = false;

        const values = [
            [shooter, event, assister, fastBreakBool, secondChanceBool, paintBool]
        ];

        console.log('Writing free throw row to Google Sheet:', values[0]);
        // Get the next empty row and write to it explicitly
        const nextRow = await getNextEmptyRow(spreadsheetId, sheetName);
        const range = `${sheetName}!A${nextRow}:F${nextRow}`;
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
    logShot,
    logEvent,
    logFreeThrow,
    logRebound,
    updateRow,
    findLastNonEmptyRow,
    getNextEmptyRow
};

// Cache for the next empty row (reset on server restart)
let cachedNextRow = null;

// Find the first empty row by checking column H for "T" values, starting at row 2
async function findNextEmptyRow(spreadsheetId, sheetName) {
    if (!sheetsClient) return null;
    try {
        const range = `${sheetName}!H:H`; // Get entire column H which has "T" for filled rows
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: range
        });
        const rows = (response && response.data && response.data.values) || [];
        
        // Starting at row 2 (index 1), find first row where H is not "T"
        for (let i = 1; i < rows.length; i++) { // Start at index 1 (row 2)
            const row = rows[i];
            const cellValue = row && row[0] ? String(row[0]).trim() : '';
            if (cellValue !== 'T') {
                const emptyRow = i + 1; // convert to 1-based row number
                console.log(`findNextEmptyRow: First empty row found at ${emptyRow}`);
                return emptyRow;
            }
        }
        
        // If all rows have "T", next empty is after the last row
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

// Legacy function for compatibility
async function findLastNonEmptyRow(spreadsheetId, sheetName, maxRows = 2000) {
    const nextEmpty = await findNextEmptyRow(spreadsheetId, sheetName);
    return nextEmpty ? nextEmpty - 1 : 1;
}
