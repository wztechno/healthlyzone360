import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
    forgetListMemory,
    readListMemory,
    useListMemory,
    useRememberedFilter,
    useRememberedOpened,
    useRememberedPage,
    useRememberedPageNumber,
    useRememberedQuery,
    useRestoredPageFallback,
    writeListMemory,
} from './list-memory.ts';
import type { ListMemoryOptions } from './list-memory.ts';

/**
 * A list's memory: what it was left with comes back when it is mounted again, a filter change still
 * sends it to page one, and the memory belongs to one data cache.
 */

function wrapperFor(client: QueryClient) {
    return function Wrapper({ children }: { readonly children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

/** A list the way a screen holds one: a search, a segment, a page over both, and the row opened. */
function useProbeList(listKey: string, options?: ListMemoryOptions) {
    const memory = useListMemory(listKey, options);
    const [query, setQuery] = useRememberedQuery(memory);
    const [status, setStatus] = useRememberedFilter<string>(memory, 'status', 'all');
    const filter = useMemo(() => ({ query, status }), [query, status]);
    const [page, setPage] = useRememberedPage(memory, filter);
    const [opened, open] = useRememberedOpened(memory);
    return { query, setQuery, status, setStatus, page, setPage, opened, open };
}

async function mountProbe(client: QueryClient, listKey = 'kitchen.probe', fresh = false) {
    return renderHook(() => useProbeList(listKey, { fresh }), { wrapper: wrapperFor(client) });
}

afterEach(() => {
    forgetListMemory();
});

describe('list memory', () => {
    it('starts a list it has never seen on its defaults', async () => {
        const { result } = await mountProbe(new QueryClient());

        expect(result.current.query).toBe('');
        expect(result.current.status).toBe('all');
        expect(result.current.page).toBe(1);
        expect(result.current.opened).toBeNull();
    });

    it('gives a list back its search, filters, page and opened row when it mounts again', async () => {
        const client = new QueryClient();
        const first = await mountProbe(client);

        await act(async () => {
            first.result.current.setQuery('beans');
        });
        await act(async () => {
            first.result.current.setStatus('draft');
        });
        await act(async () => {
            first.result.current.setPage(3);
        });
        // Opening a row navigates away straight after, so it is written before any commit.
        await act(async () => {
            first.result.current.open('ing-42');
        });
        await first.unmount();

        const second = await mountProbe(client);

        expect(second.result.current.query).toBe('beans');
        expect(second.result.current.status).toBe('draft');
        expect(second.result.current.page).toBe(3);
        expect(second.result.current.opened).toBe('ing-42');
    });

    it('still sends a list to page one when a filter changes, and remembers that', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { page: 4, filters: { status: 'draft' } });
        const first = await mountProbe(client);
        expect(first.result.current.page).toBe(4);

        await act(async () => {
            first.result.current.setStatus('published');
        });
        expect(first.result.current.page).toBe(1);
        await first.unmount();

        const second = await mountProbe(client);
        expect(second.result.current.status).toBe('published');
        expect(second.result.current.page).toBe(1);
    });

    it('keeps one place per list and per data cache', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { query: 'oil', page: 2 });

        const other = await mountProbe(client, 'kitchen.other');
        expect(other.result.current.query).toBe('');
        expect(other.result.current.page).toBe(1);

        // A fresh client is a fresh session: nothing carries over to it.
        const elsewhere = await mountProbe(new QueryClient());
        expect(elsewhere.result.current.query).toBe('');

        expect(readListMemory(client, 'kitchen.probe').query).toBe('oil');
    });

    it('merges filters by name rather than replacing the set', () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { filters: { status: 'draft' } });
        writeListMemory(client, 'kitchen.probe', { filters: { category: 'dairy' } });

        expect(readListMemory(client, 'kitchen.probe').filters).toEqual({
            status: 'draft',
            category: 'dairy',
        });
    });

    it('starts a deep-linked list fresh, and remembers it from there', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { query: 'oil', page: 3, lastOpenedId: 'x' });

        const linked = await mountProbe(client, 'kitchen.probe', true);
        expect(linked.result.current.query).toBe('');
        expect(linked.result.current.page).toBe(1);
        expect(linked.result.current.opened).toBeNull();

        await act(async () => {
            linked.result.current.setQuery('rice');
        });
        expect(readListMemory(client, 'kitchen.probe').query).toBe('rice');
    });

    it('forgets every list on sign-out', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { query: 'oil' });

        forgetListMemory();

        const { result } = await mountProbe(client);
        expect(result.current.query).toBe('');
    });
});

describe('a restored page the list no longer has', () => {
    function useFallbackProbe(failed: boolean) {
        const memory = useListMemory('kitchen.probe');
        const [page, setPage] = useRememberedPageNumber(memory);
        useRestoredPageFallback(memory, page, failed, () => {
            setPage(1);
        });
        return page;
    }

    it('goes back to page one when the restored page is refused', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { page: 5 });

        const { result } = await renderHook(() => useFallbackProbe(true), {
            wrapper: wrapperFor(client),
        });

        expect(result.current).toBe(1);
        expect(readListMemory(client, 'kitchen.probe').page).toBe(1);
    });

    it('stays on the restored page when it loads', async () => {
        const client = new QueryClient();
        writeListMemory(client, 'kitchen.probe', { page: 5 });

        const { result } = await renderHook(() => useFallbackProbe(false), {
            wrapper: wrapperFor(client),
        });

        expect(result.current).toBe(5);
    });
});
