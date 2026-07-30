import {
    Avatar,
    Badge,
    Breadcrumbs,
    Button,
    Callout,
    Card,
    Chip,
    Heading,
    Inline,
    Rating,
    Stack,
    Text,
} from '@healthy360/design-system';
import { DietitianId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useDietitianQuery } from '../../../data/marketplace-hooks.ts';
import { PrototypeButton } from '../../../prototype/prototype-notice.tsx';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../query-states.tsx';

const LOCALE_LABEL_KEY: Readonly<Record<string, string>> = {
    en: 'marketplace:dietitians.localeEnglish',
    ar: 'marketplace:dietitians.localeArabic',
};

export interface DietitianProfileScreenProps {
    readonly dietitianId: string | undefined;
}

/**
 * One dietitian's public profile.
 *
 * ## Requesting a consultation is a prototype action, and says so
 *
 * There is no consultation booking in this phase — no availability model, no appointment record, no
 * professional-side inbox. The contract that would carry it does not exist. The three options were
 * a control that silently does nothing, no control at all, or a control that presses honestly; this
 * is the third. `PrototypeButton` shows the badge and the hint *before* the press and the notice
 * after it, so nobody is misled into believing they have booked something.
 *
 * ## The credentials block
 *
 * Every registration entry in this data set is invented. Presenting a fabricated professional
 * registration without saying so would be a claim about a real person's licensure, so the synthetic
 * note sits immediately beneath the credentials, not in a page footer.
 */
export function DietitianProfileScreen({ dietitianId }: DietitianProfileScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const parsed = dietitianId === undefined ? null : DietitianId.safeParse(dietitianId);
    const query = useDietitianQuery(parsed);
    const dietitian = query.data;

    return (
        <Stack space="lg" testID="dietitian-profile-screen">
            <Breadcrumbs
                testID="dietitian-breadcrumbs"
                items={[
                    {
                        key: 'dietitians',
                        label: t('marketplace:nav.dietitians'),
                        onPress: () => {
                            router.push('/dietitians');
                        },
                    },
                    {
                        key: 'dietitian',
                        label: dietitian?.displayName ?? t('marketplace:dietitians.loading'),
                    },
                ]}
            />

            <QueryStates
                query={query}
                isEmpty={query.data === undefined && !query.isPending}
                emptyTitle={t('marketplace:dietitians.notFoundTitle')}
                emptyBody={t('marketplace:dietitians.notFoundBody')}
                skeletonCount={2}
                testID="dietitian"
            >
                {dietitian === undefined ? null : (
                    <Stack space="lg">
                        <Inline space="md" align="center" wrap>
                            <Avatar
                                testID="dietitian-avatar"
                                name={dietitian.displayName}
                                seed={String(dietitian.id)}
                                size="xl"
                            />
                            <Stack space="xs" className="flex-1">
                                <Heading level={1} testID="dietitian-name">
                                    {dietitian.displayName}
                                </Heading>
                                <Text tone="secondary">{dietitian.headline}</Text>
                                <Inline space="xs" wrap align="center">
                                    <Badge
                                        testID="dietitian-availability"
                                        tone={dietitian.acceptingClients ? 'success' : 'neutral'}
                                        label={
                                            dietitian.acceptingClients
                                                ? t('marketplace:dietitians.accepting')
                                                : t('marketplace:dietitians.notAccepting')
                                        }
                                    />
                                    {dietitian.rating === null ? null : (
                                        <Rating
                                            testID="dietitian-rating"
                                            label={t('marketplace:dietitians.ratingLabel', {
                                                dietitian: dietitian.displayName,
                                            })}
                                            value={dietitian.rating}
                                            count={dietitian.ratingCount}
                                            size="sm"
                                        />
                                    )}
                                </Inline>
                            </Stack>
                        </Inline>

                        <Text testID="dietitian-biography">{dietitian.biography}</Text>

                        <Stack space="xs" testID="dietitian-credentials">
                            <Heading level={2}>
                                {t('marketplace:dietitians.credentialsTitle')}
                            </Heading>
                            {dietitian.credentials.map((credential) => (
                                <Text key={credential} tone="secondary">
                                    {credential}
                                </Text>
                            ))}
                            <Callout
                                testID="dietitian-synthetic-note"
                                role="note"
                                tone="warning"
                                title={t('marketplace:dietitians.syntheticTitle')}
                                body={t('marketplace:dietitians.syntheticBody')}
                            />
                        </Stack>

                        <Stack space="xs">
                            <Heading level={2}>
                                {t('marketplace:dietitians.specialismsTitle')}
                            </Heading>
                            <Inline space="xs" wrap testID="dietitian-specialisms">
                                {dietitian.specialisms.map((specialism) => (
                                    <Chip key={specialism} label={specialism} tone="brand" />
                                ))}
                            </Inline>
                            <Text testID="dietitian-languages" tone="secondary" variant="caption">
                                {t('marketplace:dietitians.speaks', {
                                    languages: dietitian.locales
                                        .map((locale) => {
                                            const key = LOCALE_LABEL_KEY[locale];
                                            return key === undefined ? locale : t(key);
                                        })
                                        .join(t('marketplace:common.listSeparator')),
                                })}
                            </Text>
                        </Stack>

                        <Card padding="md" tone="raised" testID="dietitian-consultation">
                            <Stack space="sm">
                                <Heading level={2}>
                                    {t('marketplace:dietitians.consultationTitle')}
                                </Heading>
                                <Text tone="secondary">
                                    {t('marketplace:dietitians.consultationBody')}
                                </Text>
                                {dietitian.acceptingClients ? (
                                    <PrototypeButton
                                        label={t('marketplace:dietitians.requestConsultation')}
                                        contract="POST /api/v1/dietitians/{dietitian}/consultation-requests"
                                        variant="primary"
                                    />
                                ) : (
                                    <Stack space="sm">
                                        <Text tone="secondary">
                                            {t('marketplace:dietitians.notAcceptingBody')}
                                        </Text>
                                        <Inline space="sm" wrap>
                                            <Button
                                                testID="dietitian-browse-others"
                                                variant="secondary"
                                                label={t('marketplace:dietitians.browseOthers')}
                                                onPress={() => {
                                                    router.push('/dietitians');
                                                }}
                                            />
                                        </Inline>
                                    </Stack>
                                )}
                            </Stack>
                        </Card>

                        <MedicalDisclaimer />
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
