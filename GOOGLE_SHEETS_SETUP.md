# Google Sheets Play-by-Play Logging Setup

This guide will help you set up live play-by-play logging to a Google Sheet.

## Prerequisites

You need:
1. A Google Cloud Project
2. A Google Sheet to log to
3. Service Account credentials

## Setup Steps

### 1. Create a Google Cloud Project
- Go to https://console.cloud.google.com/
- Click "Create Project"
- Name your project and create it

### 2. Enable the Google Sheets API
- In the Google Cloud Console, go to "APIs & Services"
- Click "Enable APIs and Services"
- Search for "Google Sheets API"
- Click it and press "Enable"

### 3. Create a Service Account
- Go to "APIs & Services" > "Credentials"
- Click "Create Credentials" > "Service Account"
- Fill in the name and description
- Click "Create and Continue"
- Grant Editor role to the service account
- Click "Continue" and "Done"

### 4. Create and Download JSON Key
- Click on the service account you created
- Go to "Keys" tab
- Click "Add Key" > "Create new key"
- Choose "JSON" format
- Download the file

### 5. Place credentials.json
- Save the downloaded JSON file as `credentials.json` in the liveBball project root directory
- **Keep this file private and never commit it to git**

### 6. Create Your Google Sheet
- Go to Google Sheets and create a new spreadsheet
- Set up column headers (optional):
  - Column A: Player
  - Column B: Event
  - Column C: Assist/Rebound
  - Column D: Fast Break
  - Column E: 2nd Chance
  - Column F: Paint
- Get your Spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid=0`

### 7. Share the Sheet with Service Account
- Open the JSON credentials file and find the "client_email"
- In your Google Sheet, click "Share"
- Paste the client email and grant Editor access
- Note: Don't send a notification email

### 8. Configure Environment Variables
Create a `.env` file in the project root or set environment variables:
```
SPREADSHEET_ID=your_spreadsheet_id_here
SHEET_NAME=Sheet1
```

Or update `server.js` to use your values directly.

### 9. Install Dependencies
```bash
npm install googleapis
```

## Data Format

The play-by-play sheet follows this format:

| Column | Name | Format | Example |
|--------|------|--------|---------|
| A | Player | Letter + Number | H23, A34 |
| B | Event | Type + Result | 2YES, 1NO, STL, BLK, TO |
| C | Assist/Rebound | Letter + Number | H34, A12 |
| D | Fast Break | TRUE/FALSE | TRUE |
| E | 2nd Chance | TRUE/FALSE | FALSE |
| F | Paint | TRUE/FALSE | FALSE |

### Event Types:
- `1YES` / `1NO` - Free throw make/miss
- `2YES` / `2NO` - 2-point make/miss
- `3YES` / `3NO` - 3-point make/miss
- `STL` - Steal
- `BLK` - Block
- `TO` - Turnover

## Troubleshooting

If you get permission errors:
- Make sure the service account email is shared on the Google Sheet
- Verify the credentials.json file is in the correct location
- Check that the Sheets API is enabled in Google Cloud Console

If plays aren't logging:
- Check the server console for error messages
- Verify the SPREADSHEET_ID is correct
- Make sure the SHEET_NAME matches your sheet name (default: "Sheet1")

## Security Notes

- **Never commit credentials.json to git**
- Add it to `.gitignore`
- Only share credentials through secure channels
- Rotate credentials periodically
