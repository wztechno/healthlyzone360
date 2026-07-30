import { ShowcaseScreen } from '../../src/screens/showcase-screen.tsx';

/** `/platform-admin/showcase` — guarded by the area layout's `platform.access_admin` gate. */
export default function Showcase() {
    return <ShowcaseScreen />;
}
