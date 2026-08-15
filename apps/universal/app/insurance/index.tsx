import { Redirect } from 'expo-router';

/**
 * `/insurance` — no backend, no screen. See `app/patient/index.tsx`; `insuranceWorkspace` is
 * unavailable and the area layout redirects before this mounts.
 */
export default function InsuranceIndex() {
    return <Redirect href="/" />;
}
