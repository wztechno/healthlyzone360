import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/kitchen/roles/{role}` — one role and everything it grants. Read-only for a platform template. */
const RoleEditorScreen = lazyScreen(
    'kitchen-role-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RoleEditorScreen,
);

export default function KitchenRole() {
    return <RoleEditorScreen />;
}
