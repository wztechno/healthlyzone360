# Report Catalogue

**Current position (2026-07-30): no reports or dashboards are implemented.** The foundation phase ships no reporting; role-specific dashboards are deferred to the Reporting module (module registry; Plan §28). The candidates below are taken honestly from the source instruction document (§9) as future scope — none is committed, prioritised or specified.

## Implemented reports

| ID | Report | Status |
|---|---|---|
| — | None | — |

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
