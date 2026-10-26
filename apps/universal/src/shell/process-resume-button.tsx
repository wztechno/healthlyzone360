import { DensityProvider, Icon, IconButton } from '@healthy360/design-system';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { endProcess, isOutsideProcess, useActiveProcess } from '../navigation/active-process.ts';

/**
 * The top bar's way back into a process the reader stepped out of — "↩ Continue · Fix stock gap ·
 * Bbq Sauce Dip" — to the exact step they left, its tab and return chain included.
 *
 * Drawn only off the process's own pages: on a step the reader is already where Continue would
 * go. The ✕ ends the process; it is the reader deciding to stop, not a problem being waved away.
 * See `navigation/active-process.ts`.
 */
export function ProcessResumeButton() {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const process = useActiveProcess();

    if (process === null || !isOutsideProcess(process, pathname)) return null;

    const title = t(`common:process.kind.${process.kind}`, { subject: process.subject });

    return (
        <DensityProvider value="compact">
            <View
                testID="process-resume"
                className="h-8 max-w-[320px] flex-row items-center self-center rounded-full border border-stroke-strong bg-surface-sunken pe-0.5"
            >
                <Pressable
                    testID="process-resume-continue"
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('common:process.continueLabel', { title })}
                    onPress={() => {
                        router.push(process.resumeHref as never);
                    }}
                    className="h-8 min-w-0 shrink flex-row items-center gap-1.5 ps-3"
                >
                    <Icon name="chevronBackward" size="sm" className="text-content-primary" />
                    <RNText className="text-xs font-semibold text-content-primary">
                        {t('common:process.continue')}
                    </RNText>
                    <RNText
                        numberOfLines={1}
                        className="min-w-0 shrink text-xs text-content-secondary"
                    >
                        {title}
                    </RNText>
                </Pressable>
                <IconButton
                    testID="process-resume-stop"
                    size="sm"
                    variant="ghost"
                    label={t('common:process.stop')}
                    icon={<Icon name="close" size="sm" />}
                    onPress={endProcess}
                />
            </View>
        </DensityProvider>
    );
}
