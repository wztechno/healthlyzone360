<!--
    SYNTHETIC FIXTURE. Two sheets of invented dropdown values. The delivery
    windows are named and, exactly as in the source, carry no times; the
    delivery areas are twelve made-up names under a heading that states the
    count. No real customer data, area name or consent wording appears here.
-->

Sheet1:Fixture Workbook — Customer Data Structure

| Synthetic fixture data for the customer-data parser. | Synthetic fixture data for the customer-data parser. |
| --- | --- |
| Document | Customer Data Structure — fixture |
| Sheets | Only the dropdown reference sheet carries anything this parser reads. |

Sheet2:3 · D2C Customer Data  (field specification)

| One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. | One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. | One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. | One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. | One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. | One row per customer field. The "Source list" column names the dropdown that populates the field — it is not the dropdown itself. |
| --- | --- | --- | --- | --- | --- |
| # | Field | Description | Input | Required | Source list |
| 25 | Delivery Area | Routing zone. | Dropdown | Y | Delivery Areas |
| 26 | Preferred Delivery Window | Time slot preference. | Dropdown | N | Delivery Window |
| G. Payment | G. Payment | G. Payment | G. Payment | G. Payment | G. Payment |
| 27 | Payment Method | Default pay option. | Dropdown | Y | Payment Method |
| 28 | Saved Card (token) | Tokenised card reference. | Secure | N | — |

Sheet4:5 · Reference — Dropdown Tables

| Controlled value lists that populate every dropdown across the other sheets. | Controlled value lists that populate every dropdown across the other sheets. | Controlled value lists that populate every dropdown across the other sheets. | Controlled value lists that populate every dropdown across the other sheets. | Controlled value lists that populate every dropdown across the other sheets. | Controlled value lists that populate every dropdown across the other sheets. |
| --- | --- | --- | --- | --- | --- |
| Profile Type | Gender | Primary Goals | Activity Level |  |  |
| Customer | Male | Weight Loss | No Exercise |  |  |
|  | Female | Muscle gain | Light Exercise |  |  |
| Payment Method | Account Status | Delivery Window | Portion Size |  |  |
| Card | Active | Morning | Regular |  |  |
| Cash on Delivery | Inactive | Afternoon | Large |  |  |
| Wallet | Blocked | Evening | Family |  |  |
| Bank Transfer | Pending |  |  |  |  |
| Business Type | B2B Product Categories | Volume Band | Order Frequency |  |  |
| Restaurant | Bulk fresh produce | < 25 kg / mo | Daily |  |  |
| Hotel | Frozen meals | 25-50 kg / mo | Weekly |  |  |
| Delivery Areas  (12 zones — fixture region; extend per country when scaling) | Delivery Areas  (12 zones — fixture region; extend per country when scaling) | Delivery Areas  (12 zones — fixture region; extend per country when scaling) | Delivery Areas  (12 zones — fixture region; extend per country when scaling) | Delivery Areas  (12 zones — fixture region; extend per country when scaling) | Delivery Areas  (12 zones — fixture region; extend per country when scaling) |
| Fixture Area One | Fixture Area Two | Fixture Area Three | Fixture Area Four | Fixture Area Five | Fixture Area Six |
| Fixture Area Seven | Fixture Area Eight | Fixture Area Nine | Fixture Area Ten | Fixture Area Eleven | Fixture Area Twelve |
