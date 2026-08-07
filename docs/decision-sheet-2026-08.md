# Owner decision sheet — August 2026

What the platform needs from you, as data and decisions, to move past where it is today.
Everything buildable without you is built. Each row says what is blocked until you answer,
and what happens if you say nothing (the standing default). Answer in any order — nothing
here blocks anything else unless the row says so.

Status legend: **BLOCKING** = a built feature is waiting on this to be usable for real ·
**GATE** = a whole phase cannot start without it · **CONFIRM** = a default is live; say
"confirmed" or change it.

## A. Commercial data (kitchen can supply, no meetings needed)

| # | Needed | Why / blocked until then | Default if silent |
|---|---|---|---|
| A1 | **Real plan prices** for the 7 GreenLife plans (per variant × duration) | BLOCKING real sales — approximate prices I invented (your authorisation, 2026-08-02) are live on the marketplace | Approximates stay, clearly yours to edit in kitchen admin → price lists |
| A2 | **Missing product prices** — the source rows marked N/A, "depends on each day", and the dual 0.5/1 kg packs | Those items are unorderable (placeholder/market-priced rows are excluded from public sale by design) | They stay unorderable |
| A3 | **Caesar Sauce: which formula?** Two technical sheets with different quantities were imported as two draft versions (OQ-041) | Neither version can publish until you name the current one | Both stay draft |
| A4 | **~25 staple promotions** — the importer created ~40 kitchen-owned ingredients that look like platform-library staples (Panko, Chuck, Brisket…) | Curation only; reversible either way | They stay kitchen-owned |

## B. Food safety (needs the kitchen's word, not yours alone)

| # | Needed | Why | Default |
|---|---|---|---|
| B1 | **Kitchen confirmation of the flagged allergen mappings** — every derived mapping carries `requires_supplier_confirmation`; the burghul/pita gluten corrections are already applied by your decision | BLOCKING publication confidence — derived-not-confirmed is honest but weaker than confirmed | Flags stay visible in kitchen admin review queue |
| B2 | **Which allergen regimes apply** — EU-14 is the master; US Big-9 flags exist. Which markets do you actually serve? (OQ-038) | Determines which declarations must be complete before publish | EU-14 enforced, US flags informational |

## C. Payments — the PAY1 gate (biggest blocker; needs a working session)

| # | Decision | Why |
|---|---|---|
| C1 | **Payment provider(s)** for Lebanon (+UAE?): cards via which gateway, local wallets, or cash-first? Hosted checkout vs embedded fields (PCI boundary) | GATE for all of PAY1. Your hand-built payment-intent skeleton is now tenant-safe but connects to nothing |
| C2 | **COD reconciliation**: who marks an order paid, when, and what end-of-day settlement looks like | COD is the only live payment path today and it has no reconciliation |
| C3 | **Refund policy**: window, partial refunds, who approves | The refund cap is enforced; the policy around it is yours |
| C4 | **Subscription renewals**: auto-renew or manual re-purchase? At the grandfathered price or current? | S1 deliberately built no renewal — subscriptions simply end |
| C5 | **Invoicing & tax**: VAT status, invoice numbering rules, B2B credit terms (net-X?), settlement currency (USD, LBP, dual?) | GATE for B2B invoicing; S1 credit memos settle manually until this exists |
| C6 | **Wallet / loyalty**: do they exist as products at all? | Separate ownership decisions — excluded until you say otherwise |

## D. Fulfilment — the F1 gate (a session with the kitchen)

| # | Decision | Why |
|---|---|---|
| D1 | **Real production stages** the kitchen works in (your KDS build implies some) — states, who advances them, capacity limits | GATE for F1; C1's order lifecycle is deliberately minimal (placed→confirmed→fulfilled/cancelled) |
| D2 | **Delivery model**: own drivers only? third-party? assignment rules, failed-delivery and reschedule policy | Your driver-jobs surface exists; the dispatch logic behind it is unbuilt |
| D3 | **Customer notifications** for order status: which events, which channels | Email only until C7/G1 below |

## E. Nutrition — the N1 gate (one decision unlocks it)

| # | Decision | Why |
|---|---|---|
| E1 | **Authoritative nutrient source**: USDA FoodData Central, McCance, a commercial DB, lab analysis — and who maintains the per-ingredient mapping | GATE for everything nutrition: facts are honestly null today; planner/nutrition/virtual-dietitian screens stay mock until this exists. The platform will not fabricate numbers |

## F. Clinical — the CL1 gate

| # | Decision | Why |
|---|---|---|
| F1 | **Is the Patient journey real business now?** Clinic partnerships, practitioner access, clinical records | GATE. Currently "Patient = D2C-shaped account" is a documented temporary assumption (A-012) |

## G. Providers & integrations

| # | Needed | Why | Default |
|---|---|---|---|
| G1 | **SMS/WhatsApp provider** (OQ-008) | Phone OTP is log-stubbed; phone verification is OFF in production until a real provider exists (A-011) | Email-only verification in production |
| G2 | **Production email provider** — you added Brevo; CONFIRM it is the production choice and the sender domain is verified | OTP + invitations ride on it | Dev uses Mailpit; Brevo config as you left it |
| G3 | **Real e-signature** for B2B agreements (INT-007) or accept the current OTP click-wrap (honestly labelled, not "qualified") | B2B MSAs carry click-wrap evidence only | Click-wrap stands |
| G4 | **Malware scanning for KYC uploads** (INT-008) | Risk gate before onboarding strangers' documents for real | Uploads sniffed + size-capped only |

## H. Legal & policy (config defaults live; need sign-off, ideally counsel)

| # | Setting | Live default |
|---|---|---|
| H1 | Provisional (unfinished signup) account purge | 30 days |
| H2 | Guest data expiry / return window | 14 days |
| H3 | Order data retention after closure | 90 days, anonymised |
| H4 | Minimum age | 18 |
| H5 | B2B termination notice | 30 days |
| H6 | Consent & legal texts — the Arabic must be authored, not machine-translated (OQ-033); current texts are working copy | Working copy live |

## I. Smaller product calls

| # | Question | Default |
|---|---|---|
| I1 | Social login (Google/Apple) — build or keep deferred? | Deferred; schema reserved |
| I2 | French locale? | en + ar only |
| I3 | Public retail-product browsing (beyond meals/plans)? | Not built; products visible to kitchen + B2B only |
| I4 | Dietitian directory — fund a real backend or remove the surface? | Stays mock with honest labelling |
| I5 | **HARD1 timing** — the shelved full test/verification pass (all deferred suites, e2e, acceptance, visual). Strongly recommended before anything public | Shelved until you say run it |

---

*Answering C1–C5 in one sitting unlocks the most (real checkout, invoicing, settlement).
A1 + B1 are the cheapest wins — pure data entry through screens that already exist.*
