# Entra.News Daily design QA

## Evidence

- About-page references: `/Users/merill/github/entra-doc-diff/audit/reference-mc-about.png`, `/Users/merill/github/entra-doc-diff/audit/reference-graph-about.png`, and `/Users/merill/github/entra-doc-diff/audit/reference-yako-about.png` (captured at a 1487 × 1058 CSS-pixel viewport).
- About implementation: `http://127.0.0.1:4173/about/` with `/Users/merill/github/entra-doc-diff/audit/about-desktop.png`, `/Users/merill/github/entra-doc-diff/audit/about-footer-desktop.png`, and `/Users/merill/github/entra-doc-diff/audit/about-mobile.png`.
- About same-input comparison: `/Users/merill/github/entra-doc-diff/audit/about-comparison.png`.
- Subscription-path revision: `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-desktop.png`, `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-mobile-final.png`, and same-input comparison `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-comparison.png`.
- Weekly source: `/Users/merill/.codex/generated_images/019fc04c-db70-7ba2-87f9-0a636ce5004f/exec-cdb612e1-0595-4bf1-b6ff-90dce70936ac.png` (1487 × 1058 pixels).
- Monthly source: `/Users/merill/.codex/generated_images/019fc04c-db70-7ba2-87f9-0a636ce5004f/exec-f9d8f59a-dabe-472f-b03b-e6fe2a870cea.png` (1487 × 1058 pixels).
- Implementation URL: `http://127.0.0.1:4173/week/2026-07-27/`.
- Desktop screenshots: `/Users/merill/github/entra-doc-diff/audit/grouped-week-desktop.png`, `/Users/merill/github/entra-doc-diff/audit/grouped-day-desktop.png`, and `/Users/merill/github/entra-doc-diff/audit/grouped-month-desktop.png` (1487 × 1058 CSS-pixel viewport at density 1).
- Focused screenshots: `/Users/merill/github/entra-doc-diff/audit/grouped-week-focus.png` and `/Users/merill/github/entra-doc-diff/audit/grouped-month-focus.png`.
- Responsive screenshots: `/Users/merill/github/entra-doc-diff/audit/grouped-week-mobile.png` and `/Users/merill/github/entra-doc-diff/audit/grouped-month-mobile.png` (390 × 844 CSS-pixel viewport).
- Same-input comparisons: `/Users/merill/github/entra-doc-diff/audit/grouped-week-comparison.png` and `/Users/merill/github/entra-doc-diff/audit/grouped-month-comparison.png`.
- Product-index revision: `/Users/merill/github/entra-doc-diff/audit/product-rail-week-desktop.png`, `/Users/merill/github/entra-doc-diff/audit/product-rail-day-desktop.png`, `/Users/merill/github/entra-doc-diff/audit/product-rail-month-desktop.png`, and `/Users/merill/github/entra-doc-diff/audit/product-rail-week-mobile.png`.
- Product-index same-input comparisons: `/Users/merill/github/entra-doc-diff/audit/product-rail-week-comparison.png` and `/Users/merill/github/entra-doc-diff/audit/product-rail-month-comparison.png` (source and implementation are both 1487 × 1058 pixels at density 1).
- Expanded footer: `/Users/merill/github/entra-doc-diff/audit/expanded-footer-desktop.png` at a 1487 × 1058 viewport and `/Users/merill/github/entra-doc-diff/audit/expanded-footer-mobile.png` at a 390 × 844 viewport.
- State: 1 August 2026 day archive, week of 27 July 2026, and August 2026 month archive with documentation and Message Center items.

## Findings

No actionable P0, P1, or P2 differences remain.

- The new About page carries the direct, personal community framing of the Yako reference into the existing Entra.News Daily editorial system. Its opening establishes the audience and author immediately, followed by concise `Why it exists`, `How it works`, and `Made for the community` sections.
- The Message Center reference informed the operational explanation, while Graph Permissions informed the independent-project disclaimer and contribution path. These are expressed with the site's existing typography, flat rules, warm paper palette, and right-rail navigation rather than importing another site's visual theme.
- The About page now distinguishes two update habits without competing calls to action: Entra.News is explicitly sold as the weekly briefing, while daily.entra.news and the Entra Discord are paired as the daily archive and community conversation. Both pathways appear in the article and as compact right-rail links.
- The repeated product/topic breadcrumb on every weekly and daily row has been replaced by stable product sections. Each section uses the corresponding msicons.com product asset, one product heading and update total, then topic subgroups and article rows.
- Every documentation row now exposes its source change status as `New`, `Updated`, or `Removed`. Message Center announcements use `New` because they are newly published items in the archive, while their Message Center provenance and rollout metadata remain visible.
- The month archive now uses the same product/topic/article hierarchy as day and week. `August by product` and `By topic` are in the right rail, and the duplicate `Notable changes` section has been removed.
- Day and week now use the same product/count index as month. Product links use current-page fragment targets, preserving the route and landing each linked product group 18 pixels below the sticky desktop header.
- The larger footer extends the established editorial language with one prominent Maester Cloud feature, a compact related-project directory, and a distinct GitHub Sponsors message. It uses rules and type hierarchy rather than generic cards, so it reads as part of the publication rather than a separate marketing component.

## Required fidelity surfaces

- Typography: editorial serif titles and sans-serif metadata remain consistent. Product headings are visually stronger than topic headings; article titles remain the primary scan targets inside each topic.
- About typography: the 52-pixel desktop headline and 38-pixel mobile headline preserve the news-site voice while delivering the same direct personal hierarchy as the Yako reference. Body copy remains readable at 16–20 pixels without truncation or cramped columns.
- Spacing and layout rhythm: product groups are separated by stronger rules and whitespace, topics by lighter rules, and related article rows remain compact enough for news-style scanning.
- About layout: the desktop page uses an 1180-pixel editorial frame with a 270-pixel right rail. The hero, paired explanation, community section, and closing statement have clear vertical rhythm; mobile collapses to one column without lost content.
- Colors and tokens: warm paper, near-black ink, forest green links, pale selected-day treatment, and thin neutral rules remain consistent. Status pills reuse muted green and neutral tones without competing with titles.
- Image and icon fidelity: the About kicker uses the existing Microsoft Entra family SVG rather than a generated or approximated mark. Header utility icons and the Entra asset loaded successfully with non-zero natural width. Top-level groups continue to use the existing msicons.com SVG assets.
- Copy and content: dates remain visible where they disambiguate weekly or monthly entries. Message Center links continue to open the corresponding `mc.merill.net` page directly.
- About copy: the page clearly identifies Merill, the die-hard Entra audience, the source inputs, AI-assisted plain-English summaries, retained source diffs, independent-project status, and GitHub feedback route.
- Subscription copy: weekly and daily benefits are stated before their links; the Discord description explains that updates are posted daily and that the community discusses current Entra updates and news.
- Accessibility and responsiveness: mobile pages have no horizontal overflow; grouped rows stack their status pills below titles where needed; the month statistics rail moves below the main content rather than disappearing.
- In-page navigation: every product target has a unique `product-*` id and a responsive scroll margin. The right rail remains visible on desktop and reflows below the archive at narrower breakpoints.
- Footer accessibility and responsiveness: project and support destinations are semantic links, the footer navigation is labelled, and the three-column desktop layout becomes a readable single-column sequence at 390 pixels with no horizontal overflow.

## Full-view comparison evidence

The prior and grouped weekly views were inspected side by side in `/Users/merill/github/entra-doc-diff/audit/grouped-week-comparison.png`. The grouped view removes repeated product labels and makes Microsoft Entra ID, its topic hierarchy, and row status legible in one scan.

The prior and grouped month views were inspected side by side in `/Users/merill/github/entra-doc-diff/audit/grouped-month-comparison.png`. The calendar remains the high-level entry point, the product/topic totals occupy the right rail, and the grouped archive begins directly below the monthly brief.

The Yako editorial reference and new About page were inspected side by side in `/Users/merill/github/entra-doc-diff/audit/about-comparison.png`. Both lead with a personal community statement and author link; the implementation intentionally uses Entra.News Daily's light editorial theme and right rail instead of cloning Yako's dark product-site styling.

The previous About page and revised weekly/daily pathways were inspected side by side in `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-comparison.png`. The revision preserves the hero and explanatory hierarchy while adding the new section at the first natural break and promoting its three actions in the right rail.

The prior weekly view and the new in-page product index were inspected together in `/Users/merill/github/entra-doc-diff/audit/product-rail-week-comparison.png`. The only material composition change is the purposeful addition of product icons/counts above the existing recent-week navigation; main-column density and proportions remain stable. The month comparison confirms the link-behaviour update creates no visual drift.

## Focused-region comparison evidence

- Weekly product and topic headers, product counts, item dates, and New/Updated pills were inspected in `/Users/merill/github/entra-doc-diff/audit/grouped-week-focus.png`.
- The month calendar, right-rail product/topic totals, monthly brief, and start of the grouped product archive were inspected together in `/Users/merill/github/entra-doc-diff/audit/grouped-month-focus.png`.
- Mobile weekly and monthly screenshots confirm the header/navigation wrap, calendar labels, feature story, and archive content stay within a 390-pixel viewport.
- The About hero, two-column explanation, community statement, and author/explore rail were inspected at desktop size. `/Users/merill/github/entra-doc-diff/audit/about-mobile.png` confirms the hero and sections reflow cleanly at 390 × 844; `/Users/merill/github/entra-doc-diff/audit/about-footer-desktop.png` confirms the lower community content remains legible.
- The new weekly and daily paths were checked at desktop and mobile sizes. `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-mobile-final.png` confirms both paths stack in the intended order with readable calls to action and no horizontal overflow.
- The right-rail link interaction was checked in `/Users/merill/github/entra-doc-diff/audit/product-anchor-week.png`: selecting Entra ID retained `/week/2026-07-27/`, set `#product-entra-id`, and positioned the target at 96 pixels with the sticky header ending at 78 pixels.
- `/Users/merill/github/entra-doc-diff/audit/expanded-footer-desktop.png` was inspected as a focused region because footer typography, column boundaries, CTA prominence, and support copy were too small in a full-page capture. `/Users/merill/github/entra-doc-diff/audit/expanded-footer-mobile.png` confirms Maester Cloud leads the stacked order and related project rows stay legible.

## Interaction and technical checks

- Browser-rendered routes checked: day, week, and month.
- About: active navigation state, author/source links, section headings, footer link, responsive rail order, and all visible SVG assets were checked. Browser console returned no warnings or errors.
- Weekly, Daily, and Discord destinations resolve in the generated HTML as `https://entra.news`, `https://daily.entra.news`, and `https://discord.entra.news`. The revised browser pass returned no warnings or errors.
- Week: 6 product groups, 15 topic groups, 16 New pills, and 26 Updated pills.
- Day: 3 product groups, 7 topic groups, 11 New pills, and 10 Updated pills.
- Month: 3 product groups, 7 topic groups, one month statistics rail, 11 New pills, and 10 Updated pills; zero `Notable changes` headings and zero legacy two-column product/topic tables.
- Desktop document width equals the 1487-pixel viewport on all checked routes.
- Mobile week and month document widths equal their 390-pixel viewports. The month statistics rail reflows below the main content.
- Mobile About document width equals its 390-pixel viewport. The right rail reflows below the article and remains available rather than being hidden.
- Day and week product indexes expose only products represented in the selected period. All product links are current-page fragments; the month product index follows the same behaviour while topic links continue to open their archive pages.
- Footer links were checked for Maester Cloud, Maester, Graph Permissions Explorer, cmd.ms, the M365 Message Center Archive, Yako, GitHub Sponsors, and Merill's GitHub profile. Browser console returned no warnings or errors.
- Eleven automated tests passed, the static site build completed, and `git diff --check` passed.
- The current sitemap contains 1,948 static URLs.

## Comparison history

- Earlier weekly QA found clipped mobile navigation and tablet header overflow. The responsive two-row navigation and compact tablet header remain intact.
- The previous revision removed clock times and duplicate Microsoft Learn labels, added direct Message Center links, removed administrator panels, and introduced the month briefing/count badges.
- This revision first replaced the chronological article stream with product groups, then nested topics and added status pills.
- The About revision reviewed three existing Merill project pages before implementation. The first rendered pass had no P0/P1/P2 layout issues at desktop or mobile. A small active-state polish change was made so the About utility link uses the established green active token; post-fix evidence is `/Users/merill/github/entra-doc-diff/audit/about-footer-desktop.png`.
- The subscription revision initially exposed a P2 direct-anchor issue on mobile: the sticky two-row header obscured part of the `Stay current with Microsoft Entra` heading. The section now uses responsive scroll margins; post-fix evidence is `/Users/merill/github/entra-doc-diff/audit/about-subscriptions-mobile-final.png`, where the complete heading remains below the header.
- Desktop review found the grouping hierarchy, rail proportions, product assets, and status treatments balanced at 1487 × 1058.
- Responsive review found no overflow at 390 × 844. Month statistics remain available after the grouped content instead of being hidden.
- The product-index/footer revision compared the prior and new weekly/monthly captures at identical 1487 × 1058 viewports. No P0/P1/P2 issue was found, so no visual repair iteration was required. Desktop and 390 × 844 responsive evidence confirms the new footer hierarchy and in-page navigation without overflow or design-system drift.

## Follow-up polish

- Optional P3: when multiple complete months are available, add a compact month-over-month comparison to the monthly brief without changing the archive hierarchy.

## Rich documentation diff and archive descriptions — 4 August 2026

### Evidence

- Message Center reference: `/var/folders/xp/g2mvtxmj7b71nzh9d8pfmp_c0000gn/T/codex-clipboard-5e1b663e-81dd-4f74-b367-c3a3cc5c7d6d.png`.
- Same-input comparison: `/Users/merill/github/entra-doc-diff/audit/rich-diff-comparison.png`.
- Rich diff: `/Users/merill/github/entra-doc-diff/audit/rich-diff-desktop.png`.
- Git-style Markdown diff: `/Users/merill/github/entra-doc-diff/audit/markdown-diff-desktop.png`.
- Archive descriptions: `/Users/merill/github/entra-doc-diff/audit/archive-descriptions-desktop.png` and `/Users/merill/github/entra-doc-diff/audit/archive-descriptions-mobile.png`.
- Detail route: `http://127.0.0.1:4173/changes/2026-08-03/how-to-manage-the-internet-access-profile-01/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- The readable document comparison now follows the Message Center reference with inline green insertions and red strikethrough deletions inside rendered headings, paragraphs, lists, emphasis, and links.
- Front matter is excluded even when a Git hunk begins after the opening YAML delimiter. The reviewed detail page exposes no `ms.date` metadata in the readable comparison.
- Paragraph-to-heading changes are repaired after the HTML diff so headings do not contain invalid nested block elements or empty paragraphs.
- Microsoft Learn alerts retain their product-appropriate colored container and tables retain bordered cells while changed text inside them uses the same inline diff treatment.
- The Markdown tab uses a light Git-style diff with distinct file headers, hunks, additions, deletions, and context rows. The reviewed change contains 38 added, 17 removed, and 4 hunk rows.
- Day, week, and month product groups now show readable descriptions below each title in smaller muted type. The daily desktop and 390-pixel mobile views have no horizontal overflow.
- The 1,280-pixel header breakpoint was tightened after QA exposed clipped navigation; the final desktop header presents every destination without overlap.

### Interaction and technical checks

- The detail tabs switch between the readable comparison and Markdown panels; only the selected panel is visible.
- Desktop and 390 × 844 responsive states were checked in the in-app browser.
- The checked detail page has zero page-level horizontal overflow, zero visible front-matter fields, and zero headings containing nested block elements.
- Static site generation completed with 1,851 URLs, 25,772 documentation changes, and 107 Message Center posts.

final result: passed

## AI editorial panels and Learn extract context — 4 August 2026

### Evidence

- Same-viewport before/after comparison: `/Users/merill/github/entra-doc-diff/audit/detail-editorial-comparison.png`.
- Revised desktop detail: `/Users/merill/github/entra-doc-diff/audit/detail-editorial-after.png`.
- Revised mobile detail: `/Users/merill/github/entra-doc-diff/audit/detail-editorial-mobile.png`.
- Detail route: `http://127.0.0.1:4173/changes/2026-08-03/how-to-manage-the-internet-access-profile-01/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- `In brief` and `What Entra admins need to know` are presented as a subtly rounded, bordered two-column editorial module with differentiated shading and a shared AI disclosure.
- The existing per-change `adminImpact` output from the AI summary pipeline supplies the restored administrator guidance.
- The Documentation change section repeats the Microsoft Learn action beside a concise explanation that the comparison is a changed-content extract, not the complete article.
- Both Microsoft Learn actions open in a new tab with `noopener noreferrer`; the obsolete daily source report action is absent.
- Responsive QA initially found inherited padding pulling the second panel to the mobile edge. The final 390-pixel view has matching 19-pixel content insets in both panels and no horizontal overflow.
- Historical document links now use article anchors on the corresponding day page. The browser check confirmed the target is found and scrolls into view below the sticky header.
- All 476 published legacy dated HTML reports were removed; the daily JSON inputs remain available to generate the static archive.
- Static generation completed with 1,851 URLs, 25,772 documentation changes, and 107 Message Center posts.

final result: passed

## Header navigation and page-grid alignment — 4 August 2026

### Evidence

- Same-viewport before/after comparison: `/Users/merill/github/entra-doc-diff/audit/header-navigation-comparison.png`.
- Revised desktop view: `/Users/merill/github/entra-doc-diff/audit/header-navigation-after.png`.
- Revised mobile view: `/Users/merill/github/entra-doc-diff/audit/header-navigation-mobile.png`.
- Weekly route: `http://127.0.0.1:4173/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- Products and Topics were removed from the top navigation; those discovery paths remain available in the left rail and footer/site pages.
- The top navigation now contains Day, Week, Month, and Message Center, reducing crowding around the brand and utility links.
- At the 1,600-pixel review width, the brand and the Products rail heading now share the same 114-pixel left edge. Previously the brand began at 51 pixels while the rail content began at 114 pixels.
- The brand lockup uses a tight line box, centering the 38-pixel logo and title within the 78-pixel desktop header.
- At 390 × 844, the four primary destinations form a balanced two-column grid with no horizontal overflow.
- Static generation completed with 1,851 URLs, 25,772 documentation changes, and 107 Message Center posts.

final result: passed

## Daily Entra News header identity — 4 August 2026

### Evidence

- Desktop header: `/Users/merill/github/entra-doc-diff/audit/header-brand-desktop.png`.
- Mobile header: `/Users/merill/github/entra-doc-diff/audit/header-brand-mobile.png`.
- Detail route: `http://127.0.0.1:4173/changes/2026-08-03/how-to-manage-the-internet-access-profile-01/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- The top-left brand now reads `Daily Entra News` and uses the official Entra.News blue diamond artwork sourced from the current Entra.News publication.
- The logo is stored locally as a 192 × 192 optimized PNG, rendered at 38 × 38 pixels on desktop and 32 × 32 pixels on mobile.
- The adjacent text gives the brand link an accessible name, so the repeated logo image is intentionally decorative with an empty alt value.
- Desktop QA at 1,280 pixels and responsive QA at 390 × 844 show no horizontal overflow, clipping, or collision with navigation and utility links.
- Static site generation completed with 1,851 URLs, 25,772 documentation changes, and 107 Message Center posts.

final result: passed

## Daily landing page and compact month calendar — 4 August 2026

### Evidence

- Same-viewport before/after comparison: `/Users/merill/github/entra-doc-diff/audit/day-calendar-comparison.png`.
- Previous day rail: `/Users/merill/github/entra-doc-diff/audit/day-calendar-before.png`.
- Updated daily landing page: `/Users/merill/github/entra-doc-diff/audit/day-calendar-after.png`.
- Landing route: `http://127.0.0.1:4173/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- The root route now opens the latest populated day instead of the weekly archive; `/week/` is the stable current-week route.
- The day rail begins with a compact Monday-first month calendar using day numbers and green count notifications only. The calendar intentionally omits the product icons and expanded cells used on the full month page.
- Count notifications were moved beside their day numbers during visual QA so two-digit counts do not read as part of the calendar date.
- Selecting a populated date opens that daily route. A date without changes resolves to the most recent earlier populated date, and its accessible label explains the fallback destination.
- Previous and next controls move between populated days, avoiding dead-end empty-day views.
- The full static build completed with 1,852 URLs, 25,772 documentation changes, and 107 Message Center posts.

### Interaction and technical checks

- The reviewed landing page selected 4 August with six changes and displayed count notifications for 1, 3, and 4 August.
- Selecting 3 August opened `/day/2026-08-03/`; selecting empty 2 August opened the last populated date at `/day/2026-08-01/`.
- The Week navigation opened `/week/` with the heading `Week of 3 August 2026`, and the Day navigation returned to `/`.
- The complete automated suite passes all 19 tests, including root-route, compact-calendar, and no-change fallback assertions.

final result: passed

## Dotted header brand lockup — 4 August 2026

### Evidence

- Same-viewport before/after comparison: `/Users/merill/github/entra-doc-diff/audit/header-dotted-brand-comparison.png`.
- Updated landing-page header: `/Users/merill/github/entra-doc-diff/audit/header-dotted-brand-after.png`.
- Landing route: `http://127.0.0.1:4173/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- The visible brand is now `Daily.Entra.News` beside the existing Entra.News logo.
- The separate `daily.entra.news` secondary label has been removed from the header markup rather than merely hidden at a breakpoint.
- The updated brand remains vertically aligned with the logo and does not collide with the Day navigation at the reviewed 1,280 × 720 viewport.
- All 19 automated tests pass and the full static build generated 1,852 URLs.

final result: passed

## Mobile editorial-summary wrapping — 4 August 2026

### Evidence

- Updated 390-pixel detail view: `/Users/merill/github/entra-doc-diff/audit/mobile-summary-wrapping-after.png`.
- Detail route: `http://127.0.0.1:4173/changes/2026-08-03/how-to-manage-the-internet-access-profile-01/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- The mobile editorial summary now switches from CSS Grid to a full-width stacked block layout.
- Both editorial panels, their headings, summary paragraphs, and the AI disclosure have explicit width constraints and safe overflow wrapping.
- The detail content column now has `min-width: 0`, preventing a descendant's min-content width from expanding the mobile page.
- The 390-pixel capture shows the `In brief` copy wrapping within the bordered panel without clipping or horizontal spill.
- All 19 automated tests pass and the full static build generated 1,852 URLs.

final result: passed

## Day calendar activity and refresh status — 4 August 2026

### Evidence

- Revised compact calendar: `/Users/merill/github/entra-doc-diff/audit/day-calendar-centered-arrows.png`.
- Revised refresh footer: `/Users/merill/github/entra-doc-diff/audit/footer-relative-refresh.png`.
- Landing route: `http://127.0.0.1:4173/`.

### Findings

No actionable P0, P1, or P2 differences remain.

- Update counts were replaced by small activity dots beneath their dates, removing visual overlap and reducing calendar noise.
- Dates from the preceding and following month now fill the calendar grid as muted gray text without cell shading; spillover dates with updates retain a subdued activity dot.
- Circular previous and next month controls flank the month title with optically centered chevrons. The previous control opens the last populated day in July, while the unavailable future month control is visibly disabled.
- The footer's local last-refreshed timestamp no longer includes a timezone abbreviation.
- The next refresh now shows only a relative duration, such as `Next refresh in 24 hours`, with no duplicate date.
- All 19 automated tests pass and the full static build generated 1,852 URLs.

final result: passed
