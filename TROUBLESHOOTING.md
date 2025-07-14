# 🔧 Troubleshooting Guide

Common issues and solutions for the Entra Docs Monitor.

## 🚫 GitHub Token Issues

### Error: "lifetime is greater than 90 days"
```
The 'Microsoft Open Source' enterprise forbids access via a personal access tokens (classic) 
if the token's lifetime is greater than 90 days.
```

**Solution:**
1. Go to [GitHub Token Settings](https://github.com/settings/tokens)
2. Either:
   - **Edit existing token**: Change expiration to 90 days or less
   - **Create new token**: Generate a new token with max 90-day expiration
3. Update your `.env` file with the new token
4. For GitHub Actions: Update the `GITHUB_TOKEN` secret in repository settings

### Error: "Not Found" (404)
```
RequestError [HttpError]: Not Found
```

**Possible causes:**
- Repository name is incorrect
- Token doesn't have `public_repo` scope
- Repository has been moved or renamed

**Solution:**
1. Verify repository exists: [MicrosoftDocs/entra-docs](https://github.com/MicrosoftDocs/entra-docs)
2. Check your token has `public_repo` scope
3. Update environment variables if repository name changed

## 📧 Email Sending Issues

### Error: "Insufficient privileges to complete the operation"
**Cause:** Missing or incorrect Microsoft Graph permissions

**Solution:**
1. Go to [Azure Portal](https://portal.azure.com) → App registrations
2. Select your app → API permissions
3. Ensure **Mail.Send** application permission is added
4. Click **"Grant admin consent"** and verify green checkmark appears

### Error: "Forbidden" or "401 Unauthorized"
**Possible causes:**
- Invalid client ID, secret, or tenant ID
- Client secret expired
- Missing admin consent

**Solution:**
1. Verify credentials in `.env` file:
   ```bash
   AZURE_CLIENT_ID=correct_client_id
   AZURE_CLIENT_SECRET=valid_secret_not_expired
   AZURE_TENANT_ID=correct_tenant_id
   ```
2. Check secret expiration in Azure Portal
3. Ensure admin consent was granted for Mail.Send permission

### Error: "The specified object was not found in the directory"
**Cause:** Sender email doesn't exist in your tenant

**Solution:**
1. Verify `SENDER_EMAIL` is a valid mailbox in your organization
2. Use your own email or a shared mailbox
3. Ensure email format is correct: `user@yourdomain.com`

## 🔍 Authentication Issues

### Error: "InvalidAuthenticationToken"
**Cause:** Incorrect tenant ID or expired secret

**Solution:**
1. Double-check your tenant ID in Azure Portal
2. Verify client secret hasn't expired
3. Regenerate client secret if needed

### Testing Authentication
```bash
# Run verification to check all credentials
npm run verify

# Test with detailed logging
DEBUG=* npm test
```

## 📊 No Changes Detected

### Repository seems inactive
**Possible causes:**
- Looking at wrong time period
- Repository actually has no recent changes
- Date/time issues

**Solution:**
1. Check repository manually: [Recent commits](https://github.com/MicrosoftDocs/entra-docs/commits)
2. Verify your timezone settings
3. Test with a more active repository temporarily

## 🔄 Rate Limiting

### Error: "rate limit exceeded"
**Cause:** Too many API requests

**Solution:**
1. Authenticated requests have higher limits (5000/hour vs 60/hour)
2. Ensure `GITHUB_TOKEN` is properly set
3. Wait for rate limit reset if exceeded

## 🛠️ Development Issues

### Dependencies not installing
```bash
# Clear cache and reinstall
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Environment variables not loading
```bash
# Ensure .env file exists and has correct format
cat .env

# Check file permissions
ls -la .env
```

## 📋 Debug Commands

```bash
# Full environment check
npm run verify

# Test with detailed output
npm test

# Check installed packages
npm list --depth=0

# View recent commits manually
curl -H "Authorization: token YOUR_TOKEN" \
  "https://api.github.com/repos/MicrosoftDocs/entra-docs/commits?per_page=5"
```

## 🆘 Getting Help

1. **Check GitHub Actions logs**: Repository → Actions tab → View failed run
2. **Enable debug mode**: Add `DEBUG=*` before npm commands
3. **Verify setup**: Run `npm run verify` to check all components
4. **Test incrementally**: Start with GitHub API only, then add email functionality

## 📚 Useful Links

- [GitHub Personal Access Tokens](https://github.com/settings/tokens)
- [Azure App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps)
- [Microsoft Graph Permissions](https://docs.microsoft.com/en-us/graph/permissions-reference)
- [GitHub API Documentation](https://docs.github.com/en/rest)

---

**💡 Pro Tip**: Always test locally with `npm test` before deploying to GitHub Actions!
