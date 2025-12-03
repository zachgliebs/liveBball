const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Configure your Google Sheets credentials
// You'll need to set up a Google Cloud project and download the credentials JSON
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SHEETS_API_KEY = process.env.SHEETS_API_KEY;
const spreadsheetId = '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE';

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
        const eventType = points === 2 ? '2' : '3';
        const event = made ? `${eventType}YES` : `${eventType}NO`;
        
        // Column 3: Assist or Rebound (if assist exists)
        const assister = assist && assistTeam ? formatPlayer(assistTeam, assist) : '';
        
        // Column 4: Fast Break (TRUE/FALSE)
        const fastBreak = isFastBreak ? 'TRUE' : 'FALSE';
        
        // Column 5: Second Chance (TRUE/FALSE)
        const secondChance = isSecondChance ? 'TRUE' : 'FALSE';
        
        // Column 6: Paint (TRUE/FALSE)
        const paint = isPaint ? 'TRUE' : 'FALSE';

        const values = [
            [shooter, event, assister, fastBreak, secondChance, paint]
        ];

        const response = await sheetsClient.spreadsheets.values.append({
            spreadsheetId: '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE',
            range: `${sheetName}!A:G`,
            valueInputOption: 'RAW',
            resource: {
                values: values
            }
        });

        console.log(`Play-by-play logged: ${shooter} - ${event}`);
        return true;
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

        const response = await sheetsClient.spreadsheets.values.append({
            spreadsheetId: '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE',
            range: `${sheetName}!A:G`,
            valueInputOption: 'RAW',
            resource: {
                values: values
            }
        });

        console.log(`Event logged: ${actor} - ${eventCode}`);
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
        
        // Column 2: Event (1 YES/NO for free throw)
        const event = made ? '1 YES' : '1 NO';
        
        // Column 3: Empty for free throws
        const assister = '';
        
        // Column 4: Fast Break (FALSE for free throws)
        const fastBreak = 'FALSE';
        
        // Column 5: Second Chance (FALSE)
        const secondChance = 'FALSE';
        
        // Column 6: Paint (FALSE)
        const paint = 'FALSE';

        const values = [
            [shooter, event, assister, fastBreak, secondChance, paint]
        ];

        const response = await sheetsClient.spreadsheets.values.append({
            spreadsheetId: '12gFXKBy-Ywq3ibGHAm9yFN1Iglqy9zr5jbD8squxJCE',
            range: `${sheetName}!A:G`,
            valueInputOption: 'RAW',
            resource: {
                values: values
            }
        });

        console.log(`Free throw logged: ${shooter} - ${event}`);
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

        // Rebounds might not be separate entries - could be part of shot entry
        // This is a placeholder for potential rebound-only logging
        console.log(`Rebound by ${formatPlayer(team, player)} (${type})`);
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
    logRebound
};
