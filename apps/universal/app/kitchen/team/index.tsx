import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/team` — everybody who can sign in to this kitchen, and what each of them may reach. */
const TeamScreen = lazyScreen(
    'kitchen-team-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).TeamScreen,
);

export default function KitchenTeam() {
    return <TeamScreen />;
}
