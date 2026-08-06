import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/platform-admin/showcase` — guarded by the area layout's `organisation.manage_platform` gate. */
const ShowcaseScreen = lazyScreen(
    'showcase-loading',
    async () => (await import('../../src/screens/showcase-screen.tsx')).ShowcaseScreen,
);

export default function Showcase() {
    return <ShowcaseScreen />;
}
