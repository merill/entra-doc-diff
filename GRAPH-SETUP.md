# 🔐 Microsoft Graph Email Setup Guide

This guide will help you set up an Entra ID app registration to send emails via Microsoft Graph instead of SendGrid.

## 📋 Prerequisites

- Access to an Azure/Microsoft 365 tenant
- Global Administrator or Application Administrator role
- Access to the [Azure Portal](https://portal.azure.com)

## 🚀 Step 1: Create an App Registration

1. **Navigate to Azure Portal**
   - Go to [Azure Portal](https://portal.azure.com)
   - Search for "App registrations" or go to **Azure Active Directory > App registrations**

2. **Create New Registration**
   - Click **"+ New registration"**
   - Fill in the details:
     - **Name**: `Entra Docs Monitor`
     - **Supported account types**: `Accounts in this organizational directory only`
     - **Redirect URI**: Leave blank (not needed for daemon apps)
   - Click **"Register"**

3. **Copy Important Values**
   After registration, copy these values to your `.env` file:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`

## 🔑 Step 2: Create a Client Secret

1. **Navigate to Certificates & secrets**
   - In your app registration, go to **"Certificates & secrets"**
   
2. **Create New Secret**
   - Click **"+ New client secret"**
   - Add description: `Entra Docs Monitor Secret`
   - Choose expiration: `24 months` (recommended)
   - Click **"Add"**

3. **Copy Secret Value**
   - **Important**: Copy the secret **VALUE** immediately (it won't be shown again)
   - Add this to your `.env` file as `AZURE_CLIENT_SECRET`

## 🔒 Step 3: Configure API Permissions

1. **Navigate to API permissions**
   - In your app registration, go to **"API permissions"**

2. **Add Microsoft Graph Permissions**
   - Click **"+ Add a permission"**
   - Select **"Microsoft Graph"**
   - Choose **"Application permissions"** (not Delegated)
   - Search for and add: **`Mail.Send`**
   - Click **"Add permissions"**

3. **Grant Admin Consent**
   - Click **"Grant admin consent for [Your Organization]"**
   - Confirm by clicking **"Yes"**
   - Ensure the status shows **"Granted for [Your Organization]"** with a green checkmark

## 📧 Step 4: Configure Sender Email

The sender email must be:
- A valid mailbox in your organization
- The app will send emails "on behalf of" this user
- Add this email to your `.env` file as `SENDER_EMAIL`

**Common options:**
- Your own email address
- A shared mailbox (e.g., `notifications@yourdomain.com`)
- A service account email

## 🔧 Step 5: Update Environment Variables

Update your `.env` file with the values from above:

```bash
# Required: GitHub token for API access
GITHUB_TOKEN=your_github_token_here

# Required: Microsoft Graph/Entra ID app configuration
AZURE_CLIENT_ID=12345678-1234-1234-1234-123456789012
AZURE_CLIENT_SECRET=your_secret_value_here
AZURE_TENANT_ID=87654321-4321-4321-4321-210987654321
SENDER_EMAIL=your-authorized-email@yourdomain.com
RECIPIENT_EMAIL=merill@merill.net
```

## 🧪 Step 6: Test the Setup

1. **Install new dependencies**:
   ```bash
   npm install
   ```

2. **Verify configuration**:
   ```bash
   npm run verify
   ```

3. **Run a test**:
   ```bash
   npm test
   ```

## 🚨 Troubleshooting

### Common Issues:

**❌ "Insufficient privileges to complete the operation"**
- Ensure you granted admin consent for Mail.Send permission
- Check that you're using Application permissions, not Delegated

**❌ "Forbidden" or "401 Unauthorized"**
- Verify your client ID, secret, and tenant ID are correct
- Ensure the secret hasn't expired
- Check that admin consent was granted

**❌ "InvalidAuthenticationToken"**
- Double-check your tenant ID
- Ensure you're using the correct client secret value

**❌ "The specified object was not found in the directory"**
- Verify the sender email exists in your tenant
- Ensure the sender email is properly formatted

### Debug Steps:

1. **Check app registration**:
   - Go to Azure Portal > App registrations
   - Verify permissions show "Granted" status
   - Check that client secret is not expired

2. **Test authentication**:
   ```bash
   # Run verification script to check setup
   npm run verify
   ```

3. **Review logs**:
   - Check the console output for detailed error messages
   - Look for authentication vs. permission errors

## 🔐 Security Best Practices

1. **Limit permissions**: Only grant Mail.Send, don't add unnecessary permissions
2. **Rotate secrets**: Set calendar reminders to rotate client secrets before expiry
3. **Monitor usage**: Use Azure AD audit logs to monitor app usage
4. **Restrict access**: Consider Conditional Access policies if needed

## 📚 Additional Resources

- [Microsoft Graph Mail API Documentation](https://docs.microsoft.com/en-us/graph/api/resources/mail-api-overview)
- [App Registration Best Practices](https://docs.microsoft.com/en-us/azure/active-directory/develop/security-best-practices-for-app-registration)
- [Microsoft Graph Permissions Reference](https://docs.microsoft.com/en-us/graph/permissions-reference)

---

**🎉 Once configured, your Entra Docs Monitor will send beautiful email reports via Microsoft Graph!**
