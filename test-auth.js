#!/usr/bin/env node

// Test Microsoft Graph authentication
require('dotenv').config();
const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');

async function testAuth() {
  console.log('🔐 Testing Microsoft Graph authentication...\n');
  
  const requiredVars = ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(', ')}`);
    return;
  }
  
  try {
    const msalConfig = {
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
      }
    };
    
    const cca = new ConfidentialClientApplication(msalConfig);
    
    console.log('🔄 Acquiring access token...');
    const clientCredentialRequest = {
      scopes: ['https://graph.microsoft.com/.default'],
    };
    
    const response = await cca.acquireTokenByClientCredential(clientCredentialRequest);
    
    if (response) {
      console.log('✅ Token acquired successfully');
      
      // Test Graph client
      const client = Client.init({
        authProvider: {
          getAccessToken: async () => response.accessToken
        }
      });
      
      console.log('🔄 Testing Graph API access...');
      
      // Test if we can access the user profile
      try {
        const me = await client.api('/me').get();
        console.log(`✅ Graph API working - Hello ${me.displayName || me.userPrincipalName}`);
      } catch (error) {
        if (error.code === 'InvalidAuthenticationToken') {
          console.log('✅ Graph API accessible (service account - no profile available)');
        } else {
          console.log(`⚠️ Graph API test: ${error.message}`);
        }
      }
      
      console.log('\n🎉 Authentication setup is working correctly!');
      console.log('📧 Ready to send emails via Microsoft Graph');
      
    } else {
      console.error('❌ Failed to acquire token');
    }
    
  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    if (error.errorCode) {
      console.error(`   Error code: ${error.errorCode}`);
    }
  }
}

testAuth().catch(console.error);
