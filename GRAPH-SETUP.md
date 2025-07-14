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


