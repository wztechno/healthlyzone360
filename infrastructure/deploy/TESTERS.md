# Test accounts

One kitchen, four logins. Both instances run the same world: **HealthZone360
Kitchen**, built from the v6 workbooks by `healthzone-rebuild.sh` — the full
catalogue, every technical sheet, the allergen determinations and the derived
stock. There are no demonstration tenants any more; everything you see belongs
to this one kitchen or to the platform.

| Instance | URL | For |
| --- | --- | --- |
| prod | <https://157-230-121-66.nip.io> | what testers use; updated from `main` |
| dev | <https://dev.157-230-121-66.nip.io> | the working branch; updated from `dev` |

**Password:** `h360-NzvkXeQLXlYL` — for every account below, on both instances.

> A deploy never touches data. Nothing you create is reset by shipping code;
> only a deliberate rebuild (announced) does that.

## The accounts

| Role to test | Email | Person | Standing |
| --- | --- | --- | --- |
| **Kitchen owner** | `owner@healthzone360.test` | Hala Owner | Organisation owner + kitchen manager of HealthZone360 Kitchen |
| **Kitchen staff** | `staff@healthzone360.test` | Sami Staff | Branch manager at the kitchen's branch |
| **Customer** | `customer@healthzone360.test` | Carla Customer | A customer login, no saved address yet |
| **Platform operator** | `ops@healthy360.test` | Yara Deeb | Healthy360 Operations — the only platform-level account |

## What each one is for

**Kitchen owner** — `owner@healthzone360.test`
The whole back office: the v6 catalogue (155 items, 153 published — two meals
are deliberately unpublished because they have no allergen basis yet), all 29
recipes with their technical sheets (254 lines, every one resolved to an
ingredient), the 167 kitchen ingredients over the 337-item platform library,
derived stock, price lists, sales channels, delivery zones, suppliers and
purchasing. Recipe costing works because the library carries prices.

**Kitchen staff** — `staff@healthzone360.test`
The production floor: kitchen display, orders, production plan, stock at branch
level. Also the account for checking that a branch-scoped login cannot reach
organisation-wide settings.

**Customer** — `customer@healthzone360.test`
The shop as a buyer sees it: browse the one kitchen's published menu, add to a
basket, set an address at checkout, place an order, follow it.

**Platform operator** — `ops@healthy360.test`
Above the kitchen: platform administration, the shared ingredient library and
its allergen classes, reference data. Nothing kitchen-specific.

## Notes for testers

- **Mail is not delivered.** Password resets and verification links are written
  to the application log instead of being sent. Ask whoever runs the instance
  if a link is needed.
- **Payments are simulated.** No card is charged and no real payment provider is
  contacted.
- **Data persists.** Shipping code migrates the schema and touches nothing else.
  What you create stays until a rebuild is explicitly announced.
- **Two-factor** is not enrolled on any of these accounts.
- **Arabic and right-to-left** are reachable by switching language in-app.
