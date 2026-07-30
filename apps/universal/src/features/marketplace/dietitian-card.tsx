import { Avatar, Badge, Card, Chip, Inline, Rating, Stack, Text } from '@healthy360/design-system';
import type { Dietitian } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';

const LOCALE_LABEL_KEY: Readonly<Record<string, string>> = {
    en: 'marketplace:dietitians.localeEnglish',
    ar: 'marketplace:dietitians.localeArabic',
};

/**
 * One dietitian, as they appear in a list.
 *
 * The reference research is unambiguous that professionals should be visible by name and credential
 * *before* any commitment (doc 17, MKT-08), so the card leads with the person rather than with a
 * booking control.
 *
 * The credential line is always accompanied by the synthetic-record note. Every registration entry
 * in this prototype is invented, and a fabricated professional registration presented without
 * qualification is the single most damaging thing this screen could do — it is a claim about a real
 * person's licensure. The note is not a footnote to be trimmed; it is why the card may exist.
 */
export interface DietitianCardProps {
    readonly dietitian: Dietitian;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export function DietitianCard({ dietitian, onPress, testID }: DietitianCardProps) {
    const { t } = useTranslation();
    const resolvedTestID = testID ?? `dietitian-card-${String(dietitian.id)}`;

    return (
        <Card
            testID={resolvedTestID}
            padding="md"
            tone="raised"
            onPress={onPress}
            accessibilityLabel={t('marketplace:dietitians.cardLabel', {
                dietitian: dietitian.displayName,
            })}
        >
            <Stack space="sm">
                <Inline space="sm" align="center">
                    <Avatar
                        testID={`${resolvedTestID}-avatar`}
                        name={dietitian.displayName}
                        seed={String(dietitian.id)}
                        size="lg"
                    />
                    <Stack space="none" className="flex-1">
                        <Text variant="bodyStrong">{dietitian.displayName}</Text>
                        <Text tone="secondary" variant="caption">
                            {dietitian.headline}
                        </Text>
                    </Stack>
                </Inline>

                <Inline space="xs" wrap>
                    <Badge
                        testID={`${resolvedTestID}-availability`}
                        tone={dietitian.acceptingClients ? 'success' : 'neutral'}
                        label={
                            dietitian.acceptingClients
                                ? t('marketplace:dietitians.accepting')
                                : t('marketplace:dietitians.notAccepting')
                        }
                    />
                    {dietitian.rating === null ? null : (
                        <Rating
                            testID={`${resolvedTestID}-rating`}
                            label={t('marketplace:dietitians.ratingLabel', {
                                dietitian: dietitian.displayName,
                            })}
                            value={dietitian.rating}
                            count={dietitian.ratingCount}
                            size="sm"
                        />
                    )}
                </Inline>

                <Inline space="xs" wrap testID={`${resolvedTestID}-specialisms`}>
                    {dietitian.specialisms.map((specialism) => (
                        <Chip key={specialism} label={specialism} tone="brand" />
                    ))}
                </Inline>

                <Text testID={`${resolvedTestID}-languages`} tone="secondary" variant="caption">
                    {t('marketplace:dietitians.speaks', {
                        languages: dietitian.locales
                            .map((locale) => {
                                const key = LOCALE_LABEL_KEY[locale];
                                return key === undefined ? locale : t(key);
                            })
                            .join(t('marketplace:common.listSeparator')),
                    })}
                </Text>

                <Text
                    testID={`${resolvedTestID}-synthetic-credentials`}
                    tone="secondary"
                    variant="caption"
                >
                    {t('marketplace:dietitians.syntheticCredentials')}
                </Text>
            </Stack>
        </Card>
    );
}
