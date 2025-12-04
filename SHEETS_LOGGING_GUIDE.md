# Google Sheets Play-by-Play Logging

Your basketball scoreboard now has live play-by-play logging to Google Sheets!

## Quick Start

1. **Install dependencies**: Run `npm install googleapis` in your project root

2. **Follow the setup guide**: See `GOOGLE_SHEETS_SETUP.md` for detailed instructions on:
   - Creating a Google Cloud Project
   - Enabling the Google Sheets API
   - Creating credentials
   - Setting up environment variables

3. **Set environment variables**:
   ```
   SPREADSHEET_ID=your_spreadsheet_id
   SHEET_NAME=Sheet1
   ```

4. **Start the server**: `npm start`

## What Gets Logged

Every play is automatically logged to your Google Sheet with the following information:

| Column | Data |
|--------|------|
| A | Player (H23, A34, etc) |
| B | Event (2YES, 3NO, STL, BLK, TO, etc) |
| C | Assist/Rebound Player (if applicable) |
| D | Fast Break (TRUE/FALSE) |
| E | 2nd Chance Points (TRUE/FALSE) |
| F | Paint (TRUE/FALSE) |

## How It Works

1. When a shot is made, it's automatically logged with:
   - The shooter and points value
   - Assist player (if one was recorded)
   - Whether it was a fast break (detected when assist dialog shows)
   - Whether it was second chance points (when user selects in the dialog)

2. When a steal, block, or turnover occurs, it's logged with:
   - The player who caused it
   - The event type

3. All timing and data is captured on the server and sent to Google Sheets in real-time

## Event Types

-- `1YES` / `1NO` - Free throw make/miss
-- `2YES` / `2NO` - 2-point make/miss
-- `3YES` / `3NO` - 3-point make/miss
- `STL` - Steal
- `BLK` - Block
- `TO` - Turnover

## Testing

To test without a real Google Sheet:
1. Don't set the `SPREADSHEET_ID` environment variable
2. Logging will be disabled but the app will work normally
3. Check server console for logging messages

## Notes

- Only made shots are logged (this can be changed if you want to log missed shots too)
- Free throw logging is ready but not yet integrated into the UI (you can extend it)
- Paint zone detection is not yet implemented (marked as FALSE)
- All timestamps are in UTC
- Credentials are never sent to the client - all logging happens server-side

## Troubleshooting

**Plays aren't logging?**
- Check that `SPREADSHEET_ID` is set correctly
- Verify the service account has access to your Google Sheet
- Check server console for error messages

**Permission denied errors?**
- Make sure the service account email is shared on your Google Sheet with Editor access
- Verify credentials.json is in the project root
- Check that the Sheets API is enabled in Google Cloud Console

**Can't find my Spreadsheet ID?**
- Open your Google Sheet in a browser
- The ID is in the URL: `https://docs.google.com/spreadsheets/d/{ID}/edit`

## Future Enhancements

Possible additions:
- Log missed shots separately
- Add free throw interface to the UI
- Implement paint zone detection
- Add quarter/timestamp to each log entry
- Create automatic stat summaries
- Add data validation/error checking
