# Effort Estimation Guide

Detailed per-category estimation baselines. All values assume **manual coding** by a developer
familiar with the project's tech stack (Spring Boot / Vue.js / Oracle / Redis).

## Overhead Multipliers

Apply these on top of pure coding time:

| Overhead Type | When to Apply | Multiplier |
|---------------|--------------|------------|
| Self-test + debug | Always | +20% |
| Integration test | Cross-module or cross-system | +15–25% |
| Environment config | New modules, new services | +5–10% |
| Code review prep | Always (small) | +5% |
| Uncertainty buffer | >30% unknown scope | +50% |

**Composite formula**: `base_hours × (1 + self_test) × (1 + integration) × (1 + config) × (1 + uncertainty)`

## Frontend Estimates

| Category | Low | Medium | High | Very High |
|----------|-----|--------|------|-----------|
| FE-UI UI Modification | 0.5–1h (field/label change) | 1–3h (layout restructure, style overhaul) | 3–8h (multi-page consistency, responsive) | 8–16h (full theme migration) |
| FE-PAGE New Page/Form | 2–4h (simple CRUD form, <10 fields) | 4–8h (form with validation, tabs, conditional fields) | 8–16h (wizard form, file upload, dynamic rules) | 16–24h (complex multi-step form with approval) |
| FE-COMP New Component | 1–3h (simple wrapper, display component) | 3–6h (interactive component with events) | 6–12h (complex table/tree with virtual scroll) | 12–20h (drag-drop, rich text editor integration) |
| FE-CHART Charts/Dashboard | 2–4h (single static chart) | 4–8h (dashboard with 3–5 charts, filters) | 8–16h (real-time dashboard, drill-down, animations) | 16–32h (large-screen display, multiple data sources) |
| FE-ADAPT Mobile/Theme/i18n | 1–2h (minor responsive fix) | 2–6h (full page responsive adaptation) | 6–12h (theme system, dark mode) | 12–24h (full i18n with 3+ languages, RTL) |

## Backend Estimates

| Category | Low | Medium | High | Very High |
|----------|-----|--------|------|-----------|
| BE-CRUD New CRUD Module | 2–4h (single table, standard fields) | 4–8h (2–3 related tables, basic validation) | 8–16h (complex entity graph, business rules) | 16–24h (full module with multiple entities, audit) |
| BE-BIZ-NEW New Business Logic | 2–4h (simple calculation, field derivation) | 4–8h (multi-step process, state machine) | 8–16h (financial calculation, reconciliation) | 16–32h (complex workflow engine, approval chain) |
| BE-BIZ-MOD Modify Business Logic | 1–2h (parameter change, threshold adjust) | 2–4h (logic branch modification) | 4–8h (core algorithm replacement) | 8–16h (fundamental process redesign) |
| BE-BATCH Scheduled Task/Batch | 2–4h (simple nightly job, single query) | 4–8h (batch with chunking, retry, logging) | 8–16h (distributed batch, data reconciliation) | 16–32h (high-volume batch with monitoring, alerting) |
| BE-MQ Message Queue | 2–4h (simple producer/consumer, single queue) | 4–8h (multi-topic, dead letter, retry) | 8–16h (event-driven architecture, saga pattern) | 16–24h (distributed transaction, idempotency) |
| BE-API-NEW New API (Provider) | 1–2h (simple CRUD endpoint, <5 fields) | 2–4h (complex validation, pagination, sorting) | 4–8h (multi-resource endpoint, file upload) | 8–16h (API gateway integration, rate limiting) |
| BE-API-CONSUME Consume External API | 2–4h (simple REST call, JSON response) | 4–8h (auth token, retry, circuit breaker) | 8–16h (SOAP, complex mapping, pagination) | 16–24h (multi-system orchestration, compensation) |
| BE-API-MOD Modify Existing API | 0.5–1h (field addition/removal) | 1–3h (response structure change, new params) | 3–6h (breaking change, migration needed) | 6–12h (API versioning, backward compatibility) |
| BE-QRY-NEW New Query API | 1–2h (single table, basic where clause) | 2–4h (multi-table join, aggregation, pagination) | 4–8h (complex search with filters, full-text) | 8–16h (cross-database query, real-time aggregation) |
| BE-QRY-MOD Modify Query API | 0.5–1h (add filter condition) | 1–3h (join optimization, new sort field) | 3–6h (query rewrite for performance) | 6–12h (materialized view, denormalization) |
| BE-3RD Third-Party API Integration | 4–8h (single provider, well-documented) | 8–16h (OAuth flow, webhook handling) | 16–24h (multi-provider, protocol conversion) | 24–40h (custom protocol, real-time streaming) |
| BE-FLOW-NEW New Workflow | 4–8h (2–3 step approval) | 8–16h (multi-node with conditions, delegation) | 16–24h (parallel approval, dynamic assignment) | 24–40h (complex BPMN, subprocess, timer events) |
| BE-FLOW-MOD Workflow Adjustment | 1–2h (add/remove single node) | 2–4h (change flow path, add conditions) | 4–8h (restructure branch logic) | 8–16h (fundamental flow redesign) |
| BE-PERM Permission/Menu Config | 0.5–1h (add menu item, assign role) | 1–2h (new permission group, button-level control) | 2–4h (data-level permission, dynamic menu) | 4–8h (multi-tenant permission architecture) |
| BE-IMP-NEW New Import | 2–4h (simple Excel, <20 fields, no validation) | 4–8h (validation rules, error reporting) | 8–16h (large file streaming, async import) | 16–24h (multi-sheet, template generation, rollback) |
| BE-IMP-MOD Modify Import | 1–2h (add/remove column) | 2–4h (new validation rules, field mapping change) | 4–8h (format change, new error handling) | 8–12h (complete template redesign) |
| BE-EXP-NEW New Export | 2–4h (simple list export, <20 fields) | 4–8h (complex formatting, multi-sheet) | 8–16h (large dataset streaming, async export) | 16–24h (report-style export with charts, PDF) |
| BE-EXP-MOD Modify Export | 1–2h (add/remove column) | 2–4h (format change, new conditional styling) | 4–8h (template redesign, new data source) | 8–12h (complete export logic rewrite) |
| BE-DATA Data Processing | 2–4h (simple data migration, <10k rows) | 4–8h (transformation logic, data cleansing) | 8–16h (cross-system sync, conflict resolution) | 16–32h (large-scale ETL, data quality framework) |
| BE-RPT-STAT Report Statistics | 2–4h (single aggregation query) | 4–8h (multi-dimension report, charts) | 8–16h (real-time statistics, caching strategy) | 16–24h (OLAP integration, drill-down analysis) |
| BE-RPT-ANALYSIS Report Analysis | 4–8h (trend analysis, comparison report) | 8–16h (multi-source analysis, anomaly detection) | 16–24h (predictive analysis, ML model integration) | 24–40h (full BI dashboard backend) |
| BE-RPT-CHANGE Report Change | 1–2h (modify existing query condition) | 2–4h (add new dimension, change layout) | 4–8h (data source change, aggregation rewrite) | 8–16h (report architecture overhaul) |

## Data Engineering Estimates

| Category | Low | Medium | High | Very High |
|----------|-----|--------|------|-----------|
| DE-ODS ODS Layer | 2–4h (single source, standard schema) | 4–8h (multi-source, schema mapping) | 8–16h (CDC setup, data quality checks) | 16–24h (real-time ingestion, error handling) |
| DE-DWD DWD Layer | 4–8h (single table cleansing, standard rules) | 8–16h (multi-table join, deduplication) | 16–24h (complex transformation, SCD handling) | 24–32h (full dimension hub, data lineage) |
| DE-DWS DWS Layer | 4–8h (single aggregation subject) | 8–16h (multi-dimensional aggregation) | 16–24h (window functions, ranking, period comparison) | 24–40h (complex metric system, data mart) |
| DE-ADS ADS Layer | 2–4h (single application table) | 4–8h (multi-scenario aggregation) | 8–16h (real-time serving, wide table) | 16–24h (full application data store, API serving) |
| DE-SCHED Scheduling | 2–4h (simple DAG, <5 nodes) | 4–8h (complex DAG, dependencies, retry) | 8–16h (cross-system scheduling, SLA monitoring) | 16–24h (workflow orchestration platform) |
| DE-QUALITY Data Quality | 2–4h (basic null/type checks) | 4–8h (business rule validation, alerting) | 8–16h (comprehensive DQ framework, profiling) | 16–24h (automated remediation, data catalog) |
| DE-DIM Dimension Modeling | 4–8h (single dimension table) | 8–16h (star schema, SCD types) | 16–24h (snowflake schema, multi-fact) | 24–40h (enterprise data model, conformed dimensions) |
| DE-IND Indicator Development | 2–4h (atomic metric, simple calculation) | 4–8h (derived metric, composite calculation) | 8–16h (metric system with versioning, lineage) | 16–24h (full indicator management platform) |
| DE-CHANGE Change Optimization | 2–4h (query optimization, index addition) | 4–8h (partition adjustment, rewrite logic) | 8–16h (architecture refactoring, storage optimization) | 16–24h (full pipeline re-architecture) |

## Testing Estimates

| Category | Low | Medium | High | Very High |
|----------|-----|--------|------|-----------|
| TEST-CASE Test Case Related | 2–4h (write test cases, <20 scenarios) | 4–8h (comprehensive cases, edge cases, boundary) | 8–16h (automation scripts, data preparation) | 16–24h (full test suite, environment setup) |
| TEST-R1 Round 1 Testing | 4–8h (basic functional verification, <50 items) | 8–16h (full feature testing, cross-module) | 16–24h (regression, compatibility, data validation) | 24–40h (comprehensive testing, performance, security) |
| TEST-R2 Round 2 Testing | 2–4h (bug verification, regression) | 4–8h (focused regression, new edge cases) | 8–16h (full regression, cross-browser/device) | 16–24h (comprehensive regression with new scenarios) |

## Other Estimates

| Category | Low | Medium | High | Very High |
|----------|-----|--------|------|-----------|
| OTHER-RES Research | 2–4h (single technology evaluation) | 4–8h (multi-option comparison, POC) | 8–16h (deep technical investigation, benchmark) | 16–24h (architecture research, feasibility study) |
| OTHER-DESIGN Technical Solution Design | 4–8h (simple feature, <5 pages) | 8–16h (medium feature, sequence/ER diagrams) | 16–24h (system design, interface contracts, data model) | 24–40h (architecture design, performance planning) |

## Quick Estimation Checklist

Before finalizing each estimate, verify:

- [ ] Pure coding time identified (reference table above)
- [ ] Self-test overhead added (+20%)
- [ ] Integration overhead added if applicable (+15–25%)
- [ ] Environment config overhead added if new module (+5–10%)
- [ ] Uncertainty buffer applied if >30% unknown (+50%)
- [ ] Final value rounded to nearest 0.5h
- [ ] No task exceeds 24h — split if needed
- [ ] No task below 0.5h — merge with related task if needed
