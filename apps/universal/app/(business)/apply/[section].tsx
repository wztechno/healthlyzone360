import { Redirect, useLocalSearchParams } from 'expo-router';

import { FIRST_B2B_STEP, isB2BStepSlug } from '../../../src/features/b2b-application/sections.ts';
import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

/**
 * `/apply/{section}` — one wizard step.
 *
 * `{section}` is a **slug**, never an ordinal: `/apply/trade-terms` is the trade-terms step in every
 * build, in both languages, after any reordering. A step addressed by number would point somewhere
 * else the first time one was inserted, and every bookmark and every "change this" link on the
 * review screen would move with it.
 *
 * An unrecognised slug redirects to the first step rather than rendering a 404. A typo in a hand-
 * edited URL is not an error worth a dead end, and the wizard's own redirect then sends the person
 * on to whatever they have actually left unfinished.
 *
 * `sections.ts` is imported *statically* here — it is a few hundred bytes of tables and pure
 * functions, and the alternative is either a second dynamic import on the critical path of a tap or
 * a validity check duplicated in the route.
 */
const ApplyStepScreen = lazyScreen(
    'b2b-apply-step-loading',
    async () =>
        (await import('../../../src/features/b2b-application/screens/index.ts')).ApplyStepScreen,
);

export default function BusinessApplySection() {
    const { section } = useLocalSearchParams<{ section?: string }>();

    if (!isB2BStepSlug(section)) {
        return <Redirect href={`/apply/${FIRST_B2B_STEP}` as never} />;
    }

    return <ApplyStepScreen step={section} />;
}
