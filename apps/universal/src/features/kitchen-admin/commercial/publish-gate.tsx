import { Button, Callout, FormSection, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * The Publication section of a commercial editor (Commercial handoff §2.2 `PublishGate`).
 *
 * ```
 * PUBLICATION
 * ⚠ This price list cannot be published yet
 *   • No entry is confirmed.
 * What will not reach a customer: 2 pending prices and 1 priced daily.     [ Publish ]
 * ```
 *
 * **Publish is a section action, not a second header primary** (§5 "One primary per screen"): the
 * header carries Save, and publishing is a decision about the entries on screen, so it sits under
 * them. The button is enabled **only** when `blockers` is empty, and the excluded line is stated
 * before a publish as well as after — pending and daily-priced entries are not prices, and
 * publishing does not turn them into prices.
 *
 * It opens the caller's confirmation; it never publishes on its own press.
 */
export interface PublishGateProps {
    readonly title: string;
    /** Translated reasons, already worded. Empty is the only state the button is enabled in. */
    readonly blockers: readonly string[];
    readonly blockedTitle: string;
    /** The "what will not reach a customer" sentence. */
    readonly excluded: string;
    readonly onPublish: () => void;
    /** A published record has nothing to publish: the section states that instead. */
    readonly published?: string | undefined;
    readonly canManage: boolean;
    readonly testID: string;
}

export function PublishGate({
    title,
    blockers,
    blockedTitle,
    excluded,
    onPublish,
    published,
    canManage,
    testID,
}: PublishGateProps) {
    const { t } = useTranslation();

    return (
        <FormSection title={title} testID={`${testID}-section`}>
            <Stack space="sm">
                {published !== undefined ? (
                    <Text tone="secondary" variant="caption" testID={`${testID}-published-note`}>
                        {published}
                    </Text>
                ) : (
                    <>
                        {blockers.length === 0 ? null : (
                            <Callout
                                testID={`${testID}-gate-blocked`}
                                role="alert"
                                tone="warning"
                                title={blockedTitle}
                            >
                                <Stack space="xs">
                                    {blockers.map((reason) => (
                                        <Text key={reason} variant="caption">
                                            {reason}
                                        </Text>
                                    ))}
                                </Stack>
                            </Callout>
                        )}
                        <View className="flex-row flex-wrap items-center justify-between gap-snug">
                            <Text variant="caption" tone="secondary" testID={`${testID}-gate-excluded`}>
                                {excluded}
                            </Text>
                            {canManage ? (
                                <Button
                                    testID={testID}
                                    variant="secondary"
                                    label={t('kitchen:publish.action')}
                                    disabled={blockers.length > 0}
                                    onPress={onPublish}
                                />
                            ) : null}
                        </View>
                    </>
                )}
            </Stack>
        </FormSection>
    );
}
