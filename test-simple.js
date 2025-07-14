#!/usr/bin/env node

// Simple test of git operations
require('dotenv').config();
const simpleGit = require('simple-git');

async function testGitOps() {
  console.log('🔍 Testing git operations for monitoring...\n');
  
  const repoPath = process.env.LOCAL_REPO_PATH;
  console.log(`📁 Repository: ${repoPath}`);
  
  try {
    const git = simpleGit(repoPath);
    
    // Test 1: Get recent commits
    console.log('\n1️⃣ Testing commit retrieval...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const commits = await git.log({
      '--since': yesterday.toISOString().split('T')[0]
    });
    
    console.log(`   Found ${commits.all.length} commits since yesterday`);
    
    if (commits.all.length > 0) {
      console.log('   Latest commit:', commits.all[0].message.slice(0, 50) + '...');
      
      // Test 2: Analyze a commit
      console.log('\n2️⃣ Testing commit analysis...');
      const hash = commits.all[0].hash;
      
      const diffResult = await git.show([hash, '--name-status']);
      console.log('   Diff analysis successful:', diffResult.split('\n').length, 'lines');
      
      // Test 3: Check for markdown files
      const markdownMatch = diffResult.match(/\.md$/gm);
      console.log('   Markdown files in commit:', markdownMatch ? markdownMatch.length : 0);
      
    } else {
      console.log('   No commits found - testing with older timeframe...');
      
      const older = new Date();
      older.setDate(older.getDate() - 7);
      
      const olderCommits = await git.log({
        '--since': older.toISOString().split('T')[0],
        '-n': '5'
      });
      
      console.log(`   Found ${olderCommits.all.length} commits in last week`);
    }
    
    console.log('\n✅ All git operations working correctly!');
    console.log('🎉 Your monitoring system is ready to deploy!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testGitOps().catch(console.error);
