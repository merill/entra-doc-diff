#!/usr/bin/env node

// Quick verification script to check your local setup
require('dotenv').config();

console.log('🔍 Entra Docs Monitor - Local Setup Verification\n');

// Check Node.js version
console.log(`📦 Node.js version: ${process.version}`);

// Check environment variables
const checks = [
  { name: 'LOCAL_REPO_PATH', required: false, env: process.env.LOCAL_REPO_PATH },
  { name: 'AZURE_CLIENT_ID', required: false, env: process.env.AZURE_CLIENT_ID },
  { name: 'AZURE_CLIENT_SECRET', required: false, env: process.env.AZURE_CLIENT_SECRET },
  { name: 'AZURE_TENANT_ID', required: false, env: process.env.AZURE_TENANT_ID },
  { name: 'SENDER_EMAIL', required: false, env: process.env.SENDER_EMAIL },
  { name: 'RECIPIENT_EMAIL', required: false, env: process.env.RECIPIENT_EMAIL }
];

console.log('\n🔧 Environment Variables:');
let hasRequired = true;

checks.forEach(check => {
  const status = check.env ? '✅ Set' : (check.required ? '❌ Missing (Required)' : '⚠️  Not set (Optional)');
  console.log(`  ${check.name}: ${status}`);
  
  if (check.required && !check.env) {
    hasRequired = false;
  }
});

// Check dependencies
console.log('\n📚 Dependencies:');
try {
  require('simple-git');
  console.log('  simple-git: ✅ Installed');
} catch (e) {
  console.log('  simple-git: ❌ Missing - run npm install');
}

try {
  require('@microsoft/microsoft-graph-client');
  console.log('  @microsoft/microsoft-graph-client: ✅ Installed');
} catch (e) {
  console.log('  @microsoft/microsoft-graph-client: ❌ Missing - run npm install');
}

try {
  require('@azure/msal-node');
  console.log('  @azure/msal-node: ✅ Installed');
} catch (e) {
  console.log('  @azure/msal-node: ❌ Missing - run npm install');
}

// Provide next steps
console.log('\n🚀 Next Steps:');
if (!hasRequired) {
  console.log('  1. Edit .env file and add your GITHUB_TOKEN');
  console.log('  2. Get token from: https://github.com/settings/tokens');
  console.log('  3. Select "public_repo" scope');
} else {
  console.log('  ✅ Ready to test! Run: npm test');
  
  if (!process.env.AZURE_CLIENT_ID) {
    console.log('  📧 For email testing, add Microsoft Graph credentials to .env');
    console.log('     - AZURE_CLIENT_ID (from Entra ID app registration)');
    console.log('     - AZURE_CLIENT_SECRET (from Entra ID app registration)');
    console.log('     - AZURE_TENANT_ID (your tenant ID)');
    console.log('     - SENDER_EMAIL (authorized email address)');
  }
}

console.log('\n💡 Commands:');
console.log('  npm test    - Test with current setup');
console.log('  npm start   - Full production run');
console.log('  node verify.js - Run this verification again');
