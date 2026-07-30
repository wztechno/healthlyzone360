import { LandingScreen } from '../src/screens/landing-screen.tsx';

/** `/` — session-restoration splash, then a redirect to wherever the kernel says this user belongs. */
export default function Index() {
    return <LandingScreen />;
}
