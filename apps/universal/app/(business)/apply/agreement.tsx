import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/apply/agreement` — read the terms, step up with a code, accept. */
const ApplyAgreementScreen = lazyScreen(
    'b2b-apply-agreement-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts'))
            .ApplyAgreementScreen,
);

export default function BusinessApplyAgreement() {
    return <ApplyAgreementScreen />;
}
