import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/apply/status` — the eleven-state panel, and the applicant's own exit. */
const ApplyStatusScreen = lazyScreen(
    'b2b-apply-status-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts')).ApplyStatusScreen,
);

export default function BusinessApplyStatus() {
    return <ApplyStatusScreen />;
}
