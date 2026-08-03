import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';
import { useSession } from '../../../src/session/session-provider.tsx';

/**
 * `/corporate/account/wind-down` — the end of a commercial relationship, from the buyer's side.
 *
 * The organisation comes from the **active context**, not from a route parameter. A wind-down is
 * the relationship this person is currently acting inside; putting the identifier in the URL would
 * invite somebody to type another company's, and would make the screen's answer depend on the
 * address bar rather than on which organisation the session is scoped to.
 */
const WindDownScreen = lazyScreen(
    'wind-down-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts')).WindDownScreen,
);

export default function CorporateWindDown() {
    const { me } = useSession();
    const organisationId = me?.activeContext?.organisationId ?? null;

    return <WindDownScreen organisationId={organisationId ?? undefined} />;
}
