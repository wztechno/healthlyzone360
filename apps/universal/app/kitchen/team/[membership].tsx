import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/team/{membership}` — one person's roles, where they work, and whether they still may. */
const TeamMemberScreen = lazyScreen(
    'kitchen-team-member-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).TeamMemberScreen,
);

export default function KitchenTeamMember() {
    return <TeamMemberScreen />;
}
