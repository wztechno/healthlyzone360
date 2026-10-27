import type { Repositories } from '@healthy360/api-client';
import type {
    DownloadedFile,
    ImportReport,
    ImportUpload,
    TransferResource,
} from '@healthy360/api-client/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import { saveDownload } from '../features/kitchen-admin/save-download.ts';
import { queryKeys } from './query-keys.ts';
import { useRepositories } from './repository-provider.tsx';

/**
 * Uploads a workbook into one Catalogue list.
 *
 * The lists are re-read on *settle*, not on success: the server applies rows as it goes, so a
 * response that failed part-way can still follow rows it committed. Stock lives under
 * `kitchenOps`; ingredients and recipes under `kitchenAdmin`.
 */
export function useImportRecordsMutation(
    resource: TransferResource,
): UseMutationResult<ImportReport, unknown, ImportUpload> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (upload: ImportUpload) =>
            repositories.kitchenAdmin.importRecords(resource, upload),
        onSettled: () => {
            void queryClient.invalidateQueries({
                queryKey:
                    resource === 'stock'
                        ? queryKeys.kitchenOps.all()
                        : queryKeys.kitchenAdmin.all(),
            });
        },
    });
}

export interface DownloadFileVariables {
    readonly load: (repositories: Repositories) => Promise<DownloadedFile>;
    readonly fallbackName: string;
}

/** Fetches a file (an export, a template) and hands it to the browser to save. */
export function useDownloadFileMutation(): UseMutationResult<void, unknown, DownloadFileVariables> {
    const repositories = useRepositories();

    return useMutation({
        mutationFn: async ({ load, fallbackName }: DownloadFileVariables) => {
            saveDownload(await load(repositories), fallbackName);
        },
    });
}
