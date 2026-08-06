# 🚀 Quick Start Guide

## Step 1: Get Your GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. **Important**: Set expiration to **90 days or less** (Microsoft's enterprise policy requirement)
4. Select scopes: `public_repo` (for reading public repositories)
5. Copy the generated token

## Step 2: Set Up Microsoft Graph for Failure Alerts (Optional)

1. Create an Entra ID app registration in [Azure Portal](https://portal.azure.com)
2. Add **Mail.Send** application permission and grant admin consent. This is used only to notify `merill@merill.net` when a refresh fails; daily subscriber summaries use Kit.
3. Create a client secret
4. Configure your sender email (must be a valid mailbox in your organization)

📚 **Detailed Guide**: See [GRAPH-SETUP.md](./GRAPH-SETUP.md) for complete setup instructions.

## Step 3: Configure Secrets in GitHub

Go to your repository Settings → Secrets and variables → Actions:

Add these secrets:
- `AZURE_CLIENT_ID`: Your Entra ID app client ID
- `AZURE_CLIENT_SECRET`: Your Entra ID app client secret  
- `AZURE_TENANT_ID`: Your Azure tenant ID
- `SENDER_EMAIL`: Your authorized sender email
- `OPENAI_API_KEY`: Your OpenAI project API key for generating per-diff and grouped English summaries
- `DISCORD_ENTRA_SCOUT_WEBHOOK_URL`: Shared Entra Scout incoming webhook for the Discord Entra updates channel. Store the same URL under this secret name in the Message Center repository.

The workflow uses the OpenAI Responses API with `gpt-5.6-luna` and `xhigh` reasoning. It summarizes every diff separately and makes one additional grouping request when multiple diffs are detected. If the key is missing or an API request fails, the site, JSON, Discord feed, and email use deterministic fallback text.

## Step 4: Test Locally (Optional)
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your tokens
# GITHUB_TOKEN=your_token_here
# AZURE_CLIENT_ID=your_client_id_here
# AZURE_CLIENT_SECRET=your_secret_here
# AZURE_TENANT_ID=your_tenant_id_here
# etc.

# Run a test
npm test
```

## Step 5: Enable the Workflow
The GitHub Action refreshes every four hours. The 08:15 UTC run also schedules the daily Kit subscriber summary after the site build. You can also:
- Go to Actions tab → "Daily Entra Docs Monitor" → "Run workflow" to test manually
- Check the logs to ensure everything is working
- Check Kit for the scheduled subscriber broadcast

## ⚡ Quick Tips
- The first run might take a few minutes to set up
- Reports are saved as GitHub Actions artifacts for 30 days
- You can modify the schedule in `.github/workflows/daily-docs-monitor.yml`
- Email delivery is optional - reports are always saved as artifacts

## 🔧 Troubleshooting
- **No subscriber email?** Check the Kit broadcast log, API key, and verified sending domain
- **Action failed?** Check the Actions tab for detailed error logs
- **Rate limits?** The GitHub token provides higher rate limits for API calls
- **Token lifetime error?** Microsoft requires tokens to be 90 days or less for their repositories

Ready to monitor Microsoft Entra docs changes! 🎉
