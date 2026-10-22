import { Button, Heading, Stack, Text } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * `/account-closed` — where a completed full closure ends.
 *
 * ## Why it is a public page, and not the wizard's done step
 *
 * Closing the account ends the session. Every page under `/customer` sits behind the customer gate,
 * and the moment the session query noticed, the gate answered the wizard's own done step with the
 * sign-in page — so "Your account is closed" was, plausibly, never seen. This page is in the public
 * marketplace group: nothing here depends on a session, so it can say what happened to somebody who
 * no longer has one. The wizard navigates here *before* it tells the session query.
 *
 * It states the outcome and nothing else — it reads no ticket and no account, because there is no
 * longer an account to read. Somebody who opens it directly sees the same confirmation, which
 * claims nothing about them in particular.
 */

const TEST_ID = 'account-closed';

export function AccountClosedScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <View testID={TEST_ID} className="w-full max-w-[640px] self-center">
            <Stack space="md">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('account:closure.closedTitle')}
                </Heading>
                <Text testID={`${TEST_ID}-body`}>{t('account:closure.closedBody')}</Text>
                <Text tone="secondary" variant="caption" testID={`${TEST_ID}-signed-out`}>
                    {t('account:closure.signedOutNote')}
                </Text>
                <View className="items-start">
                    <Button
                        testID={`${TEST_ID}-home`}
                        label={t('account:closure.finish')}
                        onPress={() => {
                            router.replace('/discover' as never);
                        }}
                    />
                </View>
            </Stack>
        </View>
    );
}
