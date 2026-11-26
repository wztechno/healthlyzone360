import type { LocalisedText } from '@healthy360/api-client/contracts';
import {
    BilingualField,
    Button,
    Callout,
    Cascade,
    cx,
    FormSection,
    LeaveDialog,
    PageHeader,
    Text,
    TextInputField,
    useContentWidth,
    useToast,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useCreateKitchenMutation } from '../../../data/platform-admin-hooks.ts';
import { useUnsavedGuardFor } from '../../../navigation/use-unsaved-guard.ts';
import { SendChecklist } from '../../business/corporate-parts.tsx';
import type { SendCheck } from '../../business/corporate-parts.tsx';
import { PLATFORM_KITCHENS_HREF, platformKitchenHref } from '../platform-admin-chrome.tsx';

/**
 * `/platform-admin/kitchens/new` — bring a kitchen onto the platform. From the Platform admin
 * canvas's Add a kitchen board (2026-11-23), in the kitchen's editor look, as Corporate's New
 * quotation is:
 *
 * - **The opening:** the title, "Not saved yet" while there is something to lose, Cancel and
 *   Create kitchen.
 * - **Kitchen:** the name in English and Arabic, and the slug — typed by hand, never generated
 *   from the name, because it cannot change once the kitchen exists.
 * - **Region:** country, currency, language and timezone, seeded with sensible defaults.
 * - **First branch:** its name and city.
 * - **The aside**, sticky beside the form: this kitchen in a few facts, *Before you create* ticked
 *   off as the form becomes complete, and Create kitchen again.
 *
 * Creating makes the organisation, its first branch and a web sales channel; the next thing to do
 * is always to invite its owner, so the operator lands on the new kitchen's pop-up. The only check
 * here is that the required fields are filled — the server owns every other rule, and its errors
 * land on the fields they name.
 */
export function CreateKitchenScreen() {
    return (
        <Gate area="platform-admin" testID="platform-admin-create">
            <CreateKitchenForm />
        </Gate>
    );
}

/** The aside's width beside the form, the board's 300px. */
const ASIDE_WIDTH = 300;
/** Below this the aside runs under the form. */
const BESIDE_MIN_WIDTH = 900;

function CreateKitchenForm() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const create = useCreateKitchenMutation();
    const { width: contentWidth } = useContentWidth();
    const beside = contentWidth >= BESIDE_MIN_WIDTH;

    const [name, setName] = useState<LocalisedText>({ en: '', ar: '' });
    const [slug, setSlug] = useState('');
    const [country, setCountry] = useState('AE');
    const [currency, setCurrency] = useState('USD');
    const [language, setLanguage] = useState('en');
    const [timezone, setTimezone] = useState('Asia/Dubai');
    const [branchName, setBranchName] = useState('');
    const [city, setCity] = useState('');

    // Anything typed is work to lose; the defaults (country, currency, language, zone) are not.
    const dirty =
        !create.isSuccess &&
        (name.en.trim() !== '' ||
            name.ar.trim() !== '' ||
            slug.trim() !== '' ||
            branchName.trim() !== '' ||
            city.trim() !== '');
    const guard = useUnsavedGuardFor(dirty, { message: t('common:unsaved.browserPrompt') });

    const failure = toFailure(create.error);
    const fieldError = (field: string): string | undefined =>
        failure?.code === 'validation.failed' ? failure.fields[field]?.[0] : undefined;
    const errorFor = (field: string) => {
        const error = fieldError(field);
        return error === undefined ? {} : { error };
    };

    const named = name.en.trim() !== '' && name.ar.trim() !== '';
    const region =
        country.trim() !== '' &&
        currency.trim() !== '' &&
        language.trim() !== '' &&
        timezone.trim() !== '';
    const ready = named && slug.trim() !== '' && region && branchName.trim() !== '';

    const toList = () => {
        router.push(PLATFORM_KITCHENS_HREF as never);
    };

    const submit = () => {
        if (!ready) return;
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
                        message: t('platformAdmin:create.created', { name: kitchen.name }),
                    });
                    // Straight to the new kitchen: inviting its owner is always what comes next.
                    router.replace(platformKitchenHref(kitchen.slug) as never);
                },
            },
        );
    };

    const createButton = (testID: string, block: boolean) => (
        <Button
            testID={testID}
            label={t('platformAdmin:create.submit')}
            block={block}
            {...(block ? { size: 'lg' as const } : { size: 'sm' as const })}
            disabled={!ready}
            loading={create.isPending}
            onPress={submit}
        />
    );

    const dash = '—';
    const checks: readonly SendCheck[] = [
        { key: 'name', ok: named, label: t('platformAdmin:create.checkName') },
        { key: 'slug', ok: slug.trim() !== '', label: t('platformAdmin:create.checkSlug') },
        { key: 'region', ok: region, label: t('platformAdmin:create.checkRegion') },
        {
            key: 'branch',
            ok: branchName.trim() !== '',
            label: t('platformAdmin:create.checkBranch'),
        },
    ];

    const form = (
        <View className="z-auto min-w-0 flex-1 flex-col gap-3">
            <FormSection
                first
                variant="panel"
                testID="platform-admin-create-kitchen-section"
                title={t('platformAdmin:create.kitchenTitle')}
            >
                <View className="flex-col gap-3.5">
                    <BilingualField
                        testID="platform-admin-create-name"
                        layout="fill"
                        fieldLabel={t('platformAdmin:create.nameLabel')}
                        placeholder={{
                            en: t('platformAdmin:create.namePlaceholderEn'),
                            ar: t('platformAdmin:create.namePlaceholderAr'),
                        }}
                        value={name}
                        onChange={setName}
                        requiredEnglish
                        requiredArabic
                        {...(fieldError('name_en') === undefined
                            ? {}
                            : { englishError: fieldError('name_en') })}
                        {...(fieldError('name_ar') === undefined
                            ? {}
                            : { arabicError: fieldError('name_ar') })}
                    />
                    <View className="w-full md:w-1/2">
                        <TextInputField
                            testID="platform-admin-create-slug"
                            id="platform-admin-create-slug"
                            size="sm"
                            label={t('platformAdmin:create.slugLabel')}
                            placeholder={t('platformAdmin:create.slugPlaceholder')}
                            hint={t('platformAdmin:create.slugHint')}
                            value={slug}
                            onChangeText={setSlug}
                            autoCapitalize="none"
                            autoCorrect={false}
                            required
                            {...errorFor('slug')}
                        />
                    </View>
                </View>
            </FormSection>

            <FormSection
                variant="panel"
                testID="platform-admin-create-region-section"
                title={t('platformAdmin:create.regionTitle')}
            >
                <View className="flex-row flex-wrap gap-x-3 gap-y-3.5">
                    <View className="w-[132px]">
                        <TextInputField
                            testID="platform-admin-create-country"
                            id="platform-admin-create-country"
                            size="sm"
                            label={t('platformAdmin:create.countryLabel')}
                            placeholder={t('platformAdmin:create.countryPlaceholder')}
                            value={country}
                            onChangeText={setCountry}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            maxLength={2}
                            required
                            {...errorFor('country_code')}
                        />
                    </View>
                    <View className="w-[132px]">
                        <TextInputField
                            testID="platform-admin-create-currency"
                            id="platform-admin-create-currency"
                            size="sm"
                            label={t('platformAdmin:create.currencyLabel')}
                            placeholder={t('platformAdmin:create.currencyPlaceholder')}
                            value={currency}
                            onChangeText={setCurrency}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            maxLength={3}
                            required
                            {...errorFor('default_currency_code')}
                        />
                    </View>
                    <View className="w-[132px]">
                        <TextInputField
                            testID="platform-admin-create-language"
                            id="platform-admin-create-language"
                            size="sm"
                            label={t('platformAdmin:create.languageLabel')}
                            placeholder={t('platformAdmin:create.languagePlaceholder')}
                            value={language}
                            onChangeText={setLanguage}
                            autoCapitalize="none"
                            autoCorrect={false}
                            maxLength={2}
                            required
                            {...errorFor('default_language_code')}
                        />
                    </View>
                    <View className="w-full min-w-[220px] md:flex-1">
                        <TextInputField
                            testID="platform-admin-create-timezone"
                            id="platform-admin-create-timezone"
                            size="sm"
                            label={t('platformAdmin:create.timezoneLabel')}
                            placeholder={t('platformAdmin:create.timezonePlaceholder')}
                            value={timezone}
                            onChangeText={setTimezone}
                            autoCapitalize="none"
                            autoCorrect={false}
                            required
                            {...errorFor('timezone')}
                        />
                    </View>
                </View>
            </FormSection>

            <FormSection
                variant="panel"
                testID="platform-admin-create-branch-section"
                title={t('platformAdmin:create.branchTitle')}
            >
                <View className="flex-row flex-wrap gap-x-3 gap-y-3.5">
                    <View className="w-full min-w-[220px] md:flex-1">
                        <TextInputField
                            testID="platform-admin-create-branch"
                            id="platform-admin-create-branch"
                            size="sm"
                            label={t('platformAdmin:create.branchNameLabel')}
                            placeholder={t('platformAdmin:create.branchNamePlaceholder')}
                            hint={t('platformAdmin:create.branchNameHint')}
                            value={branchName}
                            onChangeText={setBranchName}
                            required
                            {...errorFor('branch_name')}
                        />
                    </View>
                    <View className="w-full min-w-[220px] md:flex-1">
                        <TextInputField
                            testID="platform-admin-create-city"
                            id="platform-admin-create-city"
                            size="sm"
                            label={t('platformAdmin:create.cityLabel')}
                            placeholder={t('platformAdmin:create.cityPlaceholder')}
                            value={city}
                            onChangeText={setCity}
                            {...errorFor('city')}
                        />
                    </View>
                </View>
            </FormSection>

            {failure === null || failure.code === 'validation.failed' ? null : (
                <Callout
                    testID="platform-admin-create-failure"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('platformAdmin:create.failedTitle')}
                    body={failure.message}
                />
            )}
        </View>
    );

    const aside = (
        <View
            testID="platform-admin-create-panel"
            role="complementary"
            aria-label={t('platformAdmin:create.asideTitle')}
            style={beside ? { width: ASIDE_WIDTH } : undefined}
            className="z-auto self-start web:sticky web:top-0"
        >
            <FormSection first variant="panel" title={t('platformAdmin:create.asideTitle')}>
                <View className="flex-col">
                    <Fact
                        label={t('platformAdmin:create.nameLabel')}
                        value={name.en.trim() === '' ? dash : name.en.trim()}
                    />
                    <Fact
                        label={t('platformAdmin:create.slugLabel')}
                        value={slug.trim() === '' ? dash : slug.trim().toLowerCase()}
                    />
                    <Fact
                        label={t('platformAdmin:create.regionTitle')}
                        value={[country, currency, language]
                            .map((part) => part.trim())
                            .filter((part) => part !== '')
                            .join(' · ')}
                    />
                    <Fact
                        label={t('platformAdmin:create.timezoneLabel')}
                        value={timezone.trim() === '' ? dash : timezone.trim()}
                    />
                    <Fact
                        label={t('platformAdmin:create.branchTitle')}
                        value={
                            branchName.trim() === ''
                                ? dash
                                : [branchName.trim(), city.trim()]
                                      .filter((part) => part !== '')
                                      .join(', ')
                        }
                    />
                    <SendChecklist
                        testID="platform-admin-create-checks"
                        title={t('platformAdmin:create.beforeYouCreate')}
                        checks={checks}
                    />
                    <View className="mt-3">
                        {createButton('platform-admin-create-submit', true)}
                    </View>
                </View>
            </FormSection>
        </View>
    );

    return (
        <Cascade space="md" testID="platform-admin-create-screen">
            <PageHeader
                testID="platform-admin-create-header"
                titleTestID="platform-admin-create-title"
                title={t('platformAdmin:create.title')}
                titleAside={
                    dirty ? (
                        <View
                            testID="platform-admin-create-dirty"
                            className="h-[26px] flex-row items-center gap-1.5 rounded-full bg-warning-subtle px-2.5"
                        >
                            <View aria-hidden className="h-2 w-2 rounded-full bg-warning-strong" />
                            <Text variant="caption" className="font-bold text-warning-on-subtle">
                                {t('platformAdmin:create.notSaved')}
                            </Text>
                        </View>
                    ) : undefined
                }
                actions={
                    <View className="flex-row flex-wrap items-center justify-end gap-2">
                        <Button
                            testID="platform-admin-create-cancel"
                            variant="secondary"
                            size="sm"
                            label={t('platformAdmin:common.cancel')}
                            onPress={() => {
                                guard.intercept(toList);
                            }}
                        />
                        {createButton('platform-admin-create-send', false)}
                    </View>
                }
            />

            <View className={cx('z-auto gap-4', beside ? 'flex-row items-start' : 'flex-col')}>
                {form}
                {aside}
            </View>
            <LeaveDialog guard={guard} testID="platform-admin-create" />
        </Cascade>
    );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
    return (
        <View className="flex-row justify-between gap-2.5 py-1">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant="caption" className="min-w-0 shrink font-semibold tabular-nums text-end">
                {value}
            </Text>
        </View>
    );
}
