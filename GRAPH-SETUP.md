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

## ✉️ Step 4: Keep Monitor Reports Unencrypted

The monitor sends each Graph message with `sensitivity: normal` and these custom headers:

```text
x-entra-docs-monitor: daily-report
x-entra-docs-encryption: none
```

`normal` is Microsoft Graph's explicit no-sensitivity value. Graph doesn't provide `none` or `public` message-sensitivity values. This prevents the message itself from requesting a personal, private, or confidential Outlook sensitivity, but it can't override encryption that Microsoft Purview or an Exchange Online mail flow rule applies after Graph accepts the message.

If your organization automatically encrypts these reports, configure Exchange Online so that the monitor message is exempt:

1. In the Exchange admin center, go to **Mail flow** > **Rules**.
2. Locate the rule that applies Microsoft Purview Message Encryption and add an exception for the mailbox configured as `SENDER_EMAIL`.
3. If a sender-only exception is too broad, instead create a narrowly scoped rule that requires both:
   - The sender is the mailbox configured as `SENDER_EMAIL`.
   - The `x-entra-docs-encryption` header contains `none`.
4. Use **Remove Office 365 Message Encryption and rights protection applied by the organization** as the action. Make sure the removal rule runs after the rule that adds encryption and that an earlier rule doesn't stop rule processing.
5. Send a test report and confirm in message trace that no encryption or rights-protection rule was applied.

Always scope the exception to the authenticated monitor sender. Don't exempt messages based only on a custom header, because an external sender could spoof it.
