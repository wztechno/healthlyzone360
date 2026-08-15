import { useLocalSearchParams } from 'expo-router';

import { InvitationScreen } from '../../src/features/invitations/screens/invitation-screen.tsx';

/**
 * `/invitations/{token}` — the destination of the invitation email.
 *
 * No `generateStaticParams`, for a sharper reason than the marketplace's: the parameter here is a
 * **credential**, and pre-rendering a path that contains one would write live tokens into the
 * static export. The static server falls back to the application shell for extension-less paths, so
 * the deep link resolves client-side.
 *
 * The token is passed through unvalidated. A malformed one is a data state — the API answers the
 * same `404` it gives an unknown token — and validating its shape here would only teach a client
 * to distinguish two cases the server deliberately does not.
 */
export default function Invitation() {
    const { token } = useLocalSearchParams<{ token?: string }>();
    return <InvitationScreen token={token} />;
}
