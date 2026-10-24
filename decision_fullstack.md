# Fullstack Stack Decision

## Inputs (your assumptions, Karpathy #1)

- **team_size**: `1`
- **team_size_12mo**: `2`
- **cadence**: `daily`
- **user_facing**: `True`
- **budget_usd_monthly**: `50`
- **traffic_p99_rps**: `5`
- **data_sensitivity**: `pii-only`
- **read_write_ratio**: `5.0`

## Recommended profile

**saas-startup** — fit score 100%

_Customer-facing SaaS product, < 10 engineers, < $10M ARR. Pre-product-market-fit or just past it. Cadence: daily+. Cloud ceiling: $3-8K/mo. Hiring against the stack via standard recruiter pipeline._

**Matched constraints:**
- team_size <= 10
- team_size_12mo <= 25
- cadence ~ daily-or-per-pr
- budget <= $8000/mo
- user_facing = True
- data_sensitivity ~ pii-only

## Stack recommendation

```json
{
  "primary": "next-app-router-postgres",
  "frontend": {
    "framework": "next.js-14+",
    "rendering": "rsc-default",
    "styling": "tailwind",
    "state": "server-state-via-rsc-plus-zustand-for-client"
  },
  "backend": {
    "pattern": "modular-monolith",
    "language": "typescript-or-python",
    "framework_options": [
      "next-api-routes",
      "fastapi",
      "express"
    ],
    "database": "postgresql",
    "cache": "redis-optional",
    "queue": "defer-until-needed"
  },
  "infrastructure": {
    "hosting": [
      "vercel",
      "fly.io",
      "render",
      "railway"
    ],
    "database_hosting": [
      "neon",
      "supabase",
      "rds-postgres-small"
    ],
    "observability": "single-tool-only-sentry-or-axiom",
    "feature_flags": "growthbook-self-host-or-defer"
  }
}
```

## Anti-patterns (DO NOT introduce these on this profile)

- **microservices** — kill — wrong team-size shape
- **kubernetes** — kill — Vercel/Fly already manages the runtime
- **event-sourcing** — kill — pre-PMF YAGNI
- **graphql-federation** — kill — no second team to federate with
- **kafka** — kill — Postgres LISTEN/NOTIFY or PgQ handles the load at this scale
- **service-mesh** — kill — no services to mesh

## Verifiable success criteria (Karpathy #4)

- `p50_api_latency_ms` = 100
- `p95_api_latency_ms` = 300
- `p99_api_latency_ms` = 800
- `frontend_lcp_ms_mobile_4g` = 2500
- `frontend_inp_ms` = 200
- `uptime_target` = 0.995
- `deployment_time_minutes_max` = 15
- `test_coverage_min` = 0.6

## Named approvers (this tool NEVER auto-approves)

- **stack_change**: tech-lead
- **production-data-migration**: tech-lead + on-call
- **external-service-add**: tech-lead + cfo (cost-aware)

## Canon

- Will Larson, An Elegant Puzzle (2019) — team-size-to-architecture mapping
- Sam Newman, Building Microservices 2e (2021), ch. 1 — MonolithFirst
- Tomasz Tunguz, Cloud Cost Discipline essays (2020-2024)
- DORA State of DevOps 2023 — Elite cadence on monolith outperforms Medium cadence on microservices

---

Next step: walk the 7 forcing questions in `references/forcing_questions.md` with the user. Do NOT scaffold until every question has an answer.
