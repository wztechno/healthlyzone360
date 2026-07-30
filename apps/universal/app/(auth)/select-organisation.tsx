import { Gate } from '../../src/access/gate.tsx';
import { OrganisationPickerScreen } from '../../src/screens/organisation-picker-screen.tsx';

/**
 * Needs a signed-in, verified user — but explicitly **not** an organisation context, because
 * choosing one is what this screen is for.
 */
export default function SelectOrganisation() {
    return (
        <Gate area="auth" requirement={{ requiresAuth: true, requiresVerifiedEmail: true }}>
            <OrganisationPickerScreen />
        </Gate>
    );
}
