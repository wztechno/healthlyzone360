import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/apply/provisioning` — the named steps that turn a signed agreement into an open account. */
const ApplyProvisioningScreen = lazyScreen(
    'b2b-apply-provisioning-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts'))
            .ApplyProvisioningScreen,
);

export default function BusinessApplyProvisioning() {
    return <ApplyProvisioningScreen />;
}
