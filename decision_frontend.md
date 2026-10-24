# Frontend Stack Decision

## Inputs (your assumptions, Karpathy #1)

- **primary_device**: `mobile-4g`
- **lcp_target_ms**: `1500`
- **seo_dependent**: `False`
- **auth_walled**: `False`
- **team_size**: `1`
- **read_write_ratio**: `5.0`
- **inp_target_ms**: `200`

## Recommended profile

**astro-or-static** — fit score 70%

_Content-first marketing / docs / blog / pricing site. Heavy read, near-zero write. SEO-critical. Islands Architecture (Astro) or pure SSG (11ty, Hugo, Next.js static export). Every JS byte must justify itself._

**Matched:**
- primary_device in ['mobile-4g', 'desktop-fiber']
- auth_walled_only = False
- team_size >= 1
- team_size <= 5
- lcp_target supports 1200ms p75

**Violated (review before locking):**
- seo_dependent = True
- read_write_ratio >= 100

## Close runner-up: remix-or-sveltekit (67%) — surface the tradeoff.

## Stack

```json
{
  "framework_options_ranked": [
    "astro",
    "11ty",
    "hugo",
    "next-static-export"
  ],
  "language": "typescript-or-markdown-first",
  "styling": "tailwind-or-css-modules",
  "content": "mdx-in-repo or headless-cms (sanity, contentful, payload)",
  "client_js": "islands-only-default-zero",
  "image_pipeline": "framework-native (astro:assets, next/image, hugo image processing)",
  "forms": "edge-function-to-webhook or formspree",
  "analytics": "plausible-or-fathom-or-self-host-umami",
  "testing": "playwright-e2e + lighthouse-ci"
}
```

## Anti-patterns (DO NOT introduce on this profile)

- **spa-for-marketing** — kill — SEO catastrophe in 2026 search/AI-search algorithms
- **react-app-on-every-page** — kill — defeats Islands Architecture
- **third-party-tag-soup** — kill — every script adds LCP + INP
- **google-tag-manager-on-marketing** — warn — measure CWV regression before adding
- **custom-cms-build** — kill — use headless CMS or MDX, not a build project
- **next-app-router-for-static-marketing** — warn — RSC complexity tax with no payoff on near-zero-write surface

## Verifiable success criteria (Karpathy #4)

- `lcp_ms_mobile_4g_p75` = 1200
- `inp_ms_p75` = 100
- `cls_p75` = 0.05
- `ttfb_ms_p75` = 250
- `page_weight_kb_total_max` = 250
- `js_kb_per_page_gzip_max` = 30
- `lighthouse_perf_min` = 95
- `lighthouse_a11y_min` = 95
- `lighthouse_seo_min` = 98
- `lighthouse_best_practices_min` = 95

## CI gates (required)

- lighthouse-ci-all-four-categories
- no-broken-links
- image-budget-per-page
- axe-a11y-checks

## Canon

- Astro team, Islands Architecture (Eisenberg, 2021) — partial hydration
- Web Almanac (HTTP Archive, 2025) on marketing-site weight distribution
- Patrick Stox, JS and SEO (Ahrefs, 2023)
- Addy Osmani, Web Performance for the Modern Web (2024)
- Brad Frost, Atomic Design (2016) — content-first layering

---

Walk `references/forcing_questions.md` BEFORE scaffolding. Do not pick this profile silently.
