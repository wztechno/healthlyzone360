import { useToast } from '@healthy360/design-system';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '../config.ts';

/**
 * The one no-dead-controls mechanism (plan §5).
 *
 * The prompt forbids dead buttons, and the honest answer to "this cannot work yet" is neither a
 * button that silently does nothing nor a button removed from the design. It is a control that
 * *says* what would have happened.
 *
 * Everything the prototype world can genuinely support — locking, regeneration, replacement,
 * portions, the cart, subscription pause and skip — mutates the fixture store for real and must
 * **not** come through here. This is reserved for capabilities that are genuinely absent: payment,
 * printing, export, sharing, quotation submission, and areas a later wave owns.
 *
 * What the person gets:
 *
 * * an info toast, `testID="prototype-notice"`, reading "Not built yet — nothing was changed";
 * * in a development build only, the proposed endpoint appended, so a reviewer can see which
 *   contract the control is waiting on without reading the source;
 * * on the control itself (see `PrototypeButton`) a `prototype` badge and an `accessibilityHint`,
 *   so the promise is made *before* the press rather than only after it.
 */
export interface PrototypeActionOptions {
    /**
     * The proposed endpoint or capability this control is waiting on, e.g.
     * `POST /api/v1/subscriptions/{id}/pause`. Shown in development builds only — it is a
     * diagnostic for reviewers, not user-facing copy, which is why it is not translated.
     */
    readonly contract: string;
    /** Overrides the standard sentence when a control needs to say something more specific. */
    readonly message?: string | undefined;
}

export const PROTOTYPE_NOTICE_TEST_ID = 'prototype-notice';
/**
 * Applied by `PrototypeButton`, so a Playwright sweep can press every button-shaped prototype
 * control. It does NOT reach prototype controls hosted by other primitives — the planner week's
 * share and export are `ActionSheet` rows carrying only their own test ids — so the sweep spec
 * (`prototype-actions.ltr.spec.ts`) additionally names those explicitly. If you add a prototype
 * control that is not a `PrototypeButton`, add it to that spec's pinned list.
 */
export const PROTOTYPE_ACTION_TEST_ID = 'prototype-action';

export type PrototypeActionRunner = (options: PrototypeActionOptions) => void;

export function usePrototypeAction(): PrototypeActionRunner {
    const { t } = useTranslation();
    const toast = useToast();

    return useCallback(
        ({ contract, message }: PrototypeActionOptions) => {
            const body = message ?? t('marketplace:prototype.notBuilt');
            toast.show({
                // The contract line is a development affordance. A preview build shows the same
                // honest sentence without the endpoint, because "POST /api/v1/…" is not something
                // to put in front of a person evaluating the product.
                message: appConfig.isDevelopment ? `${body} ${contract}` : body,
                tone: 'info',
                testID: PROTOTYPE_NOTICE_TEST_ID,
            });
        },
        [t, toast],
    );
}
