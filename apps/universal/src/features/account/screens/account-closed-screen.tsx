import { Icon } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * `/account-closed` — where a completed full closure ends, drawn as the accepted Account-closed
 * board: one canopy panel, centred, with the soft shapes in its corners, a ticked disc, "Your
 * account is closed", the line under it, and "Back to the shop".
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
        <View testID={TEST_ID} className="w-full max-w-[1000px] self-center pb-12 pt-10">
            <View className="relative items-center overflow-hidden rounded-[32px] bg-surface-canopy px-8 py-14">
                <View
                    aria-hidden
                    className="absolute -end-[120px] -top-[180px] h-[480px] w-[480px] rounded-full bg-stage-green opacity-15"
                />
                <View
                    aria-hidden
                    className="absolute -bottom-[120px] -start-[100px] h-80 w-80 rounded-full bg-content-on-canopy opacity-5"
                />
                <View
                    aria-hidden
                    className="h-24 w-24 items-center justify-center rounded-full bg-content-on-canopy/10"
                >
                    <Icon name="check" size="lg" className="text-stage-green" />
                </View>
                <RNText
                    testID={`${TEST_ID}-title`}
                    accessibilityRole="header"
                    aria-level={1}
                    className="mb-2 mt-6 font-display text-4xl font-bold leading-[46px] text-content-on-canopy text-center"
                >
                    {t('account:closure.closedTitle')}
                </RNText>
                <RNText
                    testID={`${TEST_ID}-body`}
                    className="text-lg font-medium text-content-on-canopy-muted text-center"
                >
                    {t('account:closure.closedBody')}
                </RNText>
                <RNText
                    testID={`${TEST_ID}-signed-out`}
                    className="mb-[26px] mt-1 text-sm font-medium text-content-on-canopy-muted text-center"
                >
                    {t('account:closure.signedOutNote')}
                </RNText>
                <Pressable
                    testID={`${TEST_ID}-home`}
                    role="button"
                    accessibilityRole="button"
                    onPress={() => {
                        router.replace('/discover' as never);
                    }}
                    className="h-[54px] flex-row items-center justify-center gap-2.5 rounded-2xl bg-stage-green px-[22px] hover:opacity-90"
                >
                    <RNText className="text-base font-bold text-surface-canopy">
                        {t('auth:frame.backToShop')}
                    </RNText>
                    <Icon name="chevronForward" size="md" className="text-surface-canopy" />
                </Pressable>
            </View>
        </View>
    );
}
