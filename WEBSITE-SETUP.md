# 🌐 Website Setup Guide

This guide explains how to set up the static website for publishing your Microsoft Entra Documentation monitoring reports.

## 📁 Website Structure

The monitoring system generates files in the `./website` folder:

```
website/
├── index.html                    # Main index page listing all reports
├── 2025-07-14.html              # Daily report (HTML)
├── 2025-07-14.json              # Daily report data (JSON)
├── 2025-07-15.html              # Next day's report
└── ...
```

## 🚀 GitHub Pages Setup

### 1. **Enable GitHub Pages**
1. Go to your repository: `https://github.com/merill/entra-doc-diff`
2. Click **Settings** → **Pages**
3. Under **Source**, select **Deploy from a branch**
4. Choose **Branch: main**
5. Choose **Folder: / (root)**
6. Click **Save**

### 2. **Custom Domain Setup**
1. In the **Pages** settings, add your custom domain: `entradiff.merill.net`
2. Check **"Enforce HTTPS"**
3. Configure your DNS:
   - Create a CNAME record pointing `entradiff.merill.net` to `merill.github.io`
   - Or use A records pointing to GitHub's IP addresses

## 🔧 Alternative Hosting Options

### **Netlify**
1. Connect your GitHub repository
2. Set **Build settings**:
   - Build command: `npm run build` (if needed)
   - Publish directory: `website`
3. Deploy!

### **Vercel**
1. Import your GitHub repository
2. Set **Root Directory**: `website`
3. Deploy!

### **Azure Static Web Apps**
1. Create a new Static Web App
2. Connect to your GitHub repository
3. Set **App location**: `website`
4. Deploy!

## 📊 Website Features

### **Index Page** (`/`)
- Lists all daily reports in descending order
- Shows summary statistics for each day
- Provides quick access to full reports
- Responsive design for mobile/desktop

### **Daily Reports** (`/YYYY-MM-DD.html`)
- Full detailed report for specific date
- Side-by-side diff views showing changes
- Links to public documentation
- GitHub repository links

### **JSON API** (`/YYYY-MM-DD.json`)
- Raw data for each day's analysis
- Can be used for building custom dashboards
- Structured data for integrations

## 🔄 Automated Updates

The GitHub Actions workflow automatically:
1. **Generates** daily reports in `./website`
2. **Commits** changes to the repository
3. **Pushes** to GitHub (triggers deployment)
4. **Emails** you with links to the new reports

## 🎨 Customization

### **Styling**
- Edit CSS in `src/monitor-docs.js` (generateIndexHtml function)
- Modify colors, fonts, layout as needed
- All styles are inline for better email compatibility

### **Content**
- Modify report templates in `generateHtmlReport()`
- Adjust summary statistics
- Add custom branding or messaging

## 🔗 URL Structure

With `entradiff.merill.net`:
- **Homepage**: `https://entradiff.merill.net/`
- **Daily Report**: `https://entradiff.merill.net/2025-07-14.html`
- **Data API**: `https://entradiff.merill.net/2025-07-14.json`

## 📧 Email Integration

Each daily email includes:
- **Interactive Report Button**: Direct link to the day's report
- **View All Reports Button**: Link to the main index page
- **Full HTML content**: Embedded in the email for immediate viewing

## 🛡️ Security Considerations

- All reports are **public** (no authentication required)
- **No sensitive data** is included in reports
- **Rate limiting** may apply based on your hosting provider
- Consider adding **analytics** to track usage

## 📱 Mobile Responsiveness

The website is fully responsive and works well on:
- **Desktop browsers**
- **Mobile devices**
- **Tablets**
- **Email clients**

## 🔍 SEO Optimization

- **Meta tags** included for better search visibility
- **Semantic HTML** structure
- **Descriptive titles** and content
- **Fast loading** static files

---

Your automated documentation monitoring system is now ready to publish beautiful, interactive reports to the web! 🎉
