import { Redirect } from 'expo-router';

/**
 * `/clinic` — no backend, no screen. See `app/patient/index.tsx`; `clinicWorkspace` is unavailable
 * and the area layout redirects before this mounts.
 */
export default function ClinicIndex() {
    return <Redirect href="/" />;
}
