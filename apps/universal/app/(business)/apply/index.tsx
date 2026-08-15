import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/apply` — start a B2B application, resume one, or read where it stands. */
const ApplyEntryScreen = lazyScreen(
    'b2b-apply-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts')).ApplyEntryScreen,
);

export default function BusinessApply() {
    return <ApplyEntryScreen />;
}
