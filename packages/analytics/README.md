# @healthy360/analytics

A contract, not an integration. This package declares the closed `AnalyticsEvent` union for the
foundation vertical slice (`auth.login_submitted`, `auth.login_succeeded`,
`auth.registration_completed`, `context.organisation_selected`, `context.branch_selected`,
`workspace.switched`) with fully typed primitive properties — no free-text payloads, no identifiers
that are not already opaque, and nothing that could carry clinical or financial content into a
third-party pipeline. It ships the `AnalyticsClient` interface plus two implementations that need no
vendor: `NoopAnalytics` (production default until a provider is chosen and privacy-reviewed) and
`ConsoleAnalytics` (development visibility). **No vendor SDK and no network access live here.**
Choosing a provider is a separate, consent- and privacy-reviewed decision; when that happens, the
adapter implements `AnalyticsClient` and nothing else in the codebase changes.
