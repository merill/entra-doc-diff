# Microsoft Entra Documentation Change Monitor

An automated GitHub Actions workflow that monitors the [Microsoft Entra documentation repository](https://github.com/MicrosoftDocs/entra-docs) and sends daily email summaries of documentation changes.

## 🚀 Features

- **📅 Daily Monitoring**: Automatically runs every day at 8:15 AM UTC, after Microsoft's late publish/sync cycle
- **📧 Email Alerts**: Beautifully formatted HTML email reports sent to your inbox
- **🗞️ Subscriber Broadcasts**: Concise Kit emails on days with meaningful Entra updates, with links to the full daily evidence
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
- **`DISCORD_ENTRA_SCOUT_WEBHOOK_URL`**: Shared Entra Scout incoming webhook for the Discord channel that receives both documentation and Message Center updates
- **`KIT_API_KEY`**: Kit v4 API key for the dedicated Daily.Entra.News account; omit it until the Kit account is approved and ready to send

Add these repository secrets for the public inline subscription form configuration:

- **`KIT_DAILY_FORM_UID`**: The public `data-uid` from Kit's JavaScript form embed
- **`KIT_DAILY_FORM_EMBED_SRC`**: The HTTPS `src` URL from Kit's JavaScript form embed; only Kit or ConvertKit hosts are accepted by the site generator

The recipient email (`merill@merill.net`) is already configured in the workflow.

The workflow defaults to `gpt-5.6-luna` with `xhigh` reasoning and three concurrent per-diff requests. Every material diff receives its own English summary. When a report contains multiple diffs, one additional Luna request groups related changes into a daily digest. You can override `OPENAI_SUMMARY_MODEL`, `OPENAI_SUMMARY_REASONING_EFFORT`, and `OPENAI_SUMMARY_CONCURRENCY`, or disable AI generation with `OPENAI_SUMMARY_ENABLED=false`. Deterministic fallbacks keep report generation, Discord delivery, and email working if OpenAI is unavailable.

### Discord setup

1. Create the target text channel in your Discord server.
2. Open **Edit Channel → Integrations → Webhooks** and create one webhook named `Entra Scout`.
3. Store its URL in this repository as the Actions secret `DISCORD_ENTRA_SCOUT_WEBHOOK_URL`.
4. Store the same URL under the same secret name in the Message Center repository. GitHub secrets are repository-scoped, but both values point to the single Discord webhook.
5. Run the workflow manually. Documentation changes are combined into one daily summary; Message Center posts retain their own archive and classification format.

Both publishers override the webhook name to `Entra Scout` but omit `avatar_url`, so Discord uses the image configured directly on the shared webhook. Set `DISCORD_ENTRA_SCOUT_NAME` to change the name, or set `DISCORD_ENTRA_SCOUT_AVATAR_URL` to a publicly accessible image URL only when you intentionally want a per-message avatar override.

Discord messages disable all automatic mentions, retry rate limits and transient errors, and persist delivery IDs in `website/discord-state.json` so workflow reruns do not repost the same daily summary. Set `DISCORD_ENABLED=false` to disable delivery or `DISCORD_DRY_RUN=true` to build the queue without sending it.

The documentation notification contains the grouped English digest and one link to the canonical `https://daily.entra.news/YYYY-MM-DD` daily page. It does not post separate cards for each documentation diff.

### Kit daily email setup

The public daily list is intentionally separate from the human-curated weekly Entra.News newsletter. The existing monitor workflow keeps the private Microsoft Graph report. After the dedicated 08:15 UTC email run succeeds and its static website commit is pushed, it calls the separate `daily-kit-broadcast.yml` workflow to publish the email-only Kit broadcast. The other four-hour refreshes never trigger subscriber email.

1. Create a dedicated Kit Newsletter account and complete Kit's sending approval.
2. Add and confirm `updates@daily.entra.news` as the sending address.
3. Verify `daily.entra.news` as the sending domain with the SPF, DKIM, and DMARC records Kit supplies.
4. Configure the account's default Classic or HTML email template with an unsubscribe link and physical address. The publisher deliberately uses the account default template.
5. Create an inline form, leave double opt-in enabled, and customize its confirmation email and success state.
6. Copy the JavaScript embed's `data-uid` and `src` values into the repository variables above.
7. Create a Kit v4 API key and save it as the `KIT_API_KEY` repository secret.
8. Test with seed subscribers in Outlook and Gmail before promoting the form publicly.

`node scripts/publish-kit-broadcast.js --date YYYY-MM-DD` publishes a saved daily report manually. Set `KIT_DRY_RUN=true` to render and validate the payload without contacting Kit. Without `KIT_API_KEY`, the command exits successfully after reporting that Kit is not configured.

The publisher uses the combined daily editorial brief, including relevant Message Center items, and falls back to the documentation digest when necessary. It sends only when the selected day contains changes, schedules delivery five minutes ahead, and targets all confirmed subscribers in the dedicated account. The Kit workflow serializes all runs, requires the selected date's report to exist, and checks an internal `daily-entra-news:YYYY-MM-DD` marker before every create attempt. After an ambiguous transient POST failure it re-lists broadcasts before retrying, so a broadcast that Kit accepted despite a lost response is not created again. Authentication and validation failures stop immediately without undoing the already-published site or Microsoft Graph report.

### 3. **Microsoft Graph Setup**
1. Create an Entra ID app registration in [Azure Portal](https://portal.azure.com)
2. Add **Mail.Send** application permission
3. Grant admin consent for the permission
4. Create a client secret
5. Configure the sender email (must be a valid mailbox in your organization)

📚 **Detailed setup guide**: See [GRAPH-SETUP.md](./GRAPH-SETUP.md) for step-by-step instructions.

### 4. **Customize (Optional)**
Edit `.github/workflows/daily-docs-monitor.yml` to:
- Change the four-hour schedule (currently 00:15 through 20:15 UTC)
- Modify the recipient email
- Change the dedicated 08:15 UTC email slot

## 🕒 Optimal Timing

Analysis of 838 merge commits in `MicrosoftDocs/entra-docs` from May through early August 2026 found recurring publish/sync cycles around 07:30, 12:30, 17:30, and 22:30 UTC. The 07:30 cycle consistently includes the late Pacific-day changes and its repository sync normally completes by approximately 07:38 UTC.

- **Chosen schedule**: 00:15, 04:15, 08:15, 12:15, 16:15, and 20:15 UTC
- **Why**: Captures each recurring publish/sync cycle soon after it settles while retaining 08:15 UTC as the complete daily email slot
- **Visitor display**: The generated site converts refresh timestamps and daily-page dates to the reader's local timezone in the browser

## 🧪 Testing

Test the monitor manually:
```bash
# Unit tests do not call OpenAI, Discord, Microsoft Graph, or Kit
npm test

# End-to-end local run without sending email or Discord messages
DRY_RUN=true DISCORD_DRY_RUN=true LOCAL_REPO_PATH=/path/to/entra-docs npm start
```

Build and preview the static Entra.News Daily site locally:

```bash
MC_DATA_PATH=../mc/@data npm run build:site
npm run preview:site
```

Open `http://127.0.0.1:4173/`. The generated site uses `daily.entra.news` as its canonical host and includes indexable day, week, month, product, topic, documentation-change, and Message Center pages. Recent documentation details lead with readable context and a formatted comparison, with the raw Markdown patch available as a secondary view.

The generated `/compare/` page is a fully client-side documentation source explorer. Paste a configured public documentation URL to map it to its GitHub repository, load the file's latest two revisions through GitHub's public REST API, and render visual and Markdown diffs in the browser. Public use requires no credentials and normally makes three API requests per comparison. GitHub limits unauthenticated requests by IP; an optional read-only token can be saved in browser-local storage for a higher limit. Tracked reports retain the change commit and its first parent, so links from `/changes/` pages use `/compare/?url=…&base=…&head=…&view=diff` to open the complete diff at the exact revisions represented by that change.

To compare two exact revisions, add `base=<older-commit-sha>&head=<newer-commit-sha>` to the compare URL. A historical link that only has `head` resolves its first parent through GitHub before loading the file. When neither parameter is present, the client compares the latest two commits that changed the file.

Documentation sources are declared in `assets/site/diff-config.js`. Each source maps a public site path to a GitHub repository path:

```js
window.DOC_DIFF_CONFIG = {
  sources: [{
    id: 'example-docs',
    label: 'Example Docs',
    siteUrl: 'https://docs.example.com/guide/',
    stripLocale: true,
    repositoryUrl: 'https://github.com/example/docs',
    repositoryPathPrefix: 'content',
    defaultBranch: 'main',
    fileExtension: '.md'
  }]
};
```

`siteUrl` supplies both the allowed HTTPS host and the public path prefix. With `stripLocale`, a leading segment such as `en-us` is ignored while mapping. The example maps `https://docs.example.com/en-us/guide/start` to `content/start.md`. Include every supported source in the `sources` array.

The checked-in static list currently covers Microsoft Entra, Azure, .NET, PowerShell, Microsoft 365, Microsoft Intune, Microsoft Fabric, Dynamics 365, SQL, Microsoft Graph, Visual Studio, ASP.NET Core, and Windows Server. Sources are matched in array order, so narrower routes belong before broad ones. An optional `query` object can select variants such as Microsoft Graph beta, and `pathAliases` can describe individual Learn-to-repository path exceptions without changing the client code.

Message Center ingestion includes a post when either its service list or title contains the standalone word `Entra` (case-insensitive). Set `MC_DATA_PATH` to the Message Center repository's `@data` directory when building locally; the GitHub workflow clones that repository automatically.

Or trigger the GitHub Action manually:
1. Go to Actions tab in your repository
2. Select "Daily Entra Docs Monitor"
3. Click "Run workflow"

## 📁 File Structure

```
entra-doc-diff/
├── .github/workflows/
│   ├── daily-docs-monitor.yml    # Generate and publish the daily site/report
│   └── daily-kit-broadcast.yml   # Send at most one Kit broadcast per report date
├── src/
│   └── monitor-docs.js           # Main monitoring script  
├── reports/                      # Generated reports (local)
├── package.json                  # Dependencies
└── README.md                     # This file
```

## 🛠️ How It Works

1. **GitHub Actions Trigger**: Runs every four hours at `:15`
2. **Fetch New Events**: Continues from a persisted documentation commit cursor and Message Center version map
3. **Filter Files**: Focuses on `.md` files in the `docs/` directory
4. **Analyze Changes**: Categorizes file modifications and asks Luna for one English summary per material diff
5. **Refresh Briefs**: Regenerates the affected Luna-xhigh day, week, and month brief only when source content changed
6. **Publish**: Merges events into cumulative UTC-day JSON, rebuilds the static site, and posts an incremental Discord update
7. **Send Maintainer Email**: At 08:15 UTC, delivers all pending documentation events since the preceding digest through Microsoft Graph
8. **Trigger Subscriber Brief**: After the website workflow succeeds, a serialized workflow schedules a concise, deduplicated Kit broadcast when the day contains meaningful updates
9. **Archive**: Saves the report as a GitHub Actions artifact and publishes the static output

## 🔧 Configuration Options

### Workflow Variables (in `daily-docs-monitor.yml`):
- `RECIPIENT_EMAIL`: Where to send the reports
- `cron`: Four-hour site/Discord schedule plus the dedicated 08:15 UTC email schedule
- `OPENAI_PERIOD_SUMMARY_DAILY_BUDGET_USD`: Shared UTC-day Luna-xhigh guardrail (currently `$0.25`)

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
