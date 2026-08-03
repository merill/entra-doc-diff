# Microsoft Entra Documentation Change Monitor

An automated GitHub Actions workflow that monitors the [Microsoft Entra documentation repository](https://github.com/MicrosoftDocs/entra-docs) and sends daily email summaries of documentation changes.

## 🚀 Features

- **📅 Daily Monitoring**: Automatically runs every day at 6:00 PM PST (optimal timing based on Microsoft's merge patterns)
- **📧 Email Alerts**: Beautifully formatted HTML email reports sent to your inbox
- **🔍 Smart Analysis**: Categorizes changes into new files, modifications, and deletions
- **💡 Change Summaries**: Provides detailed summaries of what changed in each modified file
- **📊 Visual Reports**: Clean, responsive HTML reports with statistics and direct GitHub links
- **📁 Archive**: Saves historical reports as GitHub Actions artifacts
- **✨ Plain-English Digest**: Uses the OpenAI Responses API to explain the day's material changes for Entra administrators

## 📋 What You Get

### Email Report Includes:
1. **📊 Summary Statistics**: Total commits, new files, modified files, deleted files, and contributors
2. **🆕 New Files Section**: Lists all newly added markdown documentation files with direct GitHub links
3. **📝 Modified Files Section**: Shows changed files with:
   - Line change statistics (+additions/-deletions)
   - Key content changes summary
   - Commit author and timestamp
   - Direct links to files on GitHub
4. **🗑️ Deleted Files Section**: Lists removed documentation files

### Sample Report Structure:
```
📋 Microsoft Entra Documentation Changes
Daily summary for changes since [timestamp]

📊 Summary
- 15 Total Commits
- 3 New Files  
- 8 Modified Files
- 1 Deleted Files
- 5 Contributors

🆕 New Documentation Files
├── docs/identity/authentication/new-feature.md
├── docs/identity/hybrid/updated-guide.md
└── docs/governance/lifecycle-workflows.md

📝 Modified Documentation Files  
├── docs/identity/authentication/howto-mfa.md
│   ├── +12/-3 lines changed
│   ├── Key Changes: Updated authentication flow steps...
│   └── Modified by author on Jan 15, 2025
└── [additional files...]
```

## ⚙️ Setup Instructions

### 1. **Repository Setup**
```bash
# Clone this repository
git clone https://github.com/yourusername/entra-doc-diff.git
cd entra-doc-diff

# Install dependencies
npm install
```

### 2. **Configure Secrets**
Go to your repository settings → Secrets and variables → Actions, and add:

- **`AZURE_CLIENT_ID`**: Your Entra ID app registration client ID
- **`AZURE_CLIENT_SECRET`**: Your Entra ID app registration client secret
- **`AZURE_TENANT_ID`**: Your Azure/Microsoft 365 tenant ID
- **`SENDER_EMAIL`**: Email address to send from (must exist in your tenant)
- **`OPENAI_API_KEY`**: OpenAI project API key used to generate per-diff and grouped plain-English summaries
- **`DISCORD_ENTRA_DOCS_WEBHOOK_URL`**: Incoming webhook for the Discord channel that receives Entra documentation updates

The recipient email (`merill@merill.net`) is already configured in the workflow.

The workflow defaults to `gpt-5.6-luna` with medium reasoning and three concurrent per-diff requests. Every material diff receives its own English summary. When a report contains multiple diffs, one additional Luna request groups related changes into a daily digest. You can override `OPENAI_SUMMARY_MODEL`, `OPENAI_SUMMARY_REASONING_EFFORT`, and `OPENAI_SUMMARY_CONCURRENCY`, or disable AI generation with `OPENAI_SUMMARY_ENABLED=false`. Deterministic fallbacks keep report generation, Discord delivery, and email working if OpenAI is unavailable.

### Discord setup

1. Create the target text channel in your Discord server.
2. Open **Edit Channel → Integrations → Webhooks** and create an `Entra Docs` webhook.
3. Store its URL in the repository Actions secret `DISCORD_ENTRA_DOCS_WEBHOOK_URL`.
4. Run the workflow manually. It posts one grouped digest when there are multiple changes, followed by one rich embed per diff.

Discord messages disable all automatic mentions, retry rate limits and transient errors, and persist delivery IDs in `website/discord-state.json` so workflow reruns do not repost the same change. Set `DISCORD_ENABLED=false` to disable delivery or `DISCORD_DRY_RUN=true` to build the queue without sending it.

### 3. **Microsoft Graph Setup**
1. Create an Entra ID app registration in [Azure Portal](https://portal.azure.com)
2. Add **Mail.Send** application permission
3. Grant admin consent for the permission
4. Create a client secret
5. Configure the sender email (must be a valid mailbox in your organization)

📚 **Detailed setup guide**: See [GRAPH-SETUP.md](./GRAPH-SETUP.md) for step-by-step instructions.

### 4. **Customize (Optional)**
Edit `.github/workflows/daily-docs-monitor.yml` to:
- Change the schedule (currently 6:00 PM PST daily)
- Modify the recipient email
- Adjust the timezone

## 🕒 Optimal Timing

Based on analysis of Microsoft's documentation repository patterns:
- **Peak Activity**: 9 AM - 5 PM PST (Microsoft business hours)
- **Bulk Updates**: Often occur in late afternoon
- **Chosen Schedule**: 6:00 PM PST (2:00 AM UTC)
- **Why**: Provides 10-20 minute buffer after typical documentation workflows complete

## 🧪 Testing

Test the monitor manually:
```bash
# Unit tests do not call OpenAI, Discord, or Microsoft Graph
npm test

# End-to-end local run without sending email or Discord messages
DRY_RUN=true DISCORD_DRY_RUN=true LOCAL_REPO_PATH=/path/to/entra-docs npm start
```

Or trigger the GitHub Action manually:
1. Go to Actions tab in your repository
2. Select "Daily Entra Docs Monitor"
3. Click "Run workflow"

## 📁 File Structure

```
entra-doc-diff/
├── .github/workflows/
│   └── daily-docs-monitor.yml    # GitHub Actions workflow
├── src/
│   └── monitor-docs.js           # Main monitoring script  
├── reports/                      # Generated reports (local)
├── package.json                  # Dependencies
└── README.md                     # This file
```

## 🛠️ How It Works

1. **GitHub Actions Trigger**: Runs daily at scheduled time
2. **Fetch Commits**: Uses GitHub API to get last 24 hours of commits
3. **Filter Files**: Focuses on `.md` files in the `docs/` directory
4. **Analyze Changes**: Categorizes file modifications and asks Luna for one English summary per material diff
5. **Group Changes**: For multiple diffs, asks Luna for one additional product/documentation-area digest
6. **Publish**: Writes the summaries into the HTML and JSON reports and posts deduplicated Discord embeds
7. **Send Email**: Delivers the complete report through Microsoft Graph
8. **Archive**: Saves the report as a GitHub Actions artifact

## 🔧 Configuration Options

### Workflow Variables (in `daily-docs-monitor.yml`):
- `RECIPIENT_EMAIL`: Where to send the reports
- `cron`: Schedule (currently `'0 2 * * *'` for 2 AM UTC)

### Script Configuration (in `monitor-docs.js`):
- `targetRepo`: Repository to monitor (currently `MicrosoftDocs/entra-docs`)
- File filtering rules (currently `.md` files in `docs/` directory)
- Email formatting and styling
- Change summary algorithms

## 📧 Email Delivery

The system uses Microsoft Graph for reliable email delivery:
- **HTML Format**: Rich, responsive design that works on all devices
- **Text Fallback**: Plain text version for email clients that don't support HTML  
- **Direct Links**: Every file mentioned links directly to GitHub
- **Mobile Friendly**: Responsive design for mobile viewing
- **Enterprise Integration**: Uses your organization's email infrastructure


## 📈 Monitoring & Troubleshooting

### GitHub Actions Logs:
- View run history in the Actions tab
- Each run shows detailed logs of the monitoring process
- Failed runs will show specific error messages

### Common Issues:
1. **Email not sending**: Check Microsoft Graph app permissions and admin consent
2. **No changes detected**: Verify repository access and date range
3. **Rate limiting**: GitHub API has rate limits; monitor uses authentication to increase limits

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details


---

**🤖 Automated with ❤️ for the Microsoft Entra community**
