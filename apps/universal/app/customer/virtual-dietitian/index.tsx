import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/** `/customer/virtual-dietitian` — what the Virtual Dietitian is, what it is not, and the sessions. */
const VirtualDietitianScreen = lazyScreen(
    'virtual-dietitian-loading',
    async () =>
        (await import('../../../src/features/virtual-dietitian/screens/index.ts'))
            .VirtualDietitianScreen,
);

export default function VirtualDietitianIndex() {
    return <VirtualDietitianScreen />;
}
