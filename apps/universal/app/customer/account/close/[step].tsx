import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../../../src/shell/lazy-screen.tsx';

/**
 * `/customer/account/close/{step}` — the closure wizard.
 *
 * A route parameter rather than local state, so a person who reloads on the checks step lands back
 * on the checks step, and so support can be told "open `/customer/account/close/checks`". The screen
 * re-reads the live request on mount and resumes from it — the step in the URL says what to draw,
 * never what has happened.
 *
 * The one exception is `done`, whose `?scope=` says which of the two things finished, because the
 * write that finished it belonged to the previous step's screen. The answers given on the way —
 * reason, note, scope — are not in the URL: they sit in the wizard's session draft.
 */
const ClosureWizardScreen = lazyScreen(
    'closure-wizard-loading',
    async () =>
        (await import('../../../../src/features/account/screens/index.ts')).ClosureWizardScreen,
);

export default function ClosureStep() {
    const { step, scope } = useLocalSearchParams<{ step?: string; scope?: string }>();
    return <ClosureWizardScreen step={step} scope={scope} />;
}
