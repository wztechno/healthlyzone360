import { Badge, Button, Callout, Inline } from '@healthy360/design-system';
import type { ButtonSize, ButtonVariant } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { PROTOTYPE_ACTION_TEST_ID, usePrototypeAction } from './prototype-action.ts';

/**
 * The standing "this is a prototype" notice.
 *
 * A `note`, never an `alert`: it is true for the whole screen and for the whole session, and a
 * live-region announcement for something that is always the case is how a screen-reader user learns
 * to tune the notices out.
 */
export interface PrototypeNoticeProps {
    /** Overrides the standard body — used where a screen has something specific to disclose. */
    readonly body?: string | undefined;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
}

export function PrototypeNotice({
    body,
    testID = 'prototype-notice-banner',
    className,
}: PrototypeNoticeProps) {
    const { t } = useTranslation();

    return (
        <Callout
            testID={testID}
            role="note"
            tone="info"
            icon="prototype"
            title={t('marketplace:prototype.noticeTitle')}
            body={body ?? t('marketplace:prototype.noticeBody')}
            {...(className === undefined ? {} : { className })}
        />
    );
}

/**
 * A control for a capability that does not exist yet.
 *
 * Three things always travel together, which is the whole reason this is a component rather than a
 * convention: the fixed `prototype-action` test id (so the Playwright sweep can find every one of
 * them), the visible `prototype` badge, and the accessibility hint. Assembling those by hand at
 * each call site is how one of them eventually goes missing.
 */
export interface PrototypeButtonProps {
    readonly label: string;
    /** Proposed endpoint or capability. Development builds show it in the notice. */
    readonly contract: string;
    /** Replaces the standard "Not built yet" sentence in the toast. */
    readonly message?: string | undefined;
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    /** Hides the badge where the surrounding block already carries one. */
    readonly showBadge?: boolean | undefined;
    readonly className?: string | undefined;
}

export function PrototypeButton({
    label,
    contract,
    message,
    variant = 'secondary',
    size,
    showBadge = true,
    className,
}: PrototypeButtonProps) {
    const { t } = useTranslation();
    const run = usePrototypeAction();

    return (
        <Inline space="xs" align="center" {...(className === undefined ? {} : { className })}>
            <Button
                testID={PROTOTYPE_ACTION_TEST_ID}
                label={label}
                variant={variant}
                {...(size === undefined ? {} : { size })}
                accessibilityHint={t('marketplace:prototype.hint')}
                onPress={() => {
                    run({ contract, ...(message === undefined ? {} : { message }) });
                }}
            />
            {showBadge ? (
                <Badge
                    tone="info"
                    icon="prototype"
                    label={t('marketplace:prototype.badge')}
                    testID="prototype-badge"
                />
            ) : null}
        </Inline>
    );
}
