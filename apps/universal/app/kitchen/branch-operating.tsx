import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/branch-operating` — the current branch's trading week and order cut-offs.
 *
 * No route parameter, and that is the contract's shape rather than a simplification: the whole
 * `kitchen` area already requires a branch context (`@healthy360/permissions`), and
 * `KitchenAdminRepository` publishes no branch listing a picker could be built from. The screen
 * edits the branch already in context and says so.
 */
const BranchOperatingScreen = lazyScreen(
    'kitchen-branch-hours-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts')).BranchOperatingScreen,
);

export default function KitchenBranchOperating() {
    return <BranchOperatingScreen />;
}
