// Product configuration for Daily.Entra.News.
//
// CommonJS rather than JSON because the classification rules are RegExps.
// Everything the generator needs that is specific to Entra lives here; the code
// in src/ is product-neutral and reads from this file.

module.exports = {
  site: {
    name: 'Entra.News Daily',
    host: 'daily.entra.news',
    url: 'https://daily.entra.news',
    description: 'A readable record of what changed across Microsoft Entra documentation and Message Center.',
    productName: 'Microsoft Entra',
    audience: 'Microsoft Entra administrators'
  },

  brand: {
    // Deliberately not site.name: the header wordmark reads as a domain.
    wordmark: 'Daily.Entra.News',
    ogAlt: 'Entra.News Daily — Microsoft Entra change intelligence',
    themeStorageKey: 'entra-news-theme',
    logo: 'entra-news-logo.png',
    // Icon beside the About page kicker.
    aboutIcon: '/assets/products/entra-family.svg',
    // UI assets copied on top of the set the generator always copies.
    uiAssets: ['newspaper.svg', 'microphone.svg', 'entra-news-logo.png'],
    extraCss: "",
    emailEyebrow: 'Entra.News Daily',
    tokenStorageKey: 'entra-news-github-token'
  },

  discord: {
    botName: 'Entra Scout'
  },

  // Prompt fragments. The instructions themselves are product-neutral and live
  // in the code; only the subject and the openers to avoid differ.
  ai: {
    schemaPrefix: 'entra',
    subject: 'Entra',
    // Headline openers the model must avoid, on top of the neutral ones the
    // prompt always forbids.
    forbiddenOpeners: ['Entra ID documentation', 'Microsoft Entra documentation', 'Entra ID documents'],
    impactBoost: /passkey|conditional access|federated credential|tenant governance|authentication|agentic/
  },

  // Which repository paths become articles on Microsoft Learn, how a path maps
  // to its public URL, and how a path maps to a report heading. `learnRoutes`
  // and `areas.rules` are ordered: first match wins, and $1, $2, ... carry the
  // captured groups into the template.
  // Identity written into persisted state and into published records. This is
  // not prose: change one of these and the code stops recognising what it wrote
  // before — re-emitting every event, or re-sending a broadcast that already
  // went out — so a product's values are fixed for the life of the site.
  identity: {
    docEventPrefix: 'entra-docs',
    batchEventPrefix: 'entra-news',
    // The double-send guard for the daily email. Kit is re-listed by this marker
    // before a broadcast is created.
    kitMarkerPrefix: 'daily-entra-news'
  },

  docs: {
    learnRootUrl: 'https://learn.microsoft.com/en-us/entra/',
    trackedPaths: /^docs\//,
    learnRoutes: [
      { match: /^docs\/(.*)\.md$/, path: 'entra/$1' }
    ],
    areas: {
      // entra-docs nests every article under docs/, which is not part of the
      // Learn path or of the heading.
      stripPrefix: /^docs\//,
      rules: [
        { match: /^(identity)\/([^/]+)\/.*$/, name: '$1/$2' },
        { match: /^([^/]+)\/.*$/, name: '$1' }
      ],
      fallback: 'General Entra documentation'
    }
  },

  // How the generator reaches the documentation clone, and how far back it
  // renders a page per change rather than linking to the full-page diff.
  build: {
    docsCloneDir: 'entra-docs',
    detailDays: 45
  },

  links: {
    // Utility icons in the header. Each icon must exist in assets/site/ui.
    related: [
      {
            "icon": "newspaper.svg",
            "url": "https://entra.news",
            "title": "Subscribe to Entra.News",
            "label": "Subscribe to the Entra.News newsletter"
      },
      {
            "icon": "microphone.svg",
            "url": "https://entra.chat",
            "title": "Listen to Entra.Chat",
            "label": "Listen to the Entra.Chat podcast"
      }
    ],

    // Product links appended to the footer navigation.
    footer: [
      { url: 'https://entra.news', label: 'Entra.News weekly' },
      { url: 'https://entra.chat', label: 'Entra.Chat podcast' }
    ],

    // Extra entries under "Stay current" in the About sidebar. A product with
    // nothing beyond the daily email leaves this empty.
    stayCurrent: [
      { url: 'https://entra.news', label: 'Subscribe to the weekly update' },
      { url: 'https://discord.entra.news', label: 'Join the Entra Discord' }
    ],

    // The "Follow the project" list in the About sidebar.
    followProject: [
      { url: 'https://github.com/merill/entra-doc-diff', label: 'Source on GitHub' },
      { url: 'https://entra.chat', label: 'Entra.Chat podcast' }
    ]
  },

  // Page prose. The generator holds the markup; every product-specific
  // sentence lives here.
  copy: {
    rssFeedLabel: 'Subscribe to the Daily Entra News RSS feed',
    messageCenterHeading: 'Entra in Message Center',

    landing: {
      heading: 'Keep up with Microsoft Entra',
      blurb: 'Daily AI-generated highlights from Microsoft Learn and Message Center.'
    },

    directory: {
      productsLede: 'Follow changes within a product, from Entra ID through Global Secure Access and Verified ID.',
      topicsLede: 'Use topics for work that crosses product boundaries, including architecture, standards, authentication, and troubleshooting.'
    },

    search: {
      inputLabel: 'Search Entra changes',
      placeholder: 'Try passkey migration, Conditional Access, or optOutSettings\u2026'
    },

    compare: {
      pageTitle: 'Compare an Entra Learn page',
      lede: 'Paste an Entra article URL. This page finds the source in MicrosoftDocs/entra-docs, loads its latest two revisions from GitHub, and builds a visual and Markdown diff entirely in your browser.',
      placeholderUrl: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview',
      mapping: '<code>/en-us/entra/identity/example</code> maps to <code>docs/identity/example.md</code> in <a href="https://github.com/MicrosoftDocs/entra-docs" target="_blank" rel="noopener noreferrer">MicrosoftDocs/entra-docs</a>.'
    },

    dailyEmail: {
      eyebrow: 'Daily Entra.News',
      intro: 'Get a concise summary of the latest Microsoft Entra updates delivered straight to your inbox.'
    },

    detail: {
      adminHeading: 'What Entra admins need to know',
      adminImpactLabel: 'For Entra administrators',
      summaryLabel: 'AI-generated editorial summary',
      summaryDisclosure: 'This editorial summary was generated by AI from the documentation changes. Verify important details in the full Microsoft Learn article.'
    },

    footer: {
      featureBlurb: 'Everyone loves using Maester to track their Microsoft Entra and Microsoft 365 tenant security configuration. Maester Cloud turns those daily results into a continuous security record, with 5+ years of history, drift detection, and alerts when your posture changes.',
      tagline: 'Independent change tracking for Microsoft Entra administrators.'
    },

    about: {
      heading: 'Built for the die-hard Microsoft Entra community.',
      lede: 'This site is dedicated to the people who want to know what changed in Microsoft Entra\u2014not just what the documentation says today. It is built by <a href="https://merill.net">Merill Fernando</a> for Entra admins, architects, developers, and fellow identity enthusiasts.',
      whyItExists: [
        'Microsoft Entra moves quickly. Documentation pages, guidance, previews, and service announcements change every day, but those changes can be difficult to spot once a page has been updated.',
        'Entra.News Daily keeps a readable record of those changes so you can catch up by day, week, month, product, or topic\u2014and then open the source material when something matters to you.'
      ],
      howItWorks: [
        'A scheduled workflow watches the public Microsoft Entra documentation, records additions and updates, and brings in relevant Microsoft 365 Message Center announcements.',
        'Plain-English summaries make the daily changes easier to scan. Every documentation item keeps the readable change and Markdown diff available, so the source evidence is always close at hand.'
      ],
      emailEyebrow: 'Automated when Entra changes',
      emailBody: 'Receive the concise Day in brief summary with links to the full evidence. Emails are sent only on days with meaningful Microsoft Entra documentation or Message Center updates, so quiet days stay quiet.',
      // About sections this product runs and another may not. An empty list is
      // how a product opts out; the generator renders whatever is declared.
      extraSections: [
        {
          id: 'stay-current',
          heading: 'Stay current with Microsoft Entra',
          html: '<div class="update-paths"><div class="update-path"><div class="eyebrow">Human-curated every week</div><h3>Subscribe to Entra.News</h3><p>Daily automated AI entries are useful, but nothing beats content created and curated by people who live and breathe identity. <a href="https://entra.news">Entra.News</a> is the weekly briefing with the important news, insights from Microsoft MVPs and identity subject-matter experts, and practical guidance learned the hard way.</p><a class="update-link" href="https://entra.news">Subscribe to Entra.News</a></div><div class="update-path"><div class="eyebrow">Join the conversation</div><h3>Want to chat about Entra?</h3><p>Join the <a href="https://discord.entra.news">Entra Discord community</a> to talk with identity admins, architects, MVPs, and other Entra folks. Discuss the latest announcements, compare real-world experiences, ask questions, and help others across the community.</p><a class="update-link" href="https://discord.entra.news">Join the Entra community on Discord</a></div></div>'
        }
      ],
      community: [
        'This is an independent community project, not a Microsoft product or service. It is built in the open for people who care deeply about identity and want a calmer way to keep up with constant change.',
        'If something is missing, incorrectly classified, or could be explained more clearly, please <a href="https://github.com/merill/entra-doc-diff/issues">open an issue on GitHub</a>. Contributions and thoughtful feedback are always welcome.'
      ],
      quote: 'For the Entra fans who read release notes for fun, notice the small changes, and help everyone else understand why they matter.',
      bio: '<a href="https://merill.net">Merill Fernando</a> builds tools and writes about Microsoft Entra and Microsoft 365 for the admin and identity community.'
    }
  },

  analytics: {
    piqoSite: 'nuj3pzyz'
  },

  messageCenter: {
    // Message Center posts are matched to this site by service or title.
    servicePattern: /\bEntra\b/i
  },

  taxonomy: {
    products: [
    { slug: 'entra-id', name: 'Microsoft Entra ID', short: 'Entra ID', icon: 'entra-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/identity/' },
    { slug: 'agent-id', name: 'Microsoft Entra Agent ID', short: 'Agent ID', icon: 'entra-family.svg', learn: 'https://learn.microsoft.com/en-us/entra/agent-id/' },
    { slug: 'id-protection', name: 'Microsoft Entra ID Protection', short: 'ID Protection', icon: 'id-protection.svg', learn: 'https://learn.microsoft.com/en-us/entra/id-protection/' },
    { slug: 'id-governance', name: 'Microsoft Entra ID Governance', short: 'ID Governance', icon: 'id-governance.svg', learn: 'https://learn.microsoft.com/en-us/entra/id-governance/' },
    { slug: 'external-id', name: 'Microsoft Entra External ID', short: 'External ID', icon: 'external-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/external-id/' },
    { slug: 'internet-access', name: 'Microsoft Entra Internet Access', short: 'Internet Access', icon: 'internet-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/concept-internet-access' },
    { slug: 'private-access', name: 'Microsoft Entra Private Access', short: 'Private Access', icon: 'private-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/concept-private-access' },
    { slug: 'verified-id', name: 'Microsoft Entra Verified ID', short: 'Verified ID', icon: 'verified-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/verified-id/' },
    { slug: 'workload-id', name: 'Microsoft Entra Workload ID', short: 'Workload ID', icon: 'workload-id.svg', learn: 'https://learn.microsoft.com/en-us/entra/workload-id/' },
    { slug: 'global-secure-access', name: 'Microsoft Entra Global Secure Access', short: 'Global Secure Access', icon: 'global-secure-access.svg', learn: 'https://learn.microsoft.com/en-us/entra/global-secure-access/' },
    { slug: 'security-copilot', name: 'Security Copilot + Entra', short: 'Security Copilot', icon: 'entra-family.svg', learn: 'https://learn.microsoft.com/en-us/entra/fundamentals/copilot-security-entra' }
    ],
    defaultProduct: 'entra-id',

    topics: [
    { slug: 'architecture', name: 'Architecture', icon: { sourceName: 'Blueprints', sourcePath: 'management-governance/00006-icon-service-Blueprints.svg', match: 'closest' } },
    { slug: 'standards', name: 'Standards', icon: { sourceName: 'Compliance', sourcePath: 'management-governance/00011-icon-service-Compliance.svg', match: 'closest' } },
    { slug: 'identity-platform', name: 'Microsoft identity platform', icon: { sourceName: 'App Registrations', sourcePath: 'identity/10232-icon-service-App-Registrations.svg', match: 'closest' } },
    { slug: 'fundamentals', name: 'Fundamentals', icon: { sourceName: 'Guide', sourcePath: 'general/10810-icon-service-Guide.svg', match: 'closest' } },
    { slug: 'troubleshooting', name: 'Troubleshooting', icon: { sourceName: 'Diagnose and solve problems', sourcePath: 'identity/Diagnose and solve problems.svg', match: 'exact' } },
    { slug: 'authentication', name: 'Authentication', icon: { sourceName: 'Multifactor Authentication', sourcePath: 'security/03344-icon-service-Multifactor-Authentication.svg', match: 'exact' } },
    { slug: 'conditional-access', name: 'Conditional Access', icon: { sourceName: 'Conditional Access', sourcePath: 'security/10233-icon-service-Conditional-Access.svg', match: 'exact' } },
    { slug: 'security', name: 'Security', icon: { sourceName: 'Security', sourcePath: 'identity/00321-icon-service-Security.svg', match: 'exact' } },
    { slug: 'governance', name: 'Governance', icon: { sourceName: 'Identity Governance', sourcePath: 'identity/10235-icon-service-Identity-Governance.svg', match: 'exact' } },
    { slug: 'provisioning', name: 'Provisioning', icon: { sourceName: 'Entra Connect Sync', sourcePath: 'identity/03533-icon-service-Entra-Connect-Sync.svg', match: 'closest' } },
    { slug: 'branding', name: 'Branding', icon: { sourceName: 'Image', sourcePath: 'general/10812-icon-service-Image.svg', match: 'closest' } },
    { slug: 'monitoring', name: 'Monitoring', icon: { sourceName: 'Monitor', sourcePath: 'monitor/00001-icon-service-Monitor.svg', match: 'exact' } },
    { slug: 'developer', name: 'Developer', icon: { sourceName: 'Code', sourcePath: 'general/10787-icon-service-Code.svg', match: 'closest' } },
    { slug: 'general', name: 'General', icon: { sourceName: 'Information', sourcePath: 'general/10005-icon-service-Information.svg', match: 'closest' } }
    ],
    defaultTopic: 'general',

    // Where the SVGs under assets/site were taken from, pinned so the set can be
    // resynced against the same revision it was drawn from.
    iconSource: {
      repository: 'https://github.com/DanielBradley1/msicons',
      revision: '3d57443ed4445be9465ee2fee6a6ce6fd02cf90c'
    },

    stopwords: 'microsoft entra documentation docs update updated updates change changes new for with from into about that this your their has have will are and the how use using overview configure configuration guide learn overview support service services preview',

    // Expansions applied to short queries before they reach the search index.
    searchAliases: {
      mfa: 'multifactor authentication',
      ca: 'conditional access',
      gsa: 'global secure access',
      pim: 'privileged identity management',
      sspr: 'self service password reset',
      fido2: 'passkey authentication'
    }
  },

  // First match wins. scope 'title' lets a headline settle a classification the
  // body would otherwise muddy; `unless` guards the case where a broader product
  // name appears inside a narrower one.
  classify: {
    products: [
      {
        slug: 'entra-id',
        scope: 'title',
        match: /microsoft entra id(?:\s*:|\b)/i,
        unless: /(governance|protection|workload|external|verified)/i
      },
      { slug: 'agent-id', match: /agent[- ]?id|agent identit/ },
      { slug: 'id-protection', match: /id[- \/]?protection|risk[- ]?detection|risky user/ },
      { slug: 'id-governance', match: /id[- \/]?governance|entitlement|access review|lifecycle workflow|tenant governance/ },
      { slug: 'external-id', match: /external[- \/]?id|external identit|b2b|b2c|cross.?tenant/ },
      { slug: 'verified-id', match: /verified[- \/]?id|verifiable credential/ },
      { slug: 'workload-id', match: /workload[- \/]?id|workload identit|managed identit|federated credential|service principal/ },
      { slug: 'internet-access', match: /internet[- \/]?access|internet access/ },
      { slug: 'private-access', match: /private[- \/]?access|private access/ },
      { slug: 'global-secure-access', match: /global[- \/]?secure[- \/]?access|global secure access|\bgsa\b/ },
      { slug: 'security-copilot', match: /security copilot|copilot for security/ },
      { slug: 'entra-id', match: /docs\/identity|entra id|authentication|conditional access|enterprise app|app registration|directory|tenant|user|group|sign-in|branding|passkey|password/ }
    ],

    topics: [
      // A Conditional Access headline is definitive even when the article also
      // discusses authentication, sign-in, or another supporting capability.
      { slug: 'conditional-access', scope: 'title', match: /\bconditional access\b/ },
      { slug: 'conditional-access', match: /conditional access/ },
      { slug: 'authentication', match: /authenticat|passkey|password|fido|sms|voice|sign-in/ },
      { slug: 'architecture', match: /architecture|deployment plan|design pattern|reference architecture/ },
      { slug: 'branding', match: /branding|custom css|sign-in page/ },
      { slug: 'standards', match: /standard|rfc|openid|oauth|saml|scim/ },
      { slug: 'identity-platform', match: /identity platform|app registration|developer|msal|graph api/ },
      { slug: 'fundamentals', match: /fundamental|what is|overview|concept/ },
      { slug: 'troubleshooting', match: /troubleshoot|error|diagnos|remediat/ },
      { slug: 'governance', match: /governance|entitlement|access review|lifecycle|configuration monitor|snapshot/ },
      { slug: 'provisioning', match: /provision|scim|synchroni[sz]/ },
      { slug: 'monitoring', match: /monitor|log|report|audit/ },
      { slug: 'security', match: /security|risk|protect|credential|vulnerab/ },
      { slug: 'developer', match: /developer|api|sdk|code|application/ }
    ]
  }
};
