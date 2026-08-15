import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/partner` — what a supplier has been asked to make, and for whom. No buyer prices, by design. */
const PartnerCommitmentsScreen = lazyScreen(
    'partner-commitments-loading',
    async () =>
        (await import('../../src/features/business/screens/index.ts')).PartnerCommitmentsScreen,
);

export default function PartnerIndex() {
    return <PartnerCommitmentsScreen />;
}
