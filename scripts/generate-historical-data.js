// Historical data generation script for Entra Docs Monitor
// This script generates website files for the last 3 months by analyzing commits day by day

require('dotenv').config();

const EntraDocsMonitor = require('../src/monitor-docs.js');
const moment = require('moment-timezone');
const fs = require('fs').promises;
const path = require('path');

class HistoricalDataGenerator extends EntraDocsMonitor {
  constructor() {
    super();
    this.processedDays = new Set();
  }

  async generateHistoricalData() {
    console.log('🚀 Starting historical data generation for the last 3 months...');
    
    try {
      // Setup repository
      await this.setupRepository();
      
      // Generate data for last 3 months (90 days)
      const endDate = moment().startOf('day');
      const startDate = moment().subtract(90, 'days').startOf('day');
      
      console.log(`📅 Generating data from ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`);
      
      let processedCount = 0;
      let totalDays = endDate.diff(startDate, 'days');
      
      // Process each day
      for (let currentDate = moment(startDate); currentDate.isSameOrBefore(endDate); currentDate.add(1, 'day')) {
        const dateStr = currentDate.format('YYYY-MM-DD');
        
        // Skip if already processed
        if (this.processedDays.has(dateStr)) {
          console.log(`⏭️  Skipping ${dateStr} (already processed)`);
          continue;
        }
        
        console.log(`📊 Processing ${dateStr} (${processedCount + 1}/${totalDays})...`);
        
        try {
          const analysis = await this.analyzeCommitsForDate(currentDate);
          await this.saveHistoricalReport(currentDate, analysis);
          this.processedDays.add(dateStr);
          processedCount++;
          
          // Small delay to avoid overwhelming git operations
          await this.sleep(100);
          
        } catch (error) {
          console.error(`❌ Error processing ${dateStr}:`, error.message);
          // Continue with next day instead of failing completely
        }
      }
      
      // Generate final index page with all historical data
      console.log('📄 Generating comprehensive index page...');
      await this.generateIndexPage();
      
      console.log(`✅ Historical data generation complete! Processed ${processedCount} days.`);
      console.log(`🌐 Website files available in: ${path.resolve('website')}`);
      
    } catch (error) {
      console.error('❌ Error in historical data generation:', error);
      process.exit(1);
    }
  }

  async analyzeCommitsForDate(targetDate) {
    // Get commits for the 24-hour period ending at this date
    const since = moment(targetDate).subtract(24, 'hours').toISOString();
    const until = moment(targetDate).toISOString();
    
    try {
      // Get commits for this specific 24-hour period
      const commits = await this.git.log({
        '--since': since,
        '--until': until,
        format: {
          hash: '%H',
          date: '%ai',
          message: '%s',
          author_name: '%an',
          author_email: '%ae'
        }
      });
      
      console.log(`  📝 Found ${commits.all.length} commits for ${targetDate.format('YYYY-MM-DD')}`);
      
      if (commits.all.length === 0) {
        return {
          newFiles: [],
          modifiedFiles: [],
          deletedFiles: [],
          summary: { totalCommits: 0, totalFiles: 0, authors: new Set() }
        };
      }
      
      // Analyze changes using existing method
      return await this.analyzeChanges(commits.all);
      
    } catch (error) {
      console.error(`❌ Error fetching commits for ${targetDate.format('YYYY-MM-DD')}:`, error.message);
      return {
        newFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
        summary: { totalCommits: 0, totalFiles: 0, authors: new Set() }
      };
    }
  }

  async saveHistoricalReport(targetDate, analysis) {
    const dateStr = targetDate.format('YYYY-MM-DD');
    const websiteDir = 'website';
    
    // Ensure website directory exists
    await fs.mkdir(websiteDir, { recursive: true });
    
    // Generate HTML report with historical context
    const html = this.generateHistoricalHtmlReport(analysis, targetDate);
    
    // Save files
    const websiteHtmlPath = path.join(websiteDir, `${dateStr}.html`);
    const websiteJsonPath = path.join(websiteDir, `${dateStr}.json`);
    
    await fs.writeFile(websiteHtmlPath, html);
    await fs.writeFile(websiteJsonPath, JSON.stringify(analysis, null, 2));
    
    console.log(`  💾 Saved report for ${dateStr}`);
  }

  generateHistoricalHtmlReport(analysis, targetDate) {
    const reportDate = targetDate.format('MMMM Do YYYY');
    const periodStart = moment(targetDate).subtract(24, 'hours').format('MMMM Do YYYY, h:mm A z');
    const periodEnd = targetDate.format('MMMM Do YYYY, h:mm A z');
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Microsoft Entra Documentation Changes - ${reportDate}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #e0e0e0; max-width: 1200px; margin: 0 auto; padding: 20px; background: #1a1a1a; }
        .header { background: linear-gradient(135deg, #0078d4, #106ebe); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header h1 a { color: white; text-decoration: none; transition: opacity 0.2s; }
        .header h1 a:hover { opacity: 0.8; text-decoration: underline; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .summary { background: #2a2a2a; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #0078d4; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .summary-item { text-align: center; }
        .summary-item .number { font-size: 24px; font-weight: bold; color: #4da6ff; }
        .summary-item .label { font-size: 14px; color: #b0b0b0; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #4da6ff; border-bottom: 2px solid #404040; padding-bottom: 10px; }
        .file-item { background: #2a2a2a; border: 1px solid #404040; border-radius: 6px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .file-header { background: #353535; padding: 15px; border-bottom: 1px solid #404040; }
        .file-name { font-weight: bold; color: #4da6ff; margin-bottom: 5px; }
        .file-name a { color: #4da6ff; text-decoration: none; }
        .file-name a:hover { text-decoration: underline; }
        .file-meta { font-size: 12px; color: #b0b0b0; }
        .file-changes { padding: 15px; }
        .change-stats { background: #353535; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 14px; }
        .additions { color: #40c463; }
        .deletions { color: #f85149; }
        .changes-detail { background: #353535; padding: 12px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
        .new-badge { background: #40c463; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .modified-badge { background: #ffdf5d; color: #1a1a1a; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .deleted-badge { background: #f85149; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .no-changes { text-align: center; color: #b0b0b0; font-style: italic; padding: 40px; }
        .footer { margin-top: 40px; padding: 20px; background: #2a2a2a; border-radius: 8px; text-align: center; font-size: 14px; color: #b0b0b0; }
        .historical-note { background: #2d3142; border: 1px solid #4a4a4a; border-radius: 6px; padding: 15px; margin-bottom: 20px; }
        .historical-note .icon { color: #ffd700; margin-right: 8px; }
        
        /* Diff view styles */
        .diff-container { margin-top: 15px; border: 1px solid #404040; border-radius: 6px; overflow: hidden; background: #2a2a2a; }
        .diff-header { display: grid; grid-template-columns: 1fr 1fr; background: #353535; border-bottom: 1px solid #404040; }
        .diff-label { padding: 10px 15px; font-weight: bold; text-align: center; font-size: 14px; }
        .before-label { color: #f85149; border-right: 1px solid #404040; }
        .after-label { color: #40c463; }
        .diff-content { display: grid; grid-template-columns: 1fr 1fr; max-height: 400px; overflow-y: auto; }
        .diff-pane { font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.4; }
        .before-pane { border-right: 1px solid #404040; }
        .diff-line { padding: 2px 10px; white-space: pre-wrap; word-break: break-word; min-height: 18px; }
        .diff-context { background: #2a2a2a; color: #e0e0e0; }
        .diff-deleted { background: #3d1a1a; color: #f85149; border-left: 3px solid #f85149; }
        .diff-added { background: #1a3d1a; color: #40c463; border-left: 3px solid #40c463; }
        .diff-empty { background: #353535; }
        .no-diff { padding: 15px; text-align: center; color: #b0b0b0; font-style: italic; }
        
        @media (max-width: 768px) {
          .diff-content { grid-template-columns: 1fr; }
          .diff-header { grid-template-columns: 1fr; }
          .before-pane { border-right: none; border-bottom: 1px solid #404040; }
          .before-label { border-right: none; border-bottom: 1px solid #404040; }
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
        <p>Changes for ${reportDate}</p>
        <p>Period: ${periodStart} to ${periodEnd}</p>
      </div>

      <div class="historical-note">
        <span class="icon">📚</span>
        <strong>Historical Report:</strong> This report shows documentation changes that occurred during the 24-hour period ending on ${reportDate}.
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
        <h3>😴 No documentation changes found</h3>
        <p>The Microsoft Entra documentation repository had no commits affecting documentation files during this 24-hour period.</p>
      </div>
      `;
    }

    html += `
      <div class="footer">
        <p>🤖 This historical report was generated by the Entra Docs Monitor</p>
        <p>🔗 <a href="https://github.com/${this.targetRepo.owner}/${this.targetRepo.repo}" target="_blank">Visit Repository</a></p>
        <p>📅 <a href="index.html">← Back to All Reports</a></p>
      </div>
    </body>
    </html>
    `;

    return html;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the historical data generator
if (require.main === module) {
  const generator = new HistoricalDataGenerator();
  generator.generateHistoricalData();
}

module.exports = HistoricalDataGenerator;
