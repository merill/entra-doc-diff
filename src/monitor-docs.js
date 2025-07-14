// Load environment variables from .env file
require('dotenv').config();

const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const moment = require('moment-timezone');
const { parse } = require('node-html-parser');
const diff = require('diff');

class EntraDocsMonitor {
  constructor() {
    this.targetRepo = { 
      owner: process.env.TARGET_REPO_OWNER || 'MicrosoftDocs', 
      repo: process.env.TARGET_REPO_NAME || 'entra-docs' 
    };
    this.recipientEmail = process.env.RECIPIENT_EMAIL || 'merill@merill.net';
    this.senderEmail = process.env.SENDER_EMAIL || 'entra-docs-monitor@yourdomain.com';
    
    // Repository paths
    this.localRepoPath = process.env.LOCAL_REPO_PATH || './temp-repo';
    this.isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    
    // Microsoft Graph configuration
    this.msalConfig = {
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
      }
    };
    
    this.graphClient = null;
    
    // Ensure reports directory exists
    this.ensureReportsDir();
  }

  async ensureReportsDir() {
    try {
      await fs.mkdir('reports', { recursive: true });
      await fs.mkdir('website', { recursive: true });
    } catch (error) {
      console.log('Reports and website directories already exist or created');
    }
  }

  // Generate public documentation URL for docs files
  generatePublicDocsUrl(filename) {
    // Check if the file is in the docs folder and is a markdown file
    if (filename.startsWith('docs/') && filename.endsWith('.md')) {
      // Remove 'docs/' prefix and '.md' extension
      const pathWithoutDocsPrefix = filename.substring(5); // Remove 'docs/'
      const pathWithoutExtension = pathWithoutDocsPrefix.replace(/\.md$/, '');
      
      // Convert to learn.microsoft.com URL
      return `https://learn.microsoft.com/en-us/entra/${pathWithoutExtension}`;
    }
    
    // Return null for non-docs files
    return null;
  }

  async initializeGraphClient() {
    if (this.graphClient) return this.graphClient;

    if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
      console.log('⚠️ Microsoft Graph credentials not configured, skipping email send');
      return null;
    }

    try {
      // Create MSAL instance
      const clientApp = new ConfidentialClientApplication(this.msalConfig);
      
      // Get access token using client credentials flow
      const clientCredentialRequest = {
        scopes: ['https://graph.microsoft.com/.default'],
      };

      const response = await clientApp.acquireTokenByClientCredential(clientCredentialRequest);
      
      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire access token');
      }

      // Create Graph client with access token
      this.graphClient = Client.init({
        authProvider: (done) => {
          done(null, response.accessToken);
        }
      });

      console.log('✅ Microsoft Graph client initialized successfully');
      return this.graphClient;
      
    } catch (error) {
      console.error('❌ Error initializing Microsoft Graph client:', error.message);
      return null;
    }
  }

  async setupRepository() {
    try {
      if (this.isGitHubActions) {
        // In GitHub Actions, the repo will be cloned by the workflow
        this.localRepoPath = './entra-docs';
        console.log(`📁 Using GitHub Actions cloned repository at: ${this.localRepoPath}`);
      } else {
        // For local development, use the specified path
        console.log(`📁 Using local repository at: ${this.localRepoPath}`);
      }

      // Verify the repository exists
      const repoExists = await this.checkRepositoryExists();
      if (!repoExists) {
        throw new Error(`Repository not found at: ${this.localRepoPath}`);
      }

      // Initialize git client
      this.git = simpleGit(this.localRepoPath);
      
      // Update repository (pull latest changes)
      console.log('🔄 Updating repository...');
      await this.git.fetch();
      await this.git.pull();
      
      console.log('✅ Repository setup complete');
      return true;
      
    } catch (error) {
      console.error('❌ Error setting up repository:', error.message);
      throw error;
    }
  }

  async checkRepositoryExists() {
    try {
      const stats = await fs.stat(this.localRepoPath);
      const gitDir = await fs.stat(path.join(this.localRepoPath, '.git'));
      return stats.isDirectory() && gitDir.isDirectory();
    } catch (error) {
      return false;
    }
  }

  async getCommitsLastDay() {
    const since = moment().subtract(24, 'hours').toISOString();
    
    console.log(`🔍 Fetching commits since: ${since}`);
    
    try {
      // Get commits from the last 24 hours
      const commits = await this.git.log({
        '--since': since,
        format: {
          hash: '%H',
          date: '%ai',
          message: '%s',
          author_name: '%an',
          author_email: '%ae'
        }
      });
      
      console.log(`📊 Found ${commits.all.length} commits in the last 24 hours`);
      return commits.all;
    } catch (error) {
      console.error('❌ Error fetching commits:', error.message);
      throw error;
    }
  }

  async getCommitDetails(commitHash) {
    try {
      const commitDetails = await this.git.show([
        '--name-status',
        '--format=fuller',
        commitHash
      ]);
      
      return this.parseCommitDetails(commitDetails, commitHash);
    } catch (error) {
      console.error(`❌ Error fetching commit details for ${commitHash}:`, error.message);
      return null;
    }
  }

  parseCommitDetails(gitOutput, commitHash) {
    const lines = gitOutput.split('\n');
    const files = [];
    let inFileSection = false;
    
    for (const line of lines) {
      if (line.trim() === '') {
        inFileSection = true;
        continue;
      }
      
      if (inFileSection && line.match(/^[AMD]\s+/)) {
        const [status, filename] = line.split('\t');
        
        // Only include markdown files in docs directory
        if (filename.endsWith('.md') && filename.includes('docs/')) {
          files.push({
            filename: filename,
            status: this.mapGitStatus(status),
            commitHash: commitHash
          });
        }
      }
    }
    
    return { files };
  }

  mapGitStatus(gitStatus) {
    switch (gitStatus) {
      case 'A': return 'added';
      case 'M': return 'modified';
      case 'D': return 'removed';
      default: return 'modified';
    }
  }

  async getFileDiff(filename, commitHash) {
    try {
      const diff = await this.git.show([
        '--format=',
        commitHash,
        '--',
        filename
      ]);
      
      return diff;
    } catch (error) {
      console.error(`❌ Error getting diff for ${filename}:`, error.message);
      return '';
    }
  }

  async analyzeChanges(commits) {
    const analysis = {
      newFiles: [],
      modifiedFiles: [],
      deletedFiles: [],
      summary: {
        totalCommits: commits.length,
        totalFiles: 0,
        authors: new Set()
      }
    };

    console.log('🔍 Analyzing file changes...');

    for (const commit of commits) {
      analysis.summary.authors.add(commit.author_name);
      
      const commitDetails = await this.getCommitDetails(commit.hash);
      if (!commitDetails || !commitDetails.files) continue;

      for (const file of commitDetails.files) {
        // Get file diff for change analysis
        const fileDiff = await this.getFileDiff(file.filename, commit.hash);
        const { additions, deletions } = this.countChanges(fileDiff);

        const fileInfo = {
          filename: file.filename,
          status: file.status,
          additions: additions,
          deletions: deletions,
          changes: additions + deletions,
          patch: fileDiff,
          commitSha: commit.hash,
          commitMessage: commit.message,
          commitAuthor: commit.author_name,
          commitDate: commit.date,
          githubUrl: `https://github.com/${this.targetRepo.owner}/${this.targetRepo.repo}/blob/main/${file.filename}`,
          publicDocsUrl: this.generatePublicDocsUrl(file.filename)
        };

        switch (file.status) {
          case 'added':
            analysis.newFiles.push(fileInfo);
            break;
          case 'modified':
            analysis.modifiedFiles.push(fileInfo);
            break;
          case 'removed':
            analysis.deletedFiles.push(fileInfo);
            break;
        }
        
        analysis.summary.totalFiles++;
      }
    }

    // Remove duplicates and sort by importance
    analysis.newFiles = this.deduplicateFiles(analysis.newFiles);
    analysis.modifiedFiles = this.deduplicateFiles(analysis.modifiedFiles);
    analysis.deletedFiles = this.deduplicateFiles(analysis.deletedFiles);

    console.log(`📈 Analysis complete: ${analysis.newFiles.length} new, ${analysis.modifiedFiles.length} modified, ${analysis.deletedFiles.length} deleted`);
    
    return analysis;
  }

  countChanges(diff) {
    if (!diff) return { additions: 0, deletions: 0 };
    
    const lines = diff.split('\n');
    let additions = 0;
    let deletions = 0;
    
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
    
    return { additions, deletions };
  }

  deduplicateFiles(files) {
    const seen = new Map();
    
    for (const file of files) {
      if (!seen.has(file.filename) || file.changes > seen.get(file.filename).changes) {
        seen.set(file.filename, file);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => b.changes - a.changes);
  }

  extractChangesSummary(patch, filename) {
    if (!patch) return 'No detailed changes available';

    const lines = patch.split('\n');
    const changes = [];
    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('@@')) {
        currentSection = line;
        continue;
      }
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const addition = line.substring(1).trim();
        if (addition && addition.length > 10) {
          changes.push({ type: 'added', content: addition });
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const deletion = line.substring(1).trim();
        if (deletion && deletion.length > 10) {
          changes.push({ type: 'removed', content: deletion });
        }
      }
    }

    // Limit to most significant changes
    const significantChanges = changes
      .filter(change => change.content.length > 20)
      .slice(0, 5);

    if (significantChanges.length === 0) {
      return 'Minor formatting or content adjustments';
    }

    return significantChanges.map(change => {
      const prefix = change.type === 'added' ? '+ ' : '- ';
      const truncated = change.content.length > 100 
        ? change.content.substring(0, 100) + '...' 
        : change.content;
      return `${prefix}${truncated}`;
    }).join('\n');
  }

  // Generate side-by-side diff view for HTML
  generateSideBySideDiff(patch) {
    if (!patch) return '<div class="no-diff">No detailed changes available</div>';

    const lines = patch.split('\n');
    const beforeLines = [];
    const afterLines = [];
    const contextLines = [];
    
    let currentLineNumber = 0;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Extract line numbers from hunk header
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          currentLineNumber = parseInt(match[1]);
        }
        continue;
      }
      
      if (line.startsWith('+++') || line.startsWith('---')) {
        continue;
      }
      
      const content = line.substring(1); // Remove the first character (+, -, or space)
      
      if (line.startsWith(' ')) {
        // Context line (unchanged)
        beforeLines.push({ type: 'context', content, lineNum: currentLineNumber });
        afterLines.push({ type: 'context', content, lineNum: currentLineNumber });
        currentLineNumber++;
      } else if (line.startsWith('-')) {
        // Deleted line
        beforeLines.push({ type: 'deleted', content, lineNum: currentLineNumber });
        currentLineNumber++;
      } else if (line.startsWith('+')) {
        // Added line
        afterLines.push({ type: 'added', content });
      }
    }
    
    // Ensure both sides have the same number of lines for alignment
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    while (beforeLines.length < maxLines) {
      beforeLines.push({ type: 'empty', content: '', lineNum: '' });
    }
    while (afterLines.length < maxLines) {
      afterLines.push({ type: 'empty', content: '', lineNum: '' });
    }
    
    let diffHtml = `
      <div class="diff-container">
        <div class="diff-header">
          <div class="diff-label before-label">Before</div>
          <div class="diff-label after-label">After</div>
        </div>
        <div class="diff-content">
          <div class="diff-pane before-pane">
    `;
    
    // Generate before pane
    for (const line of beforeLines.slice(0, 20)) { // Limit to 20 lines for readability
      const cssClass = line.type === 'deleted' ? 'diff-deleted' : 
                      line.type === 'context' ? 'diff-context' : 'diff-empty';
      const escapedContent = this.escapeHtml(line.content);
      diffHtml += `<div class="diff-line ${cssClass}">${escapedContent || '&nbsp;'}</div>`;
    }
    
    diffHtml += `
          </div>
          <div class="diff-pane after-pane">
    `;
    
    // Generate after pane
    for (const line of afterLines.slice(0, 20)) { // Limit to 20 lines for readability
      const cssClass = line.type === 'added' ? 'diff-added' : 
                      line.type === 'context' ? 'diff-context' : 'diff-empty';
      const escapedContent = this.escapeHtml(line.content);
      diffHtml += `<div class="diff-line ${cssClass}">${escapedContent || '&nbsp;'}</div>`;
    }
    
    diffHtml += `
          </div>
        </div>
      </div>
    `;
    
    return diffHtml;
  }

  // Helper function to escape HTML
  escapeHtml(text) {
    const div = { innerHTML: '' };
    if (typeof text === 'string') {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    return text;
  }

  generateHtmlReport(analysis) {
    const reportDate = moment().tz('America/Los_Angeles').format('MMMM Do YYYY, h:mm A z');
    const targetDate = moment().subtract(24, 'hours').tz('America/Los_Angeles').format('MMMM Do YYYY, h:mm A z');
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #0078d4, #106ebe); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header h1 a { color: white; text-decoration: none; transition: opacity 0.2s; }
        .header h1 a:hover { opacity: 0.8; text-decoration: underline; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #0078d4; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .summary-item { text-align: center; }
        .summary-item .number { font-size: 24px; font-weight: bold; color: #0078d4; }
        .summary-item .label { font-size: 14px; color: #666; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #0078d4; border-bottom: 2px solid #e1e5e9; padding-bottom: 10px; }
        .file-item { background: white; border: 1px solid #e1e5e9; border-radius: 6px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .file-header { background: #f6f8fa; padding: 15px; border-bottom: 1px solid #e1e5e9; }
        .file-name { font-weight: bold; color: #0078d4; margin-bottom: 5px; }
        .file-name a { color: #0078d4; text-decoration: none; }
        .file-name a:hover { text-decoration: underline; }
        .file-meta { font-size: 12px; color: #666; }
        .file-changes { padding: 15px; }
        .change-stats { background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 14px; }
        .additions { color: #28a745; }
        .deletions { color: #dc3545; }
        .changes-detail { background: #f6f8fa; padding: 12px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
        .new-badge { background: #28a745; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .modified-badge { background: #ffc107; color: #212529; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .deleted-badge { background: #dc3545; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .no-changes { text-align: center; color: #666; font-style: italic; padding: 40px; }
        .footer { margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; font-size: 14px; color: #666; }
        
        /* Diff view styles */
        .diff-container { margin-top: 15px; border: 1px solid #e1e5e9; border-radius: 6px; overflow: hidden; background: white; }
        .diff-header { display: grid; grid-template-columns: 1fr 1fr; background: #f6f8fa; border-bottom: 1px solid #e1e5e9; }
        .diff-label { padding: 10px 15px; font-weight: bold; text-align: center; font-size: 14px; }
        .before-label { color: #d73a49; border-right: 1px solid #e1e5e9; }
        .after-label { color: #28a745; }
        .diff-content { display: grid; grid-template-columns: 1fr 1fr; max-height: 400px; overflow-y: auto; }
        .diff-pane { font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.4; }
        .before-pane { border-right: 1px solid #e1e5e9; }
        .diff-line { padding: 2px 10px; white-space: pre-wrap; word-break: break-word; min-height: 18px; }
        .diff-context { background: #ffffff; }
        .diff-deleted { background: #ffeef0; color: #24292e; border-left: 3px solid #d73a49; }
        .diff-added { background: #f0fff4; color: #24292e; border-left: 3px solid #28a745; }
        .diff-empty { background: #f8f9fa; }
        .no-diff { padding: 15px; text-align: center; color: #666; font-style: italic; }
        
        @media (max-width: 768px) {
          .diff-content { grid-template-columns: 1fr; }
          .diff-header { grid-template-columns: 1fr; }
          .before-pane { border-right: none; border-bottom: 1px solid #e1e5e9; }
          .before-label { border-right: none; border-bottom: 1px solid #e1e5e9; }
        }
        @media (max-width: 600px) {
          body { padding: 10px; }
          .header { padding: 20px; }
          .summary-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1><a href="index.html" style="color: white; text-decoration: none;">📋 Microsoft Entra Documentation Changes</a></h1>
        <p>Daily summary for changes since ${targetDate}</p>
        <p>Report generated on ${reportDate}</p>
      </div>

      <div class="summary">
        <h3>📊 Summary</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="number">${analysis.summary.totalCommits}</div>
            <div class="label">Total Commits</div>
          </div>
          <div class="summary-item">
            <div class="number">${analysis.newFiles.length}</div>
            <div class="label">New Files</div>
          </div>
          <div class="summary-item">
            <div class="number">${analysis.modifiedFiles.length}</div>
            <div class="label">Modified Files</div>
          </div>
          <div class="summary-item">
            <div class="number">${analysis.deletedFiles.length}</div>
            <div class="label">Deleted Files</div>
          </div>
          <div class="summary-item">
            <div class="number">${analysis.summary.authors.size}</div>
            <div class="label">Contributors</div>
          </div>
        </div>
      </div>
    `;

    // New Files Section
    if (analysis.newFiles.length > 0) {
      html += `
      <div class="section">
        <h2>🆕 New Documentation Files</h2>
      `;
      
      for (const file of analysis.newFiles.slice(0, 10)) {
        html += `
        <div class="file-item">
          <div class="file-header">
            <div class="file-name">
              <span class="new-badge">NEW</span>
              <a href="${file.githubUrl}" target="_blank">${file.filename}</a>
            </div>
            <div class="file-meta">
              Added by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
              ${file.publicDocsUrl ? `<br><a href="${file.publicDocsUrl}" target="_blank" style="color: #0078d4;">📖 View on learn.microsoft.com</a>` : ''}
            </div>
          </div>
          <div class="file-changes">
            <div class="change-stats">
              <span class="additions">+${file.additions} lines added</span>
            </div>
            <div><strong>Commit:</strong> ${file.commitMessage}</div>
          </div>
        </div>
        `;
      }
      
      html += `</div>`;
    }

    // Modified Files Section
    if (analysis.modifiedFiles.length > 0) {
      html += `
      <div class="section">
        <h2>📝 Modified Documentation Files</h2>
      `;
      
      for (const file of analysis.modifiedFiles.slice(0, 15)) {
        const changesSummary = this.extractChangesSummary(file.patch, file.filename);
        const sideBySideDiff = this.generateSideBySideDiff(file.patch);
        
        html += `
        <div class="file-item">
          <div class="file-header">
            <div class="file-name">
              <span class="modified-badge">MODIFIED</span>
              <a href="${file.githubUrl}" target="_blank">${file.filename}</a>
            </div>
            <div class="file-meta">
              Modified by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
              ${file.publicDocsUrl ? `<br><a href="${file.publicDocsUrl}" target="_blank" style="color: #0078d4;">📖 View on learn.microsoft.com</a>` : ''}
            </div>
          </div>
          <div class="file-changes">
            <div class="change-stats">
              <span class="additions">+${file.additions}</span> / 
              <span class="deletions">-${file.deletions}</span> lines changed
            </div>
            <div><strong>Commit:</strong> ${file.commitMessage}</div>
            <div style="margin-top: 15px;"><strong>Changes:</strong></div>
            ${sideBySideDiff}
          </div>
        </div>
        `;
      }
      
      html += `</div>`;
    }

    // Deleted Files Section
    if (analysis.deletedFiles.length > 0) {
      html += `
      <div class="section">
        <h2>🗑️ Deleted Documentation Files</h2>
      `;
      
      for (const file of analysis.deletedFiles.slice(0, 10)) {
        html += `
        <div class="file-item">
          <div class="file-header">
            <div class="file-name">
              <span class="deleted-badge">DELETED</span>
              ${file.filename}
            </div>
            <div class="file-meta">
              Deleted by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
              ${file.publicDocsUrl ? `<br><span style="color: #888;">📖 Was available at: ${file.publicDocsUrl}</span>` : ''}
            </div>
          </div>
          <div class="file-changes">
            <div class="change-stats">
              <span class="deletions">-${file.deletions} lines removed</span>
            </div>
            <div><strong>Commit:</strong> ${file.commitMessage}</div>
          </div>
        </div>
        `;
      }
      
      html += `</div>`;
    }

    // No changes message
    if (analysis.summary.totalFiles === 0) {
      html += `
      <div class="no-changes">
        <h3>🎉 No documentation changes found in the last 24 hours</h3>
        <p>The Microsoft Entra documentation repository has been stable with no new commits affecting documentation files.</p>
      </div>
      `;
    }

    html += `
      <div class="footer">
        <p>🤖 This report was automatically generated by the Entra Docs Monitor</p>
        <p>📧 Delivered to ${this.recipientEmail}</p>
        <p>🔗 <a href="https://github.com/${this.targetRepo.owner}/${this.targetRepo.repo}" target="_blank">Visit Repository</a></p>
      </div>
    </body>
    </html>
    `;

    return html;
  }

  async saveReport(html, analysis) {
    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
    const dateForUrl = moment().format('YYYY-MM-DD');
    
    // Save to reports folder (backup)
    const htmlFilePath = path.join('reports', `entra-docs-report-${timestamp}.html`);
    const jsonFilePath = path.join('reports', `entra-docs-data-${timestamp}.json`);
    
    // Save to website folder for publishing
    const websiteHtmlPath = path.join('website', `${dateForUrl}.html`);
    const websiteJsonPath = path.join('website', `${dateForUrl}.json`);

    await fs.writeFile(htmlFilePath, html);
    await fs.writeFile(jsonFilePath, JSON.stringify(analysis, null, 2));
    await fs.writeFile(websiteHtmlPath, html);
    await fs.writeFile(websiteJsonPath, JSON.stringify(analysis, null, 2));

    console.log(`💾 Report saved: ${htmlFilePath}`);
    console.log(`🌐 Website report saved: ${websiteHtmlPath}`);
    
    // Generate/update index page
    await this.generateIndexPage();
    
    return {
      reportPath: htmlFilePath,
      websitePath: websiteHtmlPath,
      dateForUrl: dateForUrl
    };
  }

  async generateIndexPage() {
    try {
      const websiteDir = 'website';
      const files = await fs.readdir(websiteDir);
      
      // Filter for HTML files (exclude index.html) and sort by date descending
      const htmlFiles = files
        .filter(file => file.endsWith('.html') && file !== 'index.html')
        .sort((a, b) => b.localeCompare(a)); // Descending order
      
      const reports = [];
      
      // Read summary data for each report
      for (const htmlFile of htmlFiles.slice(0, 30)) { // Limit to last 30 days
        const dateStr = htmlFile.replace('.html', '');
        const jsonFile = `${dateStr}.json`;
        const jsonPath = path.join(websiteDir, jsonFile);
        
        try {
          const data = await fs.readFile(jsonPath, 'utf-8');
          const analysis = JSON.parse(data);
          reports.push({
            date: dateStr,
            htmlFile: htmlFile,
            analysis: analysis
          });
        } catch (error) {
          // If JSON file doesn't exist, create basic entry
          reports.push({
            date: dateStr,
            htmlFile: htmlFile,
            analysis: { newFiles: [], modifiedFiles: [], deletedFiles: [] }
          });
        }
      }
      
      // Generate index HTML
      const indexHtml = this.generateIndexHtml(reports);
      const indexPath = path.join(websiteDir, 'index.html');
      
      await fs.writeFile(indexPath, indexHtml);
      console.log(`📄 Index page generated: ${indexPath}`);
      
    } catch (error) {
      console.error('❌ Error generating index page:', error.message);
    }
  }

  generateIndexHtml(reports) {
    const now = moment();
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Microsoft Entra Documentation Changes</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #0078d4, #106ebe); color: white; padding: 40px; border-radius: 12px; margin-bottom: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 32px; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 18px; }
        .report-grid { display: grid; gap: 20px; margin-bottom: 40px; }
        .report-card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #0078d4; transition: transform 0.2s; }
        .report-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        .report-date { font-size: 20px; font-weight: bold; color: #0078d4; margin-bottom: 10px; }
        .report-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 15px; }
        .summary-item { text-align: center; }
        .summary-number { font-size: 24px; font-weight: bold; color: #0078d4; }
        .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .new-files { color: #28a745; }
        .modified-files { color: #ffc107; }
        .deleted-files { color: #dc3545; }
        .view-link { display: inline-block; background: #0078d4; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none; font-weight: bold; transition: background 0.2s; }
        .view-link:hover { background: #106ebe; }
        .footer { text-align: center; color: #666; margin-top: 40px; padding: 20px; background: white; border-radius: 8px; }
        .no-reports { text-align: center; color: #666; font-style: italic; padding: 40px; background: white; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📋 Microsoft Entra Documentation Changes</h1>
        <p>Daily monitoring of documentation updates</p>
        <p>Last updated: ${now.format('MMMM Do YYYY, h:mm A')}</p>
      </div>
    `;
    
    if (reports.length === 0) {
      html += `
        <div class="no-reports">
          <h2>No reports available yet</h2>
          <p>Daily reports will appear here once the monitoring starts.</p>
        </div>
      `;
    } else {
      html += `<div class="report-grid">`;
      
      for (const report of reports) {
        const reportDate = moment(report.date).format('MMMM Do, YYYY');
        const analysis = report.analysis;
        
        html += `
          <div class="report-card">
            <div class="report-date">${reportDate}</div>
            <div class="report-summary">
              <div class="summary-item">
                <div class="summary-number new-files">${analysis.newFiles.length}</div>
                <div class="summary-label">New Files</div>
              </div>
              <div class="summary-item">
                <div class="summary-number modified-files">${analysis.modifiedFiles.length}</div>
                <div class="summary-label">Modified Files</div>
              </div>
              <div class="summary-item">
                <div class="summary-number deleted-files">${analysis.deletedFiles.length}</div>
                <div class="summary-label">Deleted Files</div>
              </div>
            </div>
            <div>
              <a href="${report.htmlFile}" class="view-link">View Full Report</a>
            </div>
          </div>
        `;
      }
      
      html += `</div>`;
    }
    
    html += `
      <div class="footer">
        <p>Generated by <strong>Microsoft Entra Documentation Monitor</strong></p>
        <p>Monitoring repository: <a href="https://github.com/MicrosoftDocs/entra-docs">MicrosoftDocs/entra-docs</a></p>
      </div>
    </body>
    </html>
    `;
    
    return html;
  }

  generateEmailHtml(analysis, websiteLink) {
    const reportDate = moment().tz('America/Los_Angeles').format('MMMM Do YYYY, h:mm A z');
    const targetDate = moment().subtract(24, 'hours').tz('America/Los_Angeles').format('MMMM Do YYYY, h:mm A z');
    
    let emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #333;">
        <div style="background: #0078d4; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">📋 Microsoft Entra Documentation Changes</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Daily summary for changes since ${targetDate}</p>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">Report generated on ${reportDate}</p>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${websiteLink}" style="display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">🌐 View Online Report</a>
          </div>
        </div>

        <div style="background: #f8f9fa; padding: 20px; margin-top: 20px; border-radius: 8px; border-left: 4px solid #0078d4;">
          <h3 style="margin-top: 0; color: #0078d4;">📊 Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="text-align: center; padding: 10px;"><strong style="font-size: 24px; color: #0078d4;">${analysis.summary.totalCommits}</strong><br><small>Total Commits</small></td>
              <td style="text-align: center; padding: 10px;"><strong style="font-size: 24px; color: #28a745;">${analysis.newFiles.length}</strong><br><small>New Files</small></td>
              <td style="text-align: center; padding: 10px;"><strong style="font-size: 24px; color: #ffc107;">${analysis.modifiedFiles.length}</strong><br><small>Modified Files</small></td>
              <td style="text-align: center; padding: 10px;"><strong style="font-size: 24px; color: #dc3545;">${analysis.deletedFiles.length}</strong><br><small>Deleted Files</small></td>
              <td style="text-align: center; padding: 10px;"><strong style="font-size: 24px; color: #0078d4;">${analysis.summary.authors.size}</strong><br><small>Contributors</small></td>
            </tr>
          </table>
        </div>
    `;

    // New Files Section
    if (analysis.newFiles.length > 0) {
      emailHtml += `
        <div style="margin-top: 30px;">
          <h2 style="color: #0078d4; border-bottom: 2px solid #e1e5e9; padding-bottom: 10px;">🆕 New Documentation Files</h2>
      `;
      
      for (const file of analysis.newFiles.slice(0, 10)) {
        emailHtml += `
          <div style="background: white; border: 1px solid #e1e5e9; border-radius: 6px; margin-bottom: 15px; overflow: hidden;">
            <div style="background: #f6f8fa; padding: 15px; border-bottom: 1px solid #e1e5e9;">
              <div style="font-weight: bold; color: #0078d4; margin-bottom: 5px;">
                <span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px;">NEW</span>
                <a href="${file.githubUrl}" style="color: #0078d4; text-decoration: none;">${file.filename}</a>
              </div>
              <div style="font-size: 12px; color: #666;">
                Added by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
                ${file.publicDocsUrl ? `<br><a href="${file.publicDocsUrl}" style="color: #0078d4;">📖 View on learn.microsoft.com</a>` : ''}
              </div>
            </div>
            <div style="padding: 15px;">
              <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 14px;">
                <span style="color: #28a745;">+${file.additions} lines added</span>
              </div>
              <div><strong>Commit:</strong> ${file.commitMessage}</div>
            </div>
          </div>
        `;
      }
      
      emailHtml += `</div>`;
    }

    // Modified Files Section
    if (analysis.modifiedFiles.length > 0) {
      emailHtml += `
        <div style="margin-top: 30px;">
          <h2 style="color: #0078d4; border-bottom: 2px solid #e1e5e9; padding-bottom: 10px;">📝 Modified Documentation Files</h2>
      `;
      
      for (const file of analysis.modifiedFiles.slice(0, 15)) {
        const changesSummary = this.extractChangesSummary(file.patch, file.filename);
        
        emailHtml += `
          <div style="background: white; border: 1px solid #e1e5e9; border-radius: 6px; margin-bottom: 15px; overflow: hidden;">
            <div style="background: #f6f8fa; padding: 15px; border-bottom: 1px solid #e1e5e9;">
              <div style="font-weight: bold; color: #0078d4; margin-bottom: 5px;">
                <span style="background: #ffc107; color: #212529; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px;">MODIFIED</span>
                <a href="${file.githubUrl}" style="color: #0078d4; text-decoration: none;">${file.filename}</a>
              </div>
              <div style="font-size: 12px; color: #666;">
                Modified by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
                ${file.publicDocsUrl ? `<br><a href="${file.publicDocsUrl}" style="color: #0078d4;">📖 View on learn.microsoft.com</a>` : ''}
              </div>
            </div>
            <div style="padding: 15px;">
              <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 14px;">
                <span style="color: #28a745;">+${file.additions}</span> / 
                <span style="color: #dc3545;">-${file.deletions}</span> lines changed
              </div>
              <div style="margin-bottom: 10px;"><strong>Commit:</strong> ${file.commitMessage}</div>
              <div style="margin-top: 15px;"><strong>Changes:</strong></div>
              <div style="background: #f6f8fa; padding: 12px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">${this.escapeHtml(changesSummary)}</div>
            </div>
          </div>
        `;
      }
      
      emailHtml += `</div>`;
    }

    // Deleted Files Section
    if (analysis.deletedFiles.length > 0) {
      emailHtml += `
        <div style="margin-top: 30px;">
          <h2 style="color: #0078d4; border-bottom: 2px solid #e1e5e9; padding-bottom: 10px;">🗑️ Deleted Documentation Files</h2>
      `;
      
      for (const file of analysis.deletedFiles.slice(0, 10)) {
        emailHtml += `
          <div style="background: white; border: 1px solid #e1e5e9; border-radius: 6px; margin-bottom: 15px; overflow: hidden;">
            <div style="background: #f6f8fa; padding: 15px; border-bottom: 1px solid #e1e5e9;">
              <div style="font-weight: bold; color: #0078d4; margin-bottom: 5px;">
                <span style="background: #dc3545; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px;">DELETED</span>
                ${file.filename}
              </div>
              <div style="font-size: 12px; color: #666;">
                Deleted by ${file.commitAuthor} on ${moment(file.commitDate, 'YYYY-MM-DD HH:mm:ss ZZ').format('MMM D, YYYY h:mm A')}
                ${file.publicDocsUrl ? `<br><span style="color: #888;">📖 Was available at: ${file.publicDocsUrl}</span>` : ''}
              </div>
            </div>
            <div style="padding: 15px;">
              <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 14px;">
                <span style="color: #dc3545;">-${file.deletions} lines removed</span>
              </div>
              <div><strong>Commit:</strong> ${file.commitMessage}</div>
            </div>
          </div>
        `;
      }
      
      emailHtml += `</div>`;
    }

    // No changes message
    if (analysis.summary.totalFiles === 0) {
      emailHtml += `
        <div style="text-align: center; color: #666; font-style: italic; padding: 40px; background: white; border-radius: 8px; margin-top: 20px;">
          <h3 style="color: #0078d4;">🎉 No documentation changes found in the last 24 hours</h3>
          <p>The Microsoft Entra documentation repository has been stable with no new commits affecting documentation files.</p>
        </div>
      `;
    }

    emailHtml += `
        <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; font-size: 14px; color: #666;">
          <p>🤖 This report was automatically generated by the Entra Docs Monitor</p>
          <p>📧 Delivered to ${this.recipientEmail}</p>
          <p>🔗 <a href="https://github.com/${this.targetRepo.owner}/${this.targetRepo.repo}" style="color: #0078d4;">Visit Repository</a> | <a href="${websiteLink}" style="color: #0078d4;">View Online Report</a></p>
        </div>
      </div>
    `;

    return emailHtml;
  }

  async sendEmail(html, analysis, saveResult) {
    // Check for dry run mode
    if (process.env.DRY_RUN === 'true') {
      console.log('🧪 DRY RUN: Email would be sent with subject:');
      console.log(`   📋 Microsoft Entra Docs Daily Update - ${analysis.newFiles.length} new, ${analysis.modifiedFiles.length} modified files`);
      console.log('📧 Email content generated successfully (not sent in dry run mode)');
      return;
    }
    
    const graphClient = await this.initializeGraphClient();
    
    if (!graphClient) {
      console.log('⚠️ Microsoft Graph client not available, skipping email send');
      return;
    }

    const subject = `📋 Microsoft Entra Docs Daily Update - ${analysis.newFiles.length} new, ${analysis.modifiedFiles.length} modified files`;

    // Add website link to the email content
    const websiteLink = saveResult && saveResult.dateForUrl ? 
      `https://entradiff.merill.net/${saveResult.dateForUrl}.html` : 
      'https://entradiff.merill.net';
    
    // Generate email-specific HTML with full report content optimized for email clients
    const emailHtml = this.generateEmailHtml(analysis, websiteLink);

    const message = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: emailHtml
      },
      toRecipients: [
        {
          emailAddress: {
            address: this.recipientEmail
          }
        }
      ],
      from: {
        emailAddress: {
          address: this.senderEmail
        }
      }
    };

    try {
      // Send email using Microsoft Graph with client credentials flow
      // Use /users/{userId}/sendMail instead of /me/sendMail for client credentials
      await graphClient
        .api(`/users/${this.senderEmail}/sendMail`)
        .post({
          message: message
        });

      console.log(`📧 Email sent successfully via Microsoft Graph to ${this.recipientEmail}`);
    } catch (error) {
      console.error('❌ Error sending email via Microsoft Graph:', error.message);
      
      // If direct send fails, try alternative approaches
      if (error.message.includes('Forbidden') || error.message.includes('401')) {
        try {
          console.log('🔄 Retrying with application permissions...');
          await graphClient
            .api(`/users/${this.senderEmail}/sendMail`)
            .post({
              message: message
            });
          
          console.log(`📧 Email sent successfully via Microsoft Graph (app permissions) to ${this.recipientEmail}`);
        } catch (retryError) {
          console.error('❌ Retry also failed:', retryError.message);
          console.error('💡 Ensure your Entra ID app has Mail.Send application permission and admin consent');
        }
      }
    }
  }

  generateTextReport(analysis) {
    let text = `Microsoft Entra Documentation Changes\n`;
    text += `Generated: ${moment().tz('America/Los_Angeles').format('MMMM Do YYYY, h:mm A z')}\n\n`;
    
    text += `SUMMARY:\n`;
    text += `- Total Commits: ${analysis.summary.totalCommits}\n`;
    text += `- New Files: ${analysis.newFiles.length}\n`;
    text += `- Modified Files: ${analysis.modifiedFiles.length}\n`;
    text += `- Deleted Files: ${analysis.deletedFiles.length}\n`;
    text += `- Contributors: ${analysis.summary.authors.size}\n\n`;

    if (analysis.newFiles.length > 0) {
      text += `NEW FILES:\n`;
      for (const file of analysis.newFiles.slice(0, 10)) {
        text += `- ${file.filename}\n  GitHub: ${file.githubUrl}\n`;
        if (file.publicDocsUrl) {
          text += `  Docs: ${file.publicDocsUrl}\n`;
        }
      }
      text += `\n`;
    }

    if (analysis.modifiedFiles.length > 0) {
      text += `MODIFIED FILES:\n`;
      for (const file of analysis.modifiedFiles.slice(0, 10)) {
        text += `- ${file.filename} (+${file.additions}/-${file.deletions})\n  GitHub: ${file.githubUrl}\n`;
        if (file.publicDocsUrl) {
          text += `  Docs: ${file.publicDocsUrl}\n`;
        }
      }
    }

    text += `\nFull repository: https://github.com/${this.targetRepo.owner}/${this.targetRepo.repo}\n`;
    
    return text;
  }

  async run() {
    console.log('🚀 Starting Microsoft Entra Docs Monitor (Git-based)...');
    
    try {
      // Setup repository (clone or use existing)
      await this.setupRepository();
      
      const commits = await this.getCommitsLastDay();
      
      if (commits.length === 0) {
        console.log('ℹ️ No commits found in the last 24 hours');
        const emptyAnalysis = {
          newFiles: [],
          modifiedFiles: [],
          deletedFiles: [],
          summary: { totalCommits: 0, totalFiles: 0, authors: new Set() }
        };
        
        const html = this.generateHtmlReport(emptyAnalysis);
        const saveResult = await this.saveReport(html, emptyAnalysis);
        await this.sendEmail(html, emptyAnalysis, saveResult);
        return;
      }

      const analysis = await this.analyzeChanges(commits);
      const html = this.generateHtmlReport(analysis);
      
      const saveResult = await this.saveReport(html, analysis);
      await this.sendEmail(html, analysis, saveResult);
      
      console.log('✅ Monitoring completed successfully');
      
    } catch (error) {
      console.error('❌ Error in monitoring process:', error);
      process.exit(1);
    }
  }
}

// Run the monitor
if (require.main === module) {
  const monitor = new EntraDocsMonitor();
  monitor.run();
}

module.exports = EntraDocsMonitor;
