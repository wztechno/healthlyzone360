import type { VdMessage } from '@healthy360/api-client/contracts';
import { EmptyState, FadeIn, Heading, Inline, Stack, Text, cx } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OriginBadge } from './origin-badge.tsx';
import { originKindOf } from './state-presentation.ts';
import type { VdOriginKind } from './state-presentation.ts';

/**
 * The conversation.
 *
 * ## Alignment is `self-start` / `self-end`, never a margin
 *
 * `align-self: flex-end` resolves against the writing direction, so the person's own turns sit on
 * the trailing edge in both scripts with no mirrored style, no `rtl:` variant and no physical
 * offset — the only mirroring technique that survives a live `dir` change on the web
 * (`notes/nativewind-spike.md` §4). The RTL Playwright spec asserts the geometry rather than the
 * class, because the class is the means and the geometry is the promise.
 *
 * ## Every machine turn carries a visible origin badge
 *
 * Not a colour, not a bubble shape: a label. Colour and shape both differ as well, but neither is
 * allowed to be the only signal, and neither survives a monochrome display.
 *
 * The system turn — the standing disclaimer the store opens every session with — is full width and
 * neutral. It is not a participant in the conversation and must not read as one.
 */
export interface MessageListProps {
    readonly messages: readonly VdMessage[];
    readonly testID?: string | undefined;
}

/**
 * `max-w-[85%]` on the three participants and `self-stretch` on the system notice.
 *
 * The cap is what makes the alignment *observable* rather than merely declared: a bubble allowed to
 * fill the column looks identical whichever edge it is aligned to, and the RTL spec would then be
 * asserting nothing. Fifteen per cent of slack is enough for the geometry check to hold whether the
 * message is one line or ten.
 */
const BUBBLE_CLASS: Readonly<Record<VdOriginKind, string>> = {
    human: 'self-end max-w-[85%] bg-surface-brand-subtle border-transparent',
    ai: 'self-start max-w-[85%] bg-surface-raised border-stroke-subtle',
    dietitian: 'self-start max-w-[85%] bg-success-subtle border-success-border',
    system: 'self-stretch bg-surface-sunken border-stroke-subtle',
};

export const VD_MESSAGES_TEST_ID = 'vd-messages';

export function MessageList({ messages, testID = VD_MESSAGES_TEST_ID }: MessageListProps) {
    const { t } = useTranslation();

    if (messages.length === 0) {
        return (
            <EmptyState
                testID={`${testID}-empty`}
                title={t('virtualDietitian:chat.emptyTitle')}
                body={t('virtualDietitian:chat.emptyBody')}
            />
        );
    }

    // No `accessibilityLabel` on the container: react-native-web renders one as `aria-label` on a
    // role-less `div`, which axe reports as `aria-prohibited-attr` at serious impact. The
    // conversation is named by the heading above it instead.
    return (
        <Stack space="sm" testID={testID}>
            {messages.map((message, index) => {
                const kind = originKindOf(message.origin, message.aiGenerated);
                const messageTestID = `${testID}-${String(index)}`;

                return (
                    <FadeIn key={String(message.id)} delayMs={0}>
                        <View
                            testID={messageTestID}
                            className={cx(
                                'flex-col gap-2 rounded-lg border p-3',
                                BUBBLE_CLASS[kind],
                            )}
                        >
                            <Inline space="xs" align="center">
                                <OriginBadge
                                    kind={kind}
                                    testID={`${messageTestID}-origin-${kind}`}
                                />
                            </Inline>
                            <Text testID={`${messageTestID}-body`}>{message.body}</Text>
                        </View>
                    </FadeIn>
                );
            })}
        </Stack>
    );
}

/**
 * What the person has told the assistant, read back from the session.
 *
 * The answers come from `VdMessage.collected` — a real contract field the store persists — rather
 * than from a local copy of what was typed into the composer. That matters more than it looks: a
 * summary built from local state would keep showing answers a failed request never recorded, which
 * is the summary telling the person something the server does not know.
 */
export interface CollectedPanelProps {
    readonly messages: readonly VdMessage[];
    readonly testID?: string | undefined;
}

export function collectAnswers(
    messages: readonly VdMessage[],
): ReadonlyArray<readonly [string, string | number | boolean]> {
    const merged = new Map<string, string | number | boolean>();
    for (const message of messages) {
        if (message.collected === null) continue;
        for (const [field, value] of Object.entries(message.collected)) merged.set(field, value);
    }
    return [...merged.entries()];
}

export function CollectedPanel({ messages, testID = 'vd-collected' }: CollectedPanelProps) {
    const { t } = useTranslation();
    const answers = collectAnswers(messages);

    return (
        <Stack space="sm" testID={testID}>
            <Heading level={3}>{t('virtualDietitian:collected.title')}</Heading>

            {answers.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary" variant="caption">
                    {t('virtualDietitian:collected.empty')}
                </Text>
            ) : (
                <Stack space="xs">
                    <Text testID={`${testID}-count`} variant="caption" tone="secondary">
                        {t('virtualDietitian:collected.count', { count: answers.length })}
                    </Text>
                    {answers.map(([field, value]) => (
                        <Inline
                            key={field}
                            space="xs"
                            align="center"
                            testID={`${testID}-${field}`}
                            justify="between"
                        >
                            <Text variant="caption" tone="secondary" className="flex-1">
                                {t(`virtualDietitian:collected.fields.${field}`, {
                                    defaultValue: field,
                                })}
                            </Text>
                            <Text variant="label">{formatAnswer(t, value)}</Text>
                        </Inline>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

function formatAnswer(t: (key: string) => string, value: string | number | boolean): string {
    if (typeof value === 'boolean') {
        return value ? t('virtualDietitian:collected.yes') : t('virtualDietitian:collected.no');
    }
    return String(value);
}
