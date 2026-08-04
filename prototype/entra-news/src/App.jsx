import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  GitCompareArrows,
  Info,
  Moon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from "lucide-react";

import { Badge } from "./components/ui/badge.jsx";
import { Button } from "./components/ui/button.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.jsx";

const stories = [
  {
    id: "sms-voice",
    category: "Identity Security",
    categoryTone: "blue",
    badges: [
      ["Admin action", "orange"],
      ["Authentication", "neutral"],
    ],
    title: "SMS and voice retirement: assess the migration opt-out",
    dek: "The retirement guidance now documents the temporary migration opt-out and the Microsoft Graph setting used to enable it.",
    overview: [
      "Microsoft has added the exact configuration administrators can use to temporarily exclude a tenant from automatic passkey enablement and the Registration Campaign rollout.",
      "The opt-out is a transition measure, not a permanent exception. Teams should decide whether they need it, apply it deliberately, and continue moving users to stronger authentication methods before the retirement milestones take effect.",
    ],
    actions: [
      "Review current SMS and voice usage across the tenant.",
      "Decide whether the temporary dynamic-migration opt-out is required.",
      "Plan communications and migration to stronger authentication methods.",
      "Monitor sign-in methods and registration reports for impact.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sms-voice-retirement",
    diffUrl: "https://entradiff.merill.net/2026-07-30.html",
    diffTitle: "Temporary migration opt-out",
    formatted: {
      intro: "A temporary opt-out is available while organizations complete transition activities such as configuring customer-managed telecom providers or migrating users to other authentication methods.",
      removed: "API support and information for opting out will be available starting August 1, 2026.",
      added: "To opt out, update your authentication methods policy using Microsoft Graph and set the passkeyDynamicMigration property to true.",
      code: `PATCH https://graph.microsoft.com/beta/policies/authenticationmethodspolicy\nContent-Type: application/json\n\n{\n  "optOutSettings": {\n    "passkeyDynamicMigration": true\n  }\n}`,
      closing: "After the setting is applied, the tenant is excluded from automatic passkey enablement and Registration Campaign rollout during the opt-out period.",
    },
    raw: `@@ -151,7 +151,24 @@\n-A temporary opt-out will be available for the September 1, 2026 through February 1, 2027 changes. This allows you to delay passkey and Registration Campaign enablement while you complete transition activities. API support and information for opting out will be available starting August 1, 2026.\n+A temporary opt-out will be available for the September 1, 2026 through February 1, 2027 changes. This allows you to delay passkey and Registration Campaign enablement while you complete transition activities.\n+\n+To opt out, update your authentication methods policy using Microsoft Graph and set the \`passkeyDynamicMigration\` property to \`true\`.\n+\n+**Request**\n+\n+\`\`\`http\n+PATCH https://graph.microsoft.com/beta/policies/authenticationmethodspolicy\n+Content-Type: application/json\n+\n+{\n+  "optOutSettings": {\n+    "passkeyDynamicMigration": true\n+  }\n+}\n+\`\`\``,
  },
  {
    id: "scim-wif",
    category: "Provisioning",
    categoryTone: "purple",
    badges: [["Feature update", "purple"], ["Security", "green"]],
    title: "SCIM provisioning adds secretless authentication",
    dek: "SCIM clients can use workload identity federation instead of a long-lived provisioning secret.",
    overview: [
      "The SCIM provisioning guidance now explains how to authenticate with workload identity federation, reducing reliance on long-lived bearer secrets.",
      "Administrators evaluating the pattern should confirm application support, define the federated trust, and test token exchange before rotating away the existing secret.",
    ],
    actions: [
      "Identify SCIM integrations that rely on long-lived secrets.",
      "Confirm the provisioning client supports workload identity federation.",
      "Pilot the new trust before removing the existing credential.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups",
    diffUrl: "https://entradiff.merill.net/2026-07-25.html",
    diffTitle: "Authenticate without a client secret",
    formatted: {
      intro: "The authentication guidance adds workload identity federation as a supported secretless pattern for SCIM provisioning clients.",
      removed: "Store and rotate a long-lived bearer token for the provisioning endpoint.",
      added: "Configure a federated identity credential and exchange the external assertion for an access token at runtime.",
      code: `Authorization: Bearer <federated-access-token>\nContent-Type: application/scim+json`,
      closing: "Continue to validate token audience, issuer, and subject restrictions before production rollout.",
    },
    raw: `@@ Authentication options @@\n-Use a long-lived bearer token and rotate it before expiration.\n+Use workload identity federation to obtain a short-lived access token without storing a client secret.\n+Validate the issuer, subject, and audience used by the federated credential.`,
  },
  {
    id: "immutable-subjects",
    category: "Workload Identity",
    categoryTone: "purple",
    badges: [["Security", "green"], ["New guidance", "blue"]],
    title: "Harden GitHub and GitLab federated credentials",
    dek: "New guidance recommends immutable subject identifiers to prevent mutable repository names from changing trust boundaries.",
    overview: [
      "New workload identity guidance explains why federated credentials should be bound to immutable identifiers instead of mutable names.",
      "Security and platform teams should review existing GitHub and GitLab federation rules, especially credentials scoped by repository, branch, tag, or environment names that can later be reassigned.",
    ],
    actions: [
      "Inventory federated credentials used by CI/CD workloads.",
      "Identify subject claims that depend on mutable names.",
      "Move high-value workloads to immutable identifiers.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects",
    diffUrl: "https://entradiff.merill.net/2026-07-30.html",
    diffTitle: "Use immutable subject identifiers",
    formatted: {
      intro: "A new security section explains how mutable subject values can allow a renamed or transferred resource to inherit an unintended trust relationship.",
      removed: "Scope the federated credential to the repository name used in the workflow.",
      added: "Prefer an immutable repository or project identifier for the federated subject whenever the identity provider exposes one.",
      code: `subject: repository_id:123456789\naudience: api://AzureADTokenExchange`,
      closing: "Apply the same principle to branches, tags, and environments when ownership can change.",
    },
    raw: `@@ Secure federated subjects @@\n-Scope credentials by repository name.\n+Use immutable repository or project identifiers where supported.\n+Review branches, tags, and environments for mutable ownership boundaries.`,
  },
  {
    id: "branding-css",
    category: "User Experience",
    categoryTone: "green",
    badges: [["Retirement", "orange"], ["Admin action", "red"]],
    title: "Audit company-branding CSS before positioning properties retire",
    dek: "The branding reference now lists positioning properties scheduled for retirement and the actions administrators should take.",
    overview: [
      "Microsoft has expanded the company-branding documentation with the positioning-related CSS properties that are being retired.",
      "Branding administrators should inventory current custom CSS, remove dependencies on affected properties, and test sign-in pages so elements do not unexpectedly return to their default placement.",
    ],
    actions: [
      "Export and review existing company-branding CSS.",
      "Find dependencies on positioning and layout overrides.",
      "Retest branded sign-in pages after remediation.",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/entra/fundamentals/reference-company-branding-css-template",
    diffUrl: "https://entradiff.merill.net/2026-07-22.html",
    diffTitle: "Deprecated positioning properties",
    formatted: {
      intro: "The CSS reference now calls out properties that will no longer be honored in company branding.",
      removed: "Use positioning properties to move branding elements anywhere on the sign-in page.",
      added: "Remove dependencies on position, margin, transform, overflow, filter, pointer-events, clip-path, and related placement overrides.",
      code: `/* Review and remove affected overrides */\nposition: absolute;\ntransform: translate(...);\nclip-path: ...;`,
      closing: "Logos, images, and text remain visible, but may return to their default placement when affected CSS is ignored.",
    },
    raw: `@@ Company branding CSS @@\n-Positioning properties can be used to change element placement.\n+Positioning properties are being retired.\n+Review position, margin, transform, opacity, overflow, filter, pointer-events, clip-path, mix-blend-mode, and translate.`,
  },
];

function StoryListItem({ story, selected, onSelect }) {
  return (
    <button
      className={`story-item ${selected ? "story-item-selected" : ""}`}
      onClick={() => onSelect(story.id)}
      aria-pressed={selected}
    >
      <div className="story-meta">
        <span className={`category-text category-${story.categoryTone}`}>{story.category}</span>
        <span aria-hidden>•</span>
        <span>Aug 3, 2026</span>
      </div>
      <span className="story-title">{story.title}</span>
      <span className="story-dek">{story.dek}</span>
      <ChevronRight className="story-chevron" size={18} aria-hidden />
    </button>
  );
}

function FormattedDiff({ story }) {
  return (
    <article className="formatted-diff">
      <h3>{story.diffTitle}</h3>
      <p>{story.formatted.intro}</p>
      <p className="diff-sentence-stack">
        <del>{story.formatted.removed}</del>
        <ins>{story.formatted.added}</ins>
      </p>
      <h4>Request</h4>
      <pre className="formatted-code"><code>{story.formatted.code}</code></pre>
      <p>{story.formatted.closing}</p>
      <p>
        For the complete guidance, see the{" "}
        <a href={story.docsUrl} target="_blank" rel="noreferrer">Microsoft documentation</a>.
      </p>
    </article>
  );
}

function RawDiff({ story }) {
  return (
    <div className="raw-diff" aria-label="Raw Markdown diff">
      {story.raw.split("\n").map((line, index) => {
        const kind = line.startsWith("+") ? "raw-added" : line.startsWith("-") ? "raw-removed" : line.startsWith("@@") ? "raw-hunk" : "";
        return <div className={kind} key={`${index}-${line}`}>{line || " "}</div>;
      })}
    </div>
  );
}

export function App() {
  const [selectedId, setSelectedId] = useState(stories[0].id);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("dark");
  const [comparison, setComparison] = useState("previous");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const selectedStory = stories.find((story) => story.id === selectedId) || stories[0];
  const visibleStories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return stories;
    return stories.filter((story) => `${story.title} ${story.category} ${story.dek}`.toLowerCase().includes(term));
  }, [search]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="EntraDiff home">
          <ShieldCheck size={25} strokeWidth={1.8} aria-hidden />
          <span>EntraDiff</span>
          <small>Daily Microsoft Entra documentation updates</small>
        </a>
        <nav className="header-nav" aria-label="Site navigation">
          <button className="date-control"><CalendarDays size={17} /> Aug 3, 2026 <ChevronDown size={14} /></button>
          <a href="https://entradiff.merill.net" target="_blank" rel="noreferrer">Archive</a>
          <a href="https://github.com/merill/entra-doc-diff" target="_blank" rel="noreferrer">GitHub</a>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </nav>
      </header>

      <div className="reader-layout" id="top">
        <aside className="story-sidebar" aria-label="Today's updates">
          <div className="search-row">
            <label className="search-control">
              <Search size={18} aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search updates"
                aria-label="Search updates"
              />
            </label>
            <Button variant="outline" size="icon" aria-label="Filter updates"><SlidersHorizontal size={18} /></Button>
          </div>
          <div className="sidebar-heading">
            <strong>Today</strong>
            <Badge>{visibleStories.length}</Badge>
          </div>
          <div className="story-list">
            {visibleStories.map((story) => (
              <StoryListItem key={story.id} story={story} selected={story.id === selectedId} onSelect={setSelectedId} />
            ))}
            {visibleStories.length === 0 && <p className="empty-state">No updates match “{search}”.</p>}
          </div>
          <p className="sync-note"><Info size={15} /> Updates may take up to 24 hours to appear.</p>
        </aside>

        <main className="article-pane">
          <div className="article-wrap">
            <section className="article-header">
              <div className="badge-row">
                <Badge tone={selectedStory.categoryTone}>{selectedStory.category}</Badge>
                {selectedStory.badges.map(([label, tone]) => <Badge tone={tone} key={label}>{label}</Badge>)}
              </div>
              <h1>{selectedStory.title}</h1>
              <div className="article-meta"><span>August 3, 2026</span><span>Daily briefing</span><span>Microsoft Entra</span></div>
            </section>

            <section className="translation-grid" aria-labelledby="plain-english-heading">
              <div className="translation-copy">
                <p className="eyebrow">Plain-English translation</p>
                <h2 id="plain-english-heading">What changed and why it matters</h2>
                {selectedStory.overview.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <aside className="admin-actions">
                <h2>What admins should do</h2>
                <ul>
                  {selectedStory.actions.map((action) => <li key={action}><CheckCircle2 size={18} /> <span>{action}</span></li>)}
                </ul>
                <div className="action-buttons">
                  <a className="button button-default button-default-size" href={selectedStory.docsUrl} target="_blank" rel="noreferrer"><BookOpen size={16} /> Read Microsoft documentation <ExternalLink size={14} /></a>
                  <a className="button button-outline button-default-size" href={selectedStory.diffUrl} target="_blank" rel="noreferrer"><FileCode2 size={16} /> Open original EntraDiff report <ExternalLink size={14} /></a>
                </div>
              </aside>
            </section>

            <section className="source-change" aria-labelledby="source-change-heading">
              <div className="source-heading-row">
                <div>
                  <p className="eyebrow">Source change</p>
                  <h2 id="source-change-heading">See exactly what Microsoft changed</h2>
                </div>
                <label className="comparison-control">
                  <GitCompareArrows size={16} />
                  <span>Compare</span>
                  <select value={comparison} onChange={(event) => setComparison(event.target.value)}>
                    <option value="previous">Previous → Aug 3, 2026</option>
                    <option value="original">Original → Aug 3, 2026</option>
                  </select>
                </label>
              </div>

              <Tabs defaultValue="formatted" className="diff-tabs">
                <div className="diff-toolbar">
                  <TabsList aria-label="Diff display mode">
                    <TabsTrigger value="formatted"><BookOpen size={15} /> Formatted changes</TabsTrigger>
                    <TabsTrigger value="raw"><Code2 size={15} /> Raw Markdown</TabsTrigger>
                  </TabsList>
                  <div className="diff-legend" aria-label="Diff legend"><span><i className="legend-added" />Added</span><span><i className="legend-removed" />Removed</span></div>
                </div>
                <TabsContent value="formatted"><FormattedDiff story={selectedStory} /></TabsContent>
                <TabsContent value="raw"><RawDiff story={selectedStory} /></TabsContent>
              </Tabs>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
