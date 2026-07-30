import { Gate } from '../../src/access/gate.tsx';
import { DevicesScreen } from '../../src/screens/devices-screen.tsx';

/** Listing one's own sessions is itself a permission (`session.view_own`). */
export default function Devices() {
    return (
        <Gate
            area="auth"
            requirement={{
                requiresAuth: true,
                requiresVerifiedEmail: true,
                allOf: ['session.view_own'],
            }}
        >
            <DevicesScreen />
        </Gate>
    );
}
