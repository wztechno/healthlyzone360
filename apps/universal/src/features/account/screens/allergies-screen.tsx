import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useUnsavedGuard } from '../../../navigation/use-unsaved-guard.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { UnsavedChangesDialog } from '../../../ui/unsaved-changes-dialog.tsx';
import { AllergiesPanel } from '../account-allergies-panel.tsx';

/**
 * `/customer/account/allergies` — the account's Allergies pane on a page of its own, for the flows
 * (checkout, plan setup, the account checklist) that send a person here with `?returnTo=` and expect
 * saving to send them straight back. The pane, its rules and its save are `../account-allergies-panel.tsx`;
 * the account page shows the same pane as its Allergies section.
 */

const TEST_ID = 'allergies-screen';

export interface AllergiesScreenProps {
    /**
     * The route's `?returnTo=` — the checkout or plan setup that asked for the declaration, which
     * saving goes straight back to. Opened from the account, saving stays here and says so.
     */
    readonly returnTo?: string | undefined;
}

export function AllergiesScreen({ returnTo }: AllergiesScreenProps) {
    const { t } = useTranslation();
    const back = useReturnTo(returnTo, '/customer/account?section=allergies');
    const guard = useUnsavedGuard({ message: t('common:unsaved.browserPrompt') });

    return (
        <View testID={TEST_ID} className="flex-col gap-4 pb-10">
            {/* Shop · Account: the Back pill the Mobile number and Consents pages use, naming where
                it goes, in place of the underlined "Back › Allergies" trail. */}
            <View className="items-start pt-1">
                <BackPill
                    testID={`${TEST_ID}-trail-up`}
                    label={
                        back.returnTo === null
                            ? t('account:title')
                            : t(`common:destination.${back.destination}`)
                    }
                    onPress={() => {
                        guard.intercept(back.up);
                    }}
                />
            </View>
            <AllergiesPanel
                testID={TEST_ID}
                guard={guard}
                onSaved={() => {
                    // Sent here by a step: back to it at once.
                    if (back.returnTo !== null) back.finish();
                }}
                onCancel={() => {
                    guard.intercept(back.up);
                }}
            />
            <UnsavedChangesDialog look="shop" guard={guard} testID={`${TEST_ID}-unsaved`} />
        </View>
    );
}
