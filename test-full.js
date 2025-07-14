#!/usr/bin/env node

// Test the full monitoring without sending emails
require('dotenv').config();
const EntraDocsMonitor = require('./src/monitor-docs');

async function testMonitoringDryRun() {
  console.log('🧪 Testing Entra Docs Monitor (dry run - no emails)...\n');
  
  try {
    // Override email sending for testing
    process.env.DRY_RUN = 'true';
    
    const monitor = new EntraDocsMonitor();
    
    console.log('🚀 Starting monitoring test...');
    await monitor.run();
    
    console.log('\n✅ Monitoring test completed successfully!');
    console.log('🎉 Your automation is ready to run!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testMonitoringDryRun().catch(console.error);
