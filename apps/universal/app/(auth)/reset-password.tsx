import { ResetPasswordScreen } from '../../src/screens/reset-password-screen.tsx';

/** `/reset-password?token=…&email=…` — both come from the emailed link. */
export default function ResetPassword() {
    return <ResetPasswordScreen />;
}
