import type { LocalisedText, StorefrontProfile } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Cascade,
    ErrorState,
    FormSection,
    FormSkeleton,
    useToast,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useSaveStorefrontProfileMutation,
    useStorefrontProfileQuery,
} from '../../../data/staff-alerts-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { CATALOGUE_MANAGE_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';
import { EditorGuardDialogs } from '../record-form-opening.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

const PAGE = 'kitchen-storefront';

/**
 * `/kitchen/storefront` — the tagline, description and cuisines a customer reads on the kitchen's
 * marketplace page. One record per organisation. Gated on the writing code, which is the server's
 * rule: its read refuses anybody who may not edit it.
 */
export function StorefrontProfileScreen() {
    return (
        <Gate area="kitchen" requirement={{ allOf: [CATALOGUE_MANAGE_PERMISSION] }} testID={PAGE}>
            <StorefrontProfilePage />
        </Gate>
    );
}

function StorefrontProfilePage() {
    const { t } = useTranslation();

    return (
        <Cascade space="md" testID={`${PAGE}-screen`}>
            <KitchenPageHeader
                testID={`${PAGE}-header`}
                title={t('kitchen:families.storefront.name')}
                subtitle={t('kitchen:families.storefront.description')}
            />
            <StorefrontProfileSection />
        </Cascade>
    );
}

/** The cuisines as the form edits them: one line of text per language. */
interface StorefrontDraft {
    readonly tagline: LocalisedText;
    readonly description: LocalisedText;
    readonly cuisines: LocalisedText;
}

type StorefrontCopy = 'tagline' | 'description' | 'cuisines';

/** Either comma ends a cuisine, so an Arabic list typed with `،` splits as one typed with `,`. */
function cuisineList(text: string): readonly string[] {
    return text
        .split(/[,،]/u)
        .map((cuisine) => cuisine.trim())
        .filter((cuisine) => cuisine !== '');
}

function storefrontDraftOf(profile: StorefrontProfile): StorefrontDraft {
    return {
        tagline: profile.tagline,
        description: profile.description,
        cuisines: { en: profile.cuisines.en.join(', '), ar: profile.cuisines.ar.join('، ') },
    };
}

/** The kitchen's marketplace copy, with its own Save and its own unsaved guard. */
function StorefrontProfileSection() {
    const { t } = useTranslation();
    const toast = useToast();
    const profile = useStorefrontProfileQuery();
    const save = useSaveStorefrontProfileMutation();
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    /** `null` until something is typed; then the whole form, as typed. */
    const [draft, setDraft] = useState<StorefrontDraft | null>(null);
    const dirty = draft !== null;

    const loadFailure = toFailure(profile.error);
    if (loadFailure !== null && profile.data === undefined) {
        return (
            <ErrorState
                testID="kitchen-storefront-profile-load-error"
                failure={loadFailure}
                title={t('kitchen:storefrontProfile.loadErrorTitle')}
                onRetry={() => {
                    void profile.refetch();
                }}
                retrying={profile.isFetching}
            />
        );
    }

    const stored = profile.data;
    if (stored === undefined) {
        return (
            <FormSkeleton
                testID="kitchen-storefront-profile-loading"
                partTestID="kitchen-storefront-profile"
                heading={false}
                sections={1}
                tabs={0}
            />
        );
    }

    const shown = draft ?? storefrontDraftOf(stored);
    const edit = (change: Partial<StorefrontDraft>) => {
        setDraft({ ...shown, ...change });
        guard.markDirty();
    };

    const saveFailure = toFailure(save.error);
    const server = serverFieldErrors(
        saveFailure,
        Object.fromEntries(
            (['tagline', 'description', 'cuisines'] as const).flatMap((copy) =>
                ['en', 'ar'].flatMap((language) =>
                    [`${copy}_${language}`, `${copy}_${language}.*`].map((field) => [
                        field,
                        {
                            label: t(`kitchen:storefrontProfile.${copy}Label`),
                            fieldId: `kitchen-storefront-profile-${copy}-${language}`,
                        },
                    ]),
                ),
            ),
        ),
    );
    /** A refused cuisine comes back under its index, so the list's wildcard is asked too. */
    const errors = (copy: StorefrontCopy) => {
        const en = server.errorFor(`${copy}_en`) ?? server.errorFor(`${copy}_en.*`);
        const ar = server.errorFor(`${copy}_ar`) ?? server.errorFor(`${copy}_ar.*`);
        return {
            ...(en === undefined ? {} : { englishError: en }),
            ...(ar === undefined ? {} : { arabicError: ar }),
        };
    };

    const saveProfile = () => {
        save.mutate(
            {
                tagline: shown.tagline,
                description: shown.description,
                cuisines: {
                    en: cuisineList(shown.cuisines.en),
                    ar: cuisineList(shown.cuisines.ar),
                },
            },
            {
                onSuccess: () => {
                    setDraft(null);
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-storefront-profile-saved-toast',
                        tone: 'success',
                        message: t('kitchen:storefrontProfile.savedToast'),
                    });
                },
            },
        );
    };

    return (
        <>
            <FormSection
                variant="panel"
                testID="kitchen-storefront-profile"
                title={t('kitchen:storefrontProfile.title')}
                description={t('kitchen:storefrontProfile.description')}
                actions={
                    <Button
                        testID="kitchen-storefront-profile-save"
                        size="sm"
                        label={t('kitchen:storefrontProfile.save')}
                        loading={save.isPending}
                        disabled={!dirty || save.isPending}
                        onPress={saveProfile}
                    />
                }
            >
                {saveFailure === null ? null : (
                    <Callout
                        testID="kitchen-storefront-profile-save-error"
                        role="alert"
                        tone="danger"
                        title={t('kitchen:storefrontProfile.saveError')}
                        body={server.unplaced ?? saveFailure.message}
                    />
                )}
                <BilingualField
                    testID="kitchen-storefront-profile-tagline"
                    layout="row"
                    fieldLabel={t('kitchen:storefrontProfile.taglineLabel')}
                    value={shown.tagline}
                    onChange={(tagline) => {
                        edit({ tagline });
                    }}
                    {...errors('tagline')}
                />
                <BilingualField
                    testID="kitchen-storefront-profile-description"
                    layout="row"
                    multiline
                    fieldLabel={t('kitchen:storefrontProfile.descriptionLabel')}
                    value={shown.description}
                    onChange={(description) => {
                        edit({ description });
                    }}
                    {...errors('description')}
                />
                <BilingualField
                    testID="kitchen-storefront-profile-cuisines"
                    layout="row"
                    fieldLabel={t('kitchen:storefrontProfile.cuisinesLabel')}
                    placeholder={{
                        en: t('kitchen:storefrontProfile.cuisinesPlaceholderEn'),
                        ar: t('kitchen:storefrontProfile.cuisinesPlaceholderAr'),
                    }}
                    value={shown.cuisines}
                    onChange={(cuisines) => {
                        edit({ cuisines });
                    }}
                    {...errors('cuisines')}
                />
            </FormSection>
            <EditorGuardDialogs guard={guard} testID="kitchen-storefront-profile" />
        </>
    );
}
