#!/usr/bin/env node

// Quick test of the git-based monitoring
require('dotenv').config();
const simpleGit = require('simple-git');
const path = require('path');

async function quickTest() {
  console.log('🧪 Quick test of git monitoring...\n');
  
  const repoPath = process.env.LOCAL_REPO_PATH;
  console.log(`📁 Repository: ${repoPath}`);
  
  if (!repoPath) {
    console.error('❌ LOCAL_REPO_PATH not set');
    return;
  }
  
  try {
    const git = simpleGit(repoPath);
    
    // Get commits from last 3 days to ensure we have some data
    const since = new Date();
    since.setDate(since.getDate() - 3);
    const sinceStr = since.toISOString().split('T')[0];
    
    console.log(`🔍 Looking for commits since ${sinceStr}...`);
    
    const commits = await git.log({
      '--since': sinceStr,
      '--stat': null
    });
    
    console.log(`📊 Found ${commits.all.length} commits`);
    
    if (commits.all.length > 0) {
      console.log('\n📝 Recent commits:');
      commits.all.slice(0, 5).forEach((commit, index) => {
        console.log(`  ${index + 1}. ${commit.message.slice(0, 60)}...`);
        console.log(`     Author: ${commit.author_name}`);
        console.log(`     Date: ${commit.date}`);
        console.log('');
      });
      
      // Test analyzing one commit
      console.log('🔬 Analyzing most recent commit...');
      const latestCommit = commits.all[0];
      const diffSummary = await git.show([latestCommit.hash, '--stat']);
      
      console.log('\n📈 Diff summary:');
      console.log(diffSummary.slice(0, 500) + (diffSummary.length > 500 ? '...' : ''));
      
      console.log('\n✅ Git operations working correctly!');
    } else {
      console.log('⚠️ No commits found in the last 3 days');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

quickTest().catch(console.error);
