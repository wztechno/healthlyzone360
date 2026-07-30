import { Gate } from '../../src/access/gate.tsx';
import { BranchPickerScreen } from '../../src/screens/branch-picker-screen.tsx';

/**
 * The gate asks only for a signed-in, verified user.
 *
 * It must *not* ask for an organisation context: the kernel demands a branch whenever the route
 * requires an organisation and the active membership is branch-scoped, which is exactly this
 * screen's situation — it would redirect to itself for ever. The organisation check therefore lives
 * in the screen, which sends a contextless visitor to the organisation picker instead.
 */
export default function SelectBranch() {
    return (
        <Gate area="auth" requirement={{ requiresAuth: true, requiresVerifiedEmail: true }}>
            <BranchPickerScreen />
        </Gate>
    );
}
