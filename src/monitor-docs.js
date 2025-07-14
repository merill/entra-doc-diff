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
    } catch (error) {
      console.log('Reports directory already exists or created');
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
        @media (max-width: 600px) {
          body { padding: 10px; }
          .header { padding: 20px; }
          .summary-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📋 Microsoft Entra Documentation Changes</h1>
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
            <div style="margin-top: 10px;"><strong>Key Changes:</strong></div>
            <div class="changes-detail">${changesSummary}</div>
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
    const htmlFilePath = path.join('reports', `entra-docs-report-${timestamp}.html`);
    const jsonFilePath = path.join('reports', `entra-docs-data-${timestamp}.json`);

    await fs.writeFile(htmlFilePath, html);
    await fs.writeFile(jsonFilePath, JSON.stringify(analysis, null, 2));

    console.log(`💾 Report saved: ${htmlFilePath}`);
    return htmlFilePath;
  }

  async sendEmail(html, analysis) {
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

    const message = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: html
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
        await this.saveReport(html, emptyAnalysis);
        await this.sendEmail(html, emptyAnalysis);
        return;
      }

      const analysis = await this.analyzeChanges(commits);
      const html = this.generateHtmlReport(analysis);
      
      await this.saveReport(html, analysis);
      await this.sendEmail(html, analysis);
      
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
