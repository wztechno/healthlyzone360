import { apiFailure, rateLimitFailure, validationFailure } from '@healthy360/api-client';
import {
    BADGE_TONES,
    BUTTON_SIZES,
    BUTTON_VARIANTS,
    Badge,
    Button,
    CARD_TONES,
    Card,
    Checkbox,
    Dialog,
    Drawer,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
    IconButton,
    Inline,
    ListItem,
    NUTRITION_LEVELS,
    OfflineIndicator,
    PasswordInput,
    Select,
    Skeleton,
    Spinner,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'nativewind';

interface SectionProps {
    readonly id: string;
    readonly title: string;
    readonly children: React.ReactNode;
}

function Section({ id, title, children }: SectionProps) {
    return (
        <Card testID={`showcase-${id}`} padding="lg" tone="raised">
            <Heading level={2}>{title}</Heading>
            <Stack space="md">{children}</Stack>
        </Card>
    );
}

/**
 * The design-system showcase.
 *
 * This page is the Playwright and axe target: every Phase 1 component appears at least once, in
 * every variant that changes its markup, and the locale and theme toggles let one browser session
 * cover English/Arabic × light/dark. If a component cannot be reached from here it is not covered,
 * which is why the variant lists are iterated from the exported constants rather than hand-written.
 */
export function ShowcaseScreen() {
    const { t } = useTranslation();
    const { locale, setLocale } = useLocale();
    const { colorScheme, toggleColorScheme } = useColorScheme();
    const toast = useToast();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [checked, setChecked] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [text, setText] = useState('');

    const options = [1, 2, 3].map((index) => ({
        value: `option-${index}`,
        label: t('designSystem:showcase.sampleOption', { index }),
    }));

    return (
        <Stack testID="showcase-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="showcase-title">
                    {t('designSystem:showcase.title')}
                </Heading>
                <Text tone="secondary">{t('designSystem:showcase.subtitle')}</Text>
                <Inline space="sm">
                    <Button
                        testID="showcase-toggle-locale"
                        size="sm"
                        variant="secondary"
                        label={t('designSystem:controls.toggleLocale')}
                        onPress={() => {
                            void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                        }}
                    />
                    <Button
                        testID="showcase-toggle-theme"
                        size="sm"
                        variant="secondary"
                        label={t('designSystem:controls.toggleTheme')}
                        onPress={toggleColorScheme}
                    />
                    <Badge
                        testID="showcase-theme"
                        tone="info"
                        label={t('designSystem:controls.currentTheme', {
                            theme: colorScheme ?? 'light',
                        })}
                    />
                </Inline>
            </Stack>

            <Section id="typography" title={t('designSystem:showcase.sections.typography')}>
                <Heading level={1}>Heading 1</Heading>
                <Heading level={2}>Heading 2</Heading>
                <Heading level={3}>Heading 3</Heading>
                <Heading level={4}>Heading 4</Heading>
                <Text variant="body">{t('designSystem:spike.sample.latin')}</Text>
                <Text variant="bodyStrong">{t('designSystem:spike.sample.arabic')}</Text>
                <Text variant="caption" tone="secondary">
                    {t('designSystem:spike.sample.digits')}
                </Text>
                <Inline space="sm">
                    <Badge label="Inline" tone="neutral" icon={null} />
                    <Badge label="items" tone="neutral" icon={null} />
                    <Badge label="wrap" tone="neutral" icon={null} />
                </Inline>
            </Section>

            <Section id="actions" title={t('designSystem:showcase.sections.actions')}>
                <Inline space="sm">
                    {BUTTON_VARIANTS.map((variant) => (
                        <Button
                            key={variant}
                            testID={`showcase-button-${variant}`}
                            variant={variant}
                            label={variant}
                            onPress={() => undefined}
                        />
                    ))}
                </Inline>
                <Inline space="sm">
                    {BUTTON_SIZES.map((size) => (
                        <Button
                            key={size}
                            testID={`showcase-button-size-${size}`}
                            size={size}
                            label={size}
                            iconEnd={<Icon name="chevronEnd" />}
                            onPress={() => undefined}
                        />
                    ))}
                </Inline>
                <Inline space="sm">
                    <Button testID="showcase-button-loading" loading label="loading" onPress={() => undefined} />
                    <Button testID="showcase-button-disabled" disabled label="disabled" onPress={() => undefined} />
                    <IconButton
                        testID="showcase-icon-button"
                        label={t('common:action.close')}
                        icon={<Icon name="close" />}
                        onPress={() => undefined}
                    />
                </Inline>
            </Section>

            <Section id="forms" title={t('designSystem:showcase.sections.forms')}>
                <TextInputField
                    testID="showcase-text-input"
                    id="showcase-text-input"
                    label={t('designSystem:showcase.sampleLabel')}
                    hint={t('designSystem:showcase.sampleHint')}
                    required
                    value={text}
                    onChangeText={setText}
                />
                <TextInputField
                    testID="showcase-text-input-error"
                    id="showcase-text-input-error"
                    label={t('designSystem:showcase.sampleLabel')}
                    error={t('designSystem:showcase.sampleError')}
                    value=""
                    onChangeText={() => undefined}
                />
                <PasswordInput
                    testID="showcase-password"
                    id="showcase-password"
                    label={t('auth:login.passwordLabel')}
                    value=""
                    onChangeText={() => undefined}
                />
                <Checkbox
                    testID="showcase-checkbox"
                    id="showcase-checkbox"
                    label={t('auth:register.acceptTerms')}
                    checked={checked}
                    onChange={setChecked}
                />
                <Select
                    testID="showcase-select"
                    id="showcase-select"
                    label={t('designSystem:showcase.sampleLabel')}
                    options={options}
                    value={selected}
                    onChange={setSelected}
                />
            </Section>

            <Section id="content" title={t('designSystem:showcase.sections.content')}>
                <Inline space="sm">
                    {CARD_TONES.map((tone) => (
                        <Card key={tone} testID={`showcase-card-${tone}`} tone={tone} padding="sm">
                            <Text variant="caption">{tone}</Text>
                        </Card>
                    ))}
                </Inline>
                <ListItem
                    testID="showcase-list-item"
                    title="Cedar Clinic"
                    description="Hamra · Jounieh"
                    leading={<Icon name="organisation" />}
                    trailing={<Badge label="Active" tone="success" />}
                    chevron
                    onPress={() => undefined}
                />
                <Inline space="sm">
                    {BADGE_TONES.map((tone) => (
                        <Badge key={tone} testID={`showcase-badge-${tone}`} tone={tone} label={tone} />
                    ))}
                </Inline>
                <Inline space="sm">
                    {NUTRITION_LEVELS.map((level) => (
                        <Badge
                            key={level}
                            testID={`showcase-nutrition-${level}`}
                            nutrition={level}
                            label={level}
                        />
                    ))}
                </Inline>
            </Section>

            <Section id="status" title={t('designSystem:showcase.sections.status')}>
                <Inline space="md">
                    <Spinner testID="showcase-spinner" showLabel />
                    <Spinner testID="showcase-spinner-large" size="large" />
                </Inline>
                <Skeleton testID="showcase-skeleton" heightClassName="h-6" />
                <EmptyState
                    testID="showcase-empty"
                    title={t('auth:devices.empty')}
                    body={t('auth:devices.emptyBody')}
                />
                <EmptyState
                    testID="showcase-prototype"
                    variant="prototype"
                    title={t('access:area.kitchen')}
                />
                <ErrorState
                    testID="showcase-error-retryable"
                    failure={apiFailure('network', { correlationId: 'showcase-0001' })}
                    onRetry={() => undefined}
                />
                <ErrorState
                    testID="showcase-error-terminal"
                    failure={validationFailure({ email: ['Already registered.'] })}
                    onRetry={() => undefined}
                />
                <ErrorState testID="showcase-error-rate-limit" failure={rateLimitFailure(30)} />
                <OfflineIndicator testID="showcase-offline" state="offline" />
                <OfflineIndicator testID="showcase-reconnecting" state="reconnecting" />
                <OfflineIndicator testID="showcase-restored" state="restored" />
            </Section>

            <Section id="overlays" title={t('designSystem:showcase.sections.overlays')}>
                <Inline space="sm">
                    <Button
                        testID="showcase-open-dialog"
                        label={t('designSystem:showcase.openDialog')}
                        onPress={() => {
                            setDialogOpen(true);
                        }}
                    />
                    <Button
                        testID="showcase-open-drawer"
                        variant="secondary"
                        label={t('designSystem:showcase.openDrawer')}
                        onPress={() => {
                            setDrawerOpen(true);
                        }}
                    />
                    <Button
                        testID="showcase-show-toast"
                        variant="ghost"
                        label={t('designSystem:showcase.showToast')}
                        onPress={() => {
                            toast.show({
                                message: t('designSystem:showcase.toastMessage'),
                                tone: 'success',
                                testID: 'showcase-toast',
                            });
                        }}
                    />
                </Inline>

                <Dialog
                    testID="showcase-dialog"
                    open={dialogOpen}
                    onClose={() => {
                        setDialogOpen(false);
                    }}
                    title={t('designSystem:showcase.dialogTitle')}
                    description={t('designSystem:showcase.dialogBody')}
                    actions={
                        <>
                            <Button
                                testID="showcase-dialog-cancel"
                                variant="secondary"
                                label={t('common:action.cancel')}
                                onPress={() => {
                                    setDialogOpen(false);
                                }}
                            />
                            <Button
                                testID="showcase-dialog-confirm"
                                variant="danger"
                                label={t('common:action.confirm')}
                                onPress={() => {
                                    setDialogOpen(false);
                                }}
                            />
                        </>
                    }
                />

                <Drawer
                    testID="showcase-drawer"
                    open={drawerOpen}
                    onClose={() => {
                        setDrawerOpen(false);
                    }}
                    title={t('designSystem:showcase.drawerTitle')}
                >
                    <ListItem title={t('common:nav.workspace')} chevron onPress={() => undefined} />
                    <ListItem title={t('common:nav.profile')} chevron onPress={() => undefined} />
                </Drawer>
            </Section>
        </Stack>
    );
}
