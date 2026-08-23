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
    extraCss: ":root[data-theme=\"dark\"] .diff-link img{filter:invert(1) hue-rotate(180deg)}",
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
    impactBoost: /passkey|conditional access|federated credential|tenant governance|authentication|agentic/
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
]
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
    { slug: 'architecture', name: 'Architecture' },
    { slug: 'standards', name: 'Standards' },
    { slug: 'identity-platform', name: 'Microsoft identity platform' },
    { slug: 'fundamentals', name: 'Fundamentals' },
    { slug: 'troubleshooting', name: 'Troubleshooting' },
    { slug: 'authentication', name: 'Authentication' },
    { slug: 'conditional-access', name: 'Conditional Access' },
    { slug: 'security', name: 'Security' },
    { slug: 'governance', name: 'Governance' },
    { slug: 'provisioning', name: 'Provisioning' },
    { slug: 'branding', name: 'Branding' },
    { slug: 'monitoring', name: 'Monitoring' },
    { slug: 'developer', name: 'Developer' },
    { slug: 'general', name: 'General' }
    ],
    defaultTopic: 'general',

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
