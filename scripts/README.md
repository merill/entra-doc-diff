# Historical Data Generation Script

This script generates website files for the last 3 months of Microsoft Entra documentation changes by analyzing git commits day by day.

## What it does

- **Date Range**: Processes the last 90 days (3 months) of changes
- **Daily Analysis**: For each day, analyzes all commits in the 24-hour period ending on that date
- **Website Generation**: Creates HTML and JSON files for each day in the `website/` directory
- **Index Page**: Updates the main index page with all historical data
- **Smart Grouping**: Groups changes by folder structure with file counts
- **Progress Tracking**: Shows progress as it processes each day

## How to run

### Using npm script

```bash
npm run generate-historical
```

### Direct execution

```bash
node scripts/generate-historical-data.js
```

## What gets generated

For each day with changes, the script creates:

- `website/YYYY-MM-DD.html` - Full report page for that day
- `website/YYYY-MM-DD.json` - Raw data for that day
- `website/index.html` - Updated index page with all reports

## Features

### Historical Context

- Each daily report clearly shows it's a historical report
- Shows the exact 24-hour period analyzed
- Includes period start/end times in the header

### Data Analysis

- **Commits**: Total number of commits in the period
- **File Changes**: New, modified, and deleted files
- **Contributors**: Unique authors who made changes
- **Folder Grouping**: Changes organized by documentation sections

### Performance Optimizations

- **Skip Processing**: Won't regenerate existing reports
- **Small Delays**: Includes 100ms delays between days to avoid overwhelming git
- **Error Handling**: Continues processing if one day fails
- **Progress Tracking**: Shows current progress (day X of Y)

## Example Output

```text
🚀 Starting historical data generation for the last 3 months...
📁 Using local repository at: ./entra-docs-pr
📅 Generating data from 2024-10-15 to 2025-01-14
📊 Processing 2024-10-15 (1/90)...
  📝 Found 3 commits for 2024-10-15
  💾 Saved report for 2024-10-15
📊 Processing 2024-10-16 (2/90)...
  📝 Found 0 commits for 2024-10-16
  💾 Saved report for 2024-10-16
...
📄 Generating comprehensive index page...
✅ Historical data generation complete! Processed 90 days.
🌐 Website files available in: /path/to/website
```

## File Structure

After running, your website directory will contain:

```text
website/
├── index.html                 # Main index with all reports
├── 2024-10-15.html           # Daily report pages
├── 2024-10-15.json           # Daily data files
├── 2024-10-16.html
├── 2024-10-16.json
├── ...
└── 2025-01-14.html
└── 2025-01-14.json
```

## Requirements

- **Git Repository**: The Entra docs repository must be available locally
- **Environment**: Same environment variables as the main monitor
- **Disk Space**: Each day generates ~5-50KB depending on changes
- **Time**: Takes approximately 5-15 minutes depending on git history size

## Use Cases

- **Initial Setup**: Generate historical data when first setting up the monitor
- **Backfill**: Fill in missing days if the daily monitor was down
- **Migration**: Moving from another monitoring system
- **Analysis**: Comprehensive analysis of documentation change patterns

## Notes

- The script extends the main `EntraDocsMonitor` class for consistency
- Uses the same styling and layout as daily reports
- Includes special "Historical Report" indicators
- Safely handles days with no commits
- Can be safely re-run (skips existing files)
