import { Callout } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

/**
 * The standing medical disclaimer.
 *
 * Mandatory wherever the application shows a nutrition target, a calculated figure, a Virtual
 * Dietitian suggestion, a planner warning, a medical onboarding step or a professional review
 * (plan §5). Presence is asserted by test rather than left to reviewer memory.
 *
 * Three deliberate properties:
 *
 * 1. **The copy is fixed and translated, never composed at the call site.** A disclaimer whose
 *    wording varies by screen is a disclaimer that will eventually be weakened by someone shortening
 *    it to fit a card.
 * 2. **`role="note"`, not `alert`.** It is always true, so announcing it as an interruption on every
 *    screen would train people to skip it — the exact opposite of the intent.
 * 3. **One test id.** `medical-disclaimer` is how every later wave's test asserts that the notice
 *    reached the screen; a per-screen id would make that assertion per-screen too.
 *
 * ## Why the copy lives in the `marketplace` namespace
 *
 * It is read by every wave, so it belongs in a namespace no single wave owns — `common` would be
 * the natural home, but `common` is the orchestrator's file and this component had to ship with its
 * strings. `marketplace:medicalDisclaimer.*` is collision-free and stable; moving it to `common`
 * later is a catalogue edit and one `t()` prefix, with no behaviour attached.
 */
export interface MedicalDisclaimerProps {
    /**
     * Adds a sentence specific to the screen — for example that a figure came from a prototype
     * calculator. The fixed copy is always rendered as well; this never replaces it.
     */
    readonly context?: string | undefined;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
}

export const MEDICAL_DISCLAIMER_TEST_ID = 'medical-disclaimer';

export function MedicalDisclaimer({
    context,
    testID = MEDICAL_DISCLAIMER_TEST_ID,
    className,
}: MedicalDisclaimerProps) {
    const { t } = useTranslation();

    return (
        <Callout
            testID={testID}
            role="note"
            tone="info"
            icon="info"
            title={t('marketplace:medicalDisclaimer.title')}
            body={
                context === undefined
                    ? t('marketplace:medicalDisclaimer.body')
                    : `${t('marketplace:medicalDisclaimer.body')} ${context}`
            }
            {...(className === undefined ? {} : { className })}
        />
    );
}
