import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/roles` — what each job title is allowed to reach. */
const RolesScreen = lazyScreen(
    'kitchen-roles-loading',
    async () => (await import('../../../src/features/kitchen-admin/screens/index.ts')).RolesScreen,
);

export default function KitchenRoles() {
    return <RolesScreen />;
}
