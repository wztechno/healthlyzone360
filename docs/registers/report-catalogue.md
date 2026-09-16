# Report Catalogue

**Current position (2026-09-19): five operational reports are implemented, all kitchen-facing, all
behind a costs permission.** The line about "no reports or dashboards" held until INV1.4 and stopped
being true then; it is corrected here rather than left to mislead. What is still deferred is the
*Reporting module* — role-specific dashboards for patients, dietitians, clinics and delivery partners
(module registry; Plan §28). Nothing below serves any of those audiences.

Every one of these is **computed live**, never materialised, and every one reports **per currency**
with no grand total: this system has no exchange-rate source and refuses to add unlike money. Each
also publishes its own completeness rather than implying it — a figure that is understated says so,
because a report that reads low and complete is worse than one that reads low and explains itself.

## Implemented reports

| ID | Report | Endpoint | Gated by | Status |
|---|---|---|---|---|
| R-001 | **Procurement spend summary** — the goods-receipt ledger rolled into ISO weeks and calendar months over the receipt's business date, item subtotal kept apart from full supplier-invoice spend | `GET /catalogue/procurement/spend-summary` | `inventory.view_costs_organisation` | Implemented (SUP6, D-102). Flags a period **Incomplete** when a delivery's price has not been entered, rather than dropping the line from an apparently finished total |
| R-002 | **Monthly cost report** — spend, cost of goods sold, waste, revenue and margin per month and currency, split meal against product on both the revenue and the COGS side | `GET /catalogue/reports/monthly-cost` | `inventory.view_costs_organisation` | Implemented (INV1.4, extended by PROD1). Now also carries production consumption, production waste as an "of which" breakdown of the waste row, finished-goods yield value stated as neither revenue nor expense, and estimated margin beside actual. **Three completeness flags, never merged** — what the month cost to buy, to sell, and to make are three different things to be wrong about |
| R-003 | **Inventory value** — `Σ quantity_on_hand × moving_average_cost_amount`, one row per currency | `GET /catalogue/reports/inventory-value` | `inventory.view_costs_organisation` | Implemented (PROD1, D-116). A **current** valuation and it says so in `meta.as_of`: there is no period close in this system and this does not invent one. Stock with no moving average is counted in `unvalued_item_count`, never valued at zero |
| R-004 | **Requirements forecast (buy list)** — every ingredient a date window needs against one branch's shelf, with `on_hand`, `reserved`, `available`, `short` and a suggested buy | `GET /catalogue/order-desk/requirements` | `inventory.view_organisation` | Implemented (order desk; extended by PROD1 to report availability net of production's claims). Days nobody could turn into a quantity are reported as holes beside the rows, never folded in as zeroes |
| R-005 | **Pending production valuations** — batches that finished without a cost the report can trust | `GET /catalogue/production/valuations-pending` | `inventory.view_costs_organisation` | Implemented (PROD1). A read with no completion write, deliberately: re-valuing a batch later needs to know how much of it is still on the shelf, which nothing records (OQ-052) |

Two smaller surfaces are report-shaped and are **not** listed above, because each is a working queue
rather than a report: the consumption-exception queue (`GET /catalogue/inventory/consumption-exceptions`,
with its own count endpoint for a hub badge) and the unpriced-receipts queue
(`GET /catalogue/procurement/unpriced-receipts`). They are named here so a reader looking for "where
does the system tell me something is wrong" finds all of it in one place.

## Candidate future reports (from source §9, unprioritised)

| Audience | Candidate reports |
|---|---|
| Patients | Progress dashboard; nutritional intake; weight and body measurements; meal-plan adherence |
| Dietitians | Appointment schedule; patient progress; adherence; consultation workload |
| Clinic managers | Clinic productivity; appointments; patient retention and engagement; complaints |
| Kitchens | Production output; inventory and waste; recipe costing; escalations |
| Delivery partners | Delivery performance; failed deliveries; service-level monitoring |
| Fitness providers | Session bookings; combined nutrition-and-fitness progress |
| Corporate customers | Participation and engagement; aggregated, anonymised population-health reporting |
| Insurance companies | Eligible-service utilisation; outcome reporting |
| Platform administrators | Platform usage; subscriptions; commissions; partner performance; security and compliance |
| Senior management | Revenue; churn and retention; service profitability; AI performance |

## Rules for future entries

- A report enters "Implemented" only with: owner audience, data sources, refresh cadence, export formats and access-control statement.
- Aggregated corporate/insurer reporting must respect the source-document constraint: individual health information is not disclosed to employers or other parties without a lawful basis and appropriate consent.
- Configurable periods, filters, visualisations and export formats (source §9) are catalogue-level requirements to be confirmed when the Reporting module is designed.
