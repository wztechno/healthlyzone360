import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/team/new` — invite an employee, or mint the login here and hand over the password. */
const StaffCreateScreen = lazyScreen(
    'kitchen-staff-create-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).StaffCreateScreen,
);

export default function KitchenStaffCreate() {
    return <StaffCreateScreen />;
}
