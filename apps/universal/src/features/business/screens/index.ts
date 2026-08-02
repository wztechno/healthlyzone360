/**
 * The corporate and partner workspaces' screens, as one lazily-loaded chunk.
 *
 * Two route areas rather than one, deliberately: `/corporate` and `/partner` are the buyer's and the
 * supplier's side of the same commercial relationship, they share the programme, catalogue and
 * quotation vocabulary, and a person who has one of them usually has the other. See
 * `kitchen-admin/screens/index.ts` for why the split is per area rather than per screen.
 */
export { CatalogueItemScreen } from './catalogue-item-screen.tsx';
export { CorporateCatalogueScreen } from './corporate-catalogue-screen.tsx';
export { CorporateDashboardScreen } from './corporate-dashboard-screen.tsx';
export { PartnerCommitmentsScreen } from './partner-commitments-screen.tsx';
export { PartnerScheduleScreen } from './partner-schedule-screen.tsx';
export { QuotationBuilderScreen } from './quotation-builder-screen.tsx';
export { QuotationsScreen } from './quotations-screen.tsx';
