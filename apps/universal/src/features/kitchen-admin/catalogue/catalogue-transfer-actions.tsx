import type { Repositories } from '@healthy360/api-client';
import type { DownloadedFile, ImportReport, ImportUpload } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Dialog,
    Icon,
    Inline,
    Menu,
    Stack,
    Tag,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { FileUploadRejection, MenuItem } from '@healthy360/design-system';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    useDownloadFileMutation,
    useImportRecordsMutation,
} from '../../../data/catalogue-transfer-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { canSaveFiles } from '../save-download.ts';
import { ImportDropZone } from './import-drop-zone.tsx';
import type { ImportGuide } from './import-guides.ts';

/**
 * Import and Export, the pair that opens every Catalogue list beside its primary.
 *
 * One component rather than the same two buttons written into five screens, for the reason the
 * column header and the toolbar are also one each: the next change to how a catalogue moves records
 * in and out is then a change to this file, not a hunt through `screens/`.
 *
 * ## Each half is wired by a prop, and disabled without it
 *
 * `importGuide` turns Import into a dialog that says what the sheet needs — every column verbatim,
 * which are required, the values a column accepts, how rows are matched — before it asks for a
 * file, then reports what the import did row by row. `exportMenu` turns Export into a menu: Excel
 * where this build can save a file (the web), and whatever PDF views the screen offers.
 *
 * A screen that passes neither (packaging, products) gets exactly the disabled pair it always had.
 * Drawing them disabled rather than hiding them is the argument the row's Archive makes: a reader
 * who cannot see the control cannot tell whether the page lacks the feature or their role lacks the
 * permission. Each carries an `accessibilityLabel` that says "not available yet" in words, because
 * a disabled control announces no reason on its own.
 *
 * ## Not on Allergen classes
 *
 * That screen reads a platform vocabulary a kitchen does not own — there is nothing there to
 * import and nothing that would mean anything exported.
 */

export interface ExportMenuSpec {
    readonly excel?:
        | {
              readonly load: (repositories: Repositories) => Promise<DownloadedFile>;
              readonly fallbackName: string;
              readonly disabled?: boolean | undefined;
          }
        | undefined;
    readonly pdf: readonly {
        readonly key: string;
        readonly label: string;
        readonly onSelect: () => void;
        readonly disabled?: boolean | undefined;
    }[];
}

export interface CatalogueTransferActionsProps {
    /**
     * The screen's toolbar id — `kitchen-ingredients-toolbar`. The buttons take `-import` and
     * `-export`, which keeps the id the ingredient list's Import already shipped with.
     */
    readonly testID: string;
    /** Absent → Import is drawn disabled with the "not available yet" label (packaging, products). */
    readonly importGuide?: ImportGuide | undefined;
    /** Stock without a branch: the dialog shows this warning instead of the drop zone. */
    readonly importBlocked?: { readonly title: string; readonly body: string } | undefined;
    /** Absent → Export is drawn disabled. */
    readonly exportMenu?: ExportMenuSpec | undefined;
}

/** The limit as the copy states it; `IMPORT_MAX_BYTES` is the number the drop zone checks. */
const LIMIT_LABEL = '5 MB';
/** Rows of the report listed before the rest are summarised as a count. */
const MAX_LISTED_ROWS = 100;

export function CatalogueTransferActions({
    testID,
    importGuide,
    importBlocked,
    exportMenu,
}: CatalogueTransferActionsProps) {
    const { t } = useTranslation();

    return (
        <>
            {importGuide === undefined ? (
                <Button
                    testID={`${testID}-import`}
                    variant="secondary"
                    disabled
                    label={t('kitchen:list.import')}
                    accessibilityLabel={t('kitchen:list.importUnavailable')}
                />
            ) : (
                <ImportControl testID={testID} guide={importGuide} blocked={importBlocked} />
            )}
            {exportMenu === undefined ? (
                <DisabledExport testID={testID} />
            ) : (
                <ExportControl testID={testID} menu={exportMenu} />
            )}
        </>
    );
}

function DisabledExport({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    return (
        <Button
            testID={`${testID}-export`}
            variant="secondary"
            disabled
            label={t('kitchen:list.export')}
            accessibilityLabel={t('kitchen:list.exportUnavailable')}
        />
    );
}

/* ── Export ───────────────────────────────────────────────────────────────────────────────────── */

function ExportControl({
    testID,
    menu,
}: {
    readonly testID: string;
    readonly menu: ExportMenuSpec;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const download = useDownloadFileMutation();

    const items: MenuItem[] = [];
    const excel = menu.excel;
    if (excel !== undefined && canSaveFiles()) {
        items.push({
            key: 'excel',
            label: t('kitchen:transfer.export.excel'),
            testID: `${testID}-export-excel`,
            disabled: excel.disabled === true || download.isPending,
            onSelect: () => {
                download.mutate(excel, {
                    onError: () => {
                        toast.show({
                            tone: 'danger',
                            message: t('kitchen:transfer.export.failed'),
                        });
                    },
                });
            },
        });
    }
    for (const pdf of menu.pdf) {
        items.push({
            key: pdf.key,
            label: pdf.label,
            testID: `${testID}-export-${pdf.key}`,
            disabled: pdf.disabled,
            onSelect: pdf.onSelect,
        });
    }

    // Native with only Excel on offer: nothing this build can do, so the honest disabled state.
    if (items.length === 0) return <DisabledExport testID={testID} />;

    return (
        <Menu
            label={t('kitchen:transfer.export.menuLabel')}
            align="end"
            sections={[{ items }]}
            trigger={({ triggerProps, toggle }) => (
                <Button
                    {...triggerProps}
                    testID={`${testID}-export`}
                    variant="secondary"
                    label={t('kitchen:list.export')}
                    loading={download.isPending}
                    iconEnd={<Icon name="chevronDown" size="sm" />}
                    onPress={toggle}
                />
            )}
        />
    );
}

/* ── Import ───────────────────────────────────────────────────────────────────────────────────── */

interface Issue {
    readonly title: string;
    readonly body?: string | undefined;
}

function rejectionIssue(t: TFunction, reason: FileUploadRejection): Issue {
    switch (reason) {
        case 'wrong_type':
            return { title: t('kitchen:transfer.error.wrongType') };
        case 'too_large':
            return { title: t('kitchen:transfer.error.tooLarge', { size: LIMIT_LABEL }) };
        case 'unreadable':
            return { title: t('kitchen:transfer.error.unreadable') };
    }
}

function failureIssue(t: TFunction, error: unknown): Issue {
    const failure = toFailure(error);
    switch (failure?.code) {
        case 'validation.failed':
            return {
                title: t('kitchen:transfer.error.rejectedTitle'),
                // The server's message is already in the reader's language.
                body: failure.fields['file']?.[0] ?? failure.message,
            };
        case 'rate_limit.exceeded':
            return {
                title: t('kitchen:transfer.error.throttled', {
                    minutes: Math.max(1, Math.ceil(failure.retryAfterSeconds / 60)),
                }),
            };
        case 'context.organisation_required':
            return {
                title: t('kitchen:transfer.stock.branchRequiredTitle'),
                body: t('kitchen:transfer.stock.branchRequiredBody'),
            };
        default:
            return { title: t('kitchen:transfer.error.failed') };
    }
}

interface PickedFile {
    readonly upload: ImportUpload;
    readonly name: string;
    readonly size: number;
}

function ImportControl({
    testID,
    guide,
    blocked,
}: {
    readonly testID: string;
    readonly guide: ImportGuide;
    readonly blocked: CatalogueTransferActionsProps['importBlocked'];
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const importer = useImportRecordsMutation(guide.resource);
    const download = useDownloadFileMutation();
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<PickedFile | null>(null);
    const [rejected, setRejected] = useState<Issue | null>(null);

    const close = () => {
        setOpen(false);
        setPicked(null);
        setRejected(null);
        importer.reset();
    };

    const issue = rejected ?? (importer.isError ? failureIssue(t, importer.error) : null);
    const report = importer.data;

    const downloadTemplate = () => {
        download.mutate(
            {
                load: (repositories) =>
                    repositories.kitchenAdmin.downloadImportTemplate(guide.resource),
                fallbackName: `${guide.resource}-import-template.xlsx`,
            },
            {
                onError: () => {
                    toast.show({
                        tone: 'danger',
                        message: t('kitchen:transfer.export.templateFailed'),
                    });
                },
            },
        );
    };

    const actions =
        report !== undefined ? (
            <Button
                testID={`${testID}-import-done`}
                label={t('kitchen:transfer.import.done')}
                onPress={close}
            />
        ) : (
            <>
                <Button
                    testID={`${testID}-import-cancel`}
                    variant="secondary"
                    label={t('kitchen:common.cancel')}
                    onPress={close}
                />
                <Button
                    testID={`${testID}-import-submit`}
                    label={t('kitchen:transfer.import.action')}
                    disabled={picked === null || blocked !== undefined}
                    loading={importer.isPending}
                    onPress={() => {
                        if (picked !== null) importer.mutate(picked.upload);
                    }}
                />
            </>
        );

    return (
        <>
            <Button
                testID={`${testID}-import`}
                variant="secondary"
                label={t('kitchen:list.import')}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Dialog
                open={open}
                onClose={close}
                testID={`${testID}-import-dialog`}
                title={t(guide.titleKey)}
                description={t('kitchen:transfer.import.description')}
                actions={actions}
            >
                {report !== undefined ? (
                    <ImportResult testID={`${testID}-import-result`} report={report} />
                ) : (
                    <>
                        <GuideBlock
                            testID={`${testID}-import`}
                            guide={guide}
                            templatePending={download.isPending}
                            onDownloadTemplate={downloadTemplate}
                        />
                        {blocked !== undefined ? (
                            <Callout
                                testID={`${testID}-import-blocked`}
                                tone="warning"
                                title={blocked.title}
                                body={blocked.body}
                            />
                        ) : (
                            <ImportDropZone
                                testID={`${testID}-import-drop`}
                                disabled={importer.isPending}
                                picked={picked}
                                onPick={(upload, size) => {
                                    setPicked({ upload, name: upload.fileName, size });
                                    setRejected(null);
                                    importer.reset();
                                }}
                                onReject={(reason) => {
                                    setPicked(null);
                                    setRejected(rejectionIssue(t, reason));
                                    importer.reset();
                                }}
                            />
                        )}
                        {issue === null ? null : (
                            <Callout
                                testID={`${testID}-import-issue`}
                                tone="danger"
                                role="alert"
                                title={issue.title}
                                body={issue.body}
                            />
                        )}
                    </>
                )}
            </Dialog>
        </>
    );
}

function GuideBlock({
    testID,
    guide,
    templatePending,
    onDownloadTemplate,
}: {
    readonly testID: string;
    readonly guide: ImportGuide;
    readonly templatePending: boolean;
    readonly onDownloadTemplate: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Stack space="sm" testID={`${testID}-guide`}>
            <Text variant="bodyStrong">{t('kitchen:transfer.guide.heading')}</Text>
            <Text variant="caption" tone="secondary">
                {t('kitchen:transfer.guide.columnsCaption')}
            </Text>
            <View className="rounded-md border border-stroke-subtle">
                {guide.columns.map((column, index) => (
                    <View
                        key={column.header}
                        testID={`${testID}-column-${String(index)}`}
                        className={
                            index === 0
                                ? 'gap-0.5 px-3 py-2'
                                : 'gap-0.5 border-t border-stroke-subtle px-3 py-2'
                        }
                    >
                        <Inline space="sm" align="center" wrap>
                            <Text variant="bodyStrong">{column.header}</Text>
                            {column.required ? (
                                <Tag tone="brand" label={t('kitchen:transfer.guide.required')} />
                            ) : (
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:common.optional')}
                                </Text>
                            )}
                        </Inline>
                        <Text tone="secondary">{t(column.hintKey)}</Text>
                        {column.values === undefined || column.values.length === 0 ? null : (
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:transfer.guide.acceptedValues', {
                                    values: column.values.join(', '),
                                })}
                            </Text>
                        )}
                    </View>
                ))}
            </View>
            <Text>{t(guide.matchRuleKey)}</Text>
            <Text tone="secondary">
                {t('kitchen:transfer.guide.rowCap', { count: guide.rowCap })}
            </Text>
            <Inline space="sm" align="center" wrap>
                <Button
                    testID={`${testID}-template`}
                    variant="quiet"
                    size="sm"
                    loading={templatePending}
                    label={t('kitchen:transfer.guide.downloadTemplate')}
                    onPress={onDownloadTemplate}
                />
                <Text variant="caption" tone="secondary">
                    {t('kitchen:transfer.guide.templateHint')}
                </Text>
            </Inline>
        </Stack>
    );
}

const OUTCOMES = ['created', 'updated', 'unchanged', 'skipped', 'failed'] as const;

function ImportResult({
    testID,
    report,
}: {
    readonly testID: string;
    readonly report: ImportReport;
}) {
    const { t } = useTranslation();
    const issues = report.rows.filter(
        (row) => row.outcome === 'skipped' || row.outcome === 'failed',
    );
    const listed = issues.slice(0, MAX_LISTED_ROWS);

    return (
        <Stack space="md" testID={testID}>
            <Text variant="strong">{t('kitchen:transfer.result.title')}</Text>
            <Inline space="lg" wrap>
                {OUTCOMES.map((outcome) => (
                    <Stack key={outcome} space="xs">
                        <Text variant="caption" tone="secondary">
                            {t(`kitchen:transfer.result.${outcome}`)}
                        </Text>
                        <Text testID={`${testID}-${outcome}`} variant="display">
                            {String(report[outcome])}
                        </Text>
                    </Stack>
                ))}
            </Inline>
            {report.ignoredColumns.length === 0 ? null : (
                <Text testID={`${testID}-ignored`} tone="secondary">
                    {t('kitchen:transfer.result.ignoredColumns', {
                        columns: report.ignoredColumns.join(t('kitchen:common.listSeparator')),
                    })}
                </Text>
            )}
            {issues.length === 0 ? (
                <Text testID={`${testID}-no-issues`}>{t('kitchen:transfer.result.noIssues')}</Text>
            ) : (
                <Stack space="xs">
                    <Text variant="bodyStrong">{t('kitchen:transfer.result.issuesHeading')}</Text>
                    {listed.map((row) => (
                        <Text
                            key={`${String(row.row)}-${row.outcome}`}
                            testID={`${testID}-row-${String(row.row)}`}
                            tone={row.outcome === 'failed' ? 'danger' : 'secondary'}
                        >
                            {[
                                t('kitchen:transfer.result.row', { row: row.row }),
                                row.reference,
                                row.message,
                            ]
                                .filter((part) => part !== null && part !== '')
                                .join(' · ')}
                        </Text>
                    ))}
                    {issues.length > listed.length ? (
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:transfer.result.truncated', {
                                shown: listed.length,
                                total: issues.length,
                            })}
                        </Text>
                    ) : null}
                </Stack>
            )}
        </Stack>
    );
}
