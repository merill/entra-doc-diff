const EntraDocsMonitor = require('./monitor-docs');

// Test configuration for local development
require('dotenv').config();

async function testMonitor() {
  console.log('🧪 Testing Entra Docs Monitor locally...\n');
  
  // Check environment variables
  const requiredEnvs = ['LOCAL_REPO_PATH', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID'];
  const optionalEnvs = ['RECIPIENT_EMAIL', 'SENDER_EMAIL'];
  
  console.log('🔍 Environment Check:');
  requiredEnvs.forEach(env => {
    console.log(`  ${env}: ${process.env[env] ? '✅ Set' : '❌ Missing'}`);
  });
  
  optionalEnvs.forEach(env => {
    console.log(`  ${env}: ${process.env[env] ? '✅ Set' : '⚠️ Not set (email disabled)'}`);
  });
  
  console.log('\n');
  
  // Override recipient for testing
  if (!process.env.RECIPIENT_EMAIL) {
    process.env.RECIPIENT_EMAIL = 'test@example.com';
  }
  
  const monitor = new EntraDocsMonitor();
  
  try {
    await monitor.run();
    console.log('\n✅ Test completed successfully!');
    console.log('📁 Check the ./reports/ directory for generated files');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

testMonitor();
