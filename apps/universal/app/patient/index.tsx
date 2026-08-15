import { Redirect } from 'expo-router';

/**
 * `/patient` — no backend, no screen.
 *
 * `patientWorkspace` is unavailable (`src/features/availability.ts`), so the area layout redirects
 * before this ever mounts. It is still a real redirect rather than an empty component: a route file
 * that renders nothing is indistinguishable from one somebody forgot to finish.
 */
export default function PatientIndex() {
    return <Redirect href="/" />;
}
