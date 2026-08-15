import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/privacy/delete-my-data` — erasure, on a public page.
 *
 * Deliberately not behind the guest token and not under `/customer`. The people most likely to need
 * this are the ones least likely to still hold a credential: they ordered once, months ago, from a
 * browser they have since cleared. A gate here would deny the right to exactly those people.
 *
 * The path is guessable on purpose — it is the URL a privacy policy links to and the one somebody
 * types from memory.
 */
const GuestDeletionScreen = lazyScreen(
    'guest-deletion-loading',
    async () => (await import('../../../src/features/guest/screens/index.ts')).GuestDeletionScreen,
);

export default function DeleteMyData() {
    return <GuestDeletionScreen />;
}
