import { Gate } from '../../src/access/gate.tsx';
import { DevicesScreen } from '../../src/screens/devices-screen.tsx';

/** Device management is gated on the registered `device.manage_own` permission. */
export default function Devices() {
    return (
        <Gate
            area="auth"
            requirement={{
                requiresAuth: true,
                requiresVerifiedEmail: true,
                allOf: ['device.manage_own'],
            }}
        >
            <DevicesScreen />
        </Gate>
    );
}
