import { AccountClosedScreen } from '../../src/features/account/screens/account-closed-screen.tsx';

/**
 * `/account-closed` — the confirmation a completed full closure ends on. Public, deliberately: the
 * closure ended the session, and a page behind the customer gate would answer with sign-in.
 */
export default function AccountClosed() {
    return <AccountClosedScreen />;
}
