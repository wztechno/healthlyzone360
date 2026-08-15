import type { LocalisedText } from '@healthy360/api-client/contracts';
import {
    Button,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useCreateKitchenMutation } from '../../../data/platform-admin-hooks.ts';
import { BilingualField } from '../../kitchen-admin/bilingual-field.tsx';

/**
 * `/platform-admin/kitchens/new` — bring a kitchen onto the platform.
 *
 * ## The bilingual field is reused, not reimplemented
 *
 * `BilingualField` lives under `features/kitchen-admin/` because that is where it was first needed,
 * and importing it across feature folders is deliberate. What it encodes — a writing direction
 * pinned per *language* rather than per interface, so an English-reading operator gets a
 * left-to-right caret in the English box and a right-to-left one in the Arabic box — is a rule about
 * bilingual data on this platform, not a rule about kitchens managing themselves. A copy here would
 * be a second place to get that wrong.
 *
 * ## The slug is typed, never derived
 *
 * A slug generated from the name would be helpful exactly once and wrong forever after: it appears
 * in marketplace links, it cannot be changed, and a kitchen renaming itself must not silently move.
 * Making the operator type it is what makes it a decision.
 *
 * ## Field errors come from the server
 *
 * The only client-side validation is "the required boxes have something in them", which is what the
 * submit button's `disabled` expresses. Everything real — is this slug taken, is this a country the
 * platform operates in — is the server's answer, and duplicating it here would produce two
 * validators that disagree the first time the reference data changes.
 */
export function CreateKitchenScreen() {
    return (
        <Gate area="platform-admin" testID="platform-admin-create">
            <CreateKitchenForm />
        </Gate>
    );
}

function CreateKitchenForm() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const create = useCreateKitchenMutation();

    const [name, setName] = useState<LocalisedText>({ en: '', ar: '' });
    const [slug, setSlug] = useState('');
    const [country, setCountry] = useState('AE');
    const [currency, setCurrency] = useState('USD');
    const [language, setLanguage] = useState('en');
    const [timezone, setTimezone] = useState('Asia/Dubai');
    const [branchName, setBranchName] = useState('');
    const [city, setCity] = useState('');

    const failure = toFailure(create.error);
    const fieldError = (field: string): string | undefined =>
        failure?.code === 'validation.failed' ? failure.fields[field]?.[0] : undefined;

    const ready =
        name.en.trim() !== '' &&
        name.ar.trim() !== '' &&
        slug.trim() !== '' &&
        country.trim() !== '' &&
        currency.trim() !== '' &&
        language.trim() !== '' &&
        timezone.trim() !== '' &&
        branchName.trim() !== '';

    return (
        <Stack space="lg" testID="platform-admin-create-screen">
            <Button
                testID="platform-admin-create-back"
                variant="ghost"
                label={t('platformAdmin:detail.backToList')}
                onPress={() => {
                    router.push('/platform-admin' as never);
                }}
            />

            <Stack space="xs">
                <Heading level={1} testID="platform-admin-create-title">
                    {t('platformAdmin:create.title')}
                </Heading>
                <Text tone="secondary" testID="platform-admin-create-subtitle">
                    {t('platformAdmin:create.subtitle')}
                </Text>
            </Stack>

            <Card padding="md">
                <Stack space="md">
                    <BilingualField
                        testID="platform-admin-create-name"
                        fieldLabel={t('platformAdmin:create.nameLabel')}
                        value={name}
                        onChange={setName}
                        requiredEnglish
                        {...(fieldError('name_en') === undefined
                            ? {}
                            : { englishError: fieldError('name_en') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-slug"
                        label={t('platformAdmin:create.slugLabel')}
                        hint={t('platformAdmin:create.slugHint')}
                        value={slug}
                        onChangeText={setSlug}
                        autoCapitalize="none"
                        autoCorrect={false}
                        required
                        {...(fieldError('slug') === undefined ? {} : { error: fieldError('slug') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-country"
                        label={t('platformAdmin:create.countryLabel')}
                        value={country}
                        onChangeText={setCountry}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={2}
                        required
                        {...(fieldError('country_code') === undefined
                            ? {}
                            : { error: fieldError('country_code') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-currency"
                        label={t('platformAdmin:create.currencyLabel')}
                        value={currency}
                        onChangeText={setCurrency}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={3}
                        required
                        {...(fieldError('default_currency_code') === undefined
                            ? {}
                            : { error: fieldError('default_currency_code') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-language"
                        label={t('platformAdmin:create.languageLabel')}
                        value={language}
                        onChangeText={setLanguage}
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={2}
                        required
                        {...(fieldError('default_language_code') === undefined
                            ? {}
                            : { error: fieldError('default_language_code') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-timezone"
                        label={t('platformAdmin:create.timezoneLabel')}
                        value={timezone}
                        onChangeText={setTimezone}
                        autoCapitalize="none"
                        autoCorrect={false}
                        required
                        {...(fieldError('timezone') === undefined
                            ? {}
                            : { error: fieldError('timezone') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-branch"
                        label={t('platformAdmin:create.branchNameLabel')}
                        hint={t('platformAdmin:create.branchNameHint')}
                        value={branchName}
                        onChangeText={setBranchName}
                        required
                        {...(fieldError('branch_name') === undefined
                            ? {}
                            : { error: fieldError('branch_name') })}
                    />

                    <TextInputField
                        testID="platform-admin-create-city"
                        label={t('platformAdmin:create.cityLabel')}
                        value={city}
                        onChangeText={setCity}
                    />

                    <Inline space="sm" wrap>
                        <Button
                            testID="platform-admin-create-submit"
                            label={t('platformAdmin:create.submit')}
                            loading={create.isPending}
                            disabled={!ready}
                            onPress={() => {
                                create.mutate(
                                    {
                                        nameEn: name.en.trim(),
                                        nameAr: name.ar.trim(),
                                        slug: slug.trim().toLowerCase(),
                                        countryCode: country.trim().toUpperCase(),
                                        currencyCode: currency.trim().toUpperCase(),
                                        languageCode: language.trim().toLowerCase(),
                                        timezone: timezone.trim(),
                                        branchName: branchName.trim(),
                                        ...(city.trim() === '' ? {} : { city: city.trim() }),
                                    },
                                    {
                                        onSuccess: (kitchen) => {
                                            toast.show({
                                                testID: 'platform-admin-created-toast',
                                                tone: 'success',
                                                message: t('platformAdmin:create.created', {
                                                    name: kitchen.name,
                                                }),
                                            });
                                            // Straight to the new kitchen, because the next thing
                                            // to do is always invite its owner and that form is
                                            // there.
                                            router.replace(
                                                `/platform-admin/kitchens/${kitchen.slug}` as never,
                                            );
                                        },
                                    },
                                );
                            }}
                        />
                    </Inline>
                </Stack>
            </Card>
        </Stack>
    );
}
