import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/roles/new` — define a role of this kitchen's own.
 *
 * `?from={role}` seeds the form from an existing one, which is how Copy works on a platform
 * template: the only supported way to change what one means inside a kitchen.
 */
const RoleEditorScreen = lazyScreen(
    'kitchen-role-editor-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).RoleEditorScreen,
);

export default function KitchenRoleNew() {
    return <RoleEditorScreen />;
}
