# Test accounts

Nine accounts, one per vantage point on the product. They come from the demo
seeders (`apps/api/database/seeders/`), so they are recreated identically every
time the instance is re-seeded — a tester who breaks something gets it back on
the next deploy.

**Site:** <https://157-230-121-66.nip.io>
**Password:** `password` — for every account below.

> These are demonstration accounts on a test instance holding synthetic data.
> Nothing here is a real person, a real kitchen or a real payment.

## The accounts

| Role to test | Email | Person | Belongs to |
| --- | --- | --- | --- |
| **Platform operator** | `ops@healthy360.test` | Yara Deeb | Healthy360 Operations |
| **Clinic owner** | `owner@cedar.test` | Nadia Haddad | Cedar Clinic |
| **Dietitian** | `dietitian@cedar.test` | Rami Khoury | Cedar Clinic + Verdant Kitchen |
| **Two-factor login** | `two-factor@cedar.test` | Sami Nasr | Cedar Clinic |
| **Kitchen owner** | `owner@verdant.test` | Layla Mansour | Verdant Kitchen |
| **Kitchen staff / chef** | `chef@verdant.test` | Omar Saleh | Verdant Kitchen, Al Quoz branch |
| **Patient** | `patient@healthy360.test` | Maya Aoun | Cedar Clinic |
| **Consumer buyer** | `nour@healthy360.test` | Nour Haddad | — (self-service customer) |
| **Corporate buyer** | `buyer@acme-wellness.test` | Sara Haddad | Acme Wellness |

## What each one is for

**Platform operator** — `ops@healthy360.test`
The only account holding platform-level permissions, through a bespoke
`reference_editor` role rather than a template (no template can carry a platform
code). Reference data, the shared ingredient library, and the platform
administration surfaces. Also carries catalogue and inventory permissions so the
kitchen operating surface is reachable from here.

**Clinic owner** — `owner@cedar.test`
Owns Cedar Clinic: two branches (Hamra, Jounieh), Lebanon, LBP, Arabic as the
organisation language — so this account is also the way to see the app
right-to-left. Organisation settings, membership, branches, clinic services.

**Dietitian** — `dietitian@cedar.test`
Deliberately a member of *two* organisations with different standing in each — a
practitioner at Cedar's Hamra branch and a plain member at Verdant. Use it to
test organisation switching and that permissions do not leak across the switch.

**Two-factor login** — `two-factor@cedar.test`
Fully enrolled in TOTP against the fixed secret `JBSWY3DPEHPK3PXP`. Add that
secret to any authenticator app (it is the canonical RFC 4648 test vector) to
generate valid codes, or use it to exercise recovery codes and step-up
confirmation.

**Kitchen owner** — `owner@verdant.test`
Owns Verdant Kitchen (Dubai, USD, Arabic) and additionally holds
`kitchen_manager`. The widest kitchen-side account: product catalogue,
formulations, pricing and tariffs, the three sales channels (web shop, wholesale,
counter), delivery zones, inventory and procurement.

**Kitchen staff / chef** — `chef@verdant.test`
Branch manager at Al Quoz — the production floor rather than the back office.
Kitchen display, order fulfilment, stock at branch level. Use it to check that a
branch-scoped account cannot reach organisation-wide settings.

**Patient** — `patient@healthy360.test`
A member of Cedar Clinic on the receiving end of care: plans, appointments and
dietary profile as the patient sees them.

**Consumer buyer** — `nour@healthy360.test`
The self-service shopping journey. Seeded with a verified email, an unverified
phone, and — importantly — an address inside a delivery area Verdant actually
claims, so the marketplace, subscription configurator and checkout all have
something deliverable to work with.

**Corporate buyer** — `buyer@acme-wellness.test`
Signatory for Acme Wellness, which holds a signed supply agreement with Verdant,
an agreement tariff and an employee-meals programme. The B2B side: programmes,
buyer catalogue, agreements.

## Notes for testers

- **Mail is not delivered.** Password resets, verification links and every other
  message are written to the application log instead of being sent. Ask whoever
  runs the instance for `docker compose logs api` if a link is needed.
- **Payments are simulated.** No card is charged and no real payment provider is
  contacted.
- **Data resets on re-deploy.** The seeders converge rather than duplicate, so
  demo records return to their seeded state; anything created on top of them
  survives unless the database volume is destroyed.
- **Arabic and right-to-left** are reachable from the two Arabic-language
  organisations (Cedar Clinic, Verdant Kitchen) or by switching language in-app.
