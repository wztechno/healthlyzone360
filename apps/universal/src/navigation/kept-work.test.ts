import {
    MAX_KEPT_WORK,
    discardKeptWork,
    forgetKeptWork,
    keepWork,
    keptWorkAway,
    onWorkKept,
    readKeptWork,
} from './kept-work.ts';
import type { KeptWork } from './kept-work.ts';
import { clearAllSessionDrafts, createSessionDraftStore } from './session-draft.ts';

const drafts = createSessionDraftStore<{ readonly name: string }>({
    namespace: 'recipeEditor',
    parse: (raw) => raw as { readonly name: string },
});

function recipe(
    key: string,
    subject: string | null = 'Bbq Sauce Dip',
): Omit<KeptWork, 'id' | 'keptAt'> {
    return {
        kind: 'recipe',
        subject,
        href: `/kitchen/recipes/${key}?tab=production`,
        draft: { namespace: 'recipeEditor', key },
    };
}

afterEach(() => {
    clearAllSessionDrafts();
});

describe('kept work', () => {
    it('lists every editor kept, newest first, and one entry per draft', () => {
        keepWork(recipe('recipe-1'));
        keepWork({
            kind: 'ingredient',
            subject: null,
            href: '/kitchen/ingredients/new',
            draft: { namespace: 'ingredientEditor', key: 'new:/kitchen/ingredients' },
        });
        keepWork(recipe('recipe-1', 'Bbq Sauce Dip, smoky'));

        const list = readKeptWork();
        expect(list.map((entry) => entry.id)).toEqual([
            'recipe:recipe-1',
            'ingredient:new:/kitchen/ingredients',
        ]);
        expect(list[0]?.subject).toBe('Bbq Sauce Dip, smoky');
    });

    it('keeps at most a card of them, throwing the oldest draft away with its entry', () => {
        for (let index = 0; index <= MAX_KEPT_WORK; index += 1) {
            drafts.write(`recipe-${String(index)}`, { name: String(index) });
            keepWork(recipe(`recipe-${String(index)}`));
        }
        expect(readKeptWork()).toHaveLength(MAX_KEPT_WORK);
        expect(readKeptWork().some((entry) => entry.id === 'recipe:recipe-0')).toBe(false);
        expect(drafts.read('recipe-0')).toBeNull();
        expect(drafts.read('recipe-1')).not.toBeNull();
    });

    it('forgets an entry saved on its page, leaving the draft to the page', () => {
        drafts.write('recipe-1', { name: 'typed' });
        keepWork(recipe('recipe-1'));
        forgetKeptWork('recipe', 'recipe-1');
        expect(readKeptWork()).toEqual([]);
        expect(drafts.read('recipe-1')).toEqual({ name: 'typed' });
    });

    it('throws the draft away with an entry discarded from the card', () => {
        drafts.write('recipe-1', { name: 'typed' });
        keepWork(recipe('recipe-1'));
        discardKeptWork('recipe:recipe-1');
        expect(readKeptWork()).toEqual([]);
        expect(drafts.read('recipe-1')).toBeNull();
    });

    it('says when something new is kept, so the card opens again', () => {
        const listener = jest.fn();
        const stop = onWorkKept(listener);
        keepWork(recipe('recipe-1'));
        expect(listener).toHaveBeenCalledTimes(1);
        stop();
        keepWork(recipe('recipe-2'));
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is not offered on its own page', () => {
        keepWork(recipe('recipe-1'));
        keepWork(recipe('recipe-2'));
        expect(
            keptWorkAway(readKeptWork(), '/kitchen/recipes/recipe-1').map((entry) => entry.id),
        ).toEqual(['recipe:recipe-2']);
    });
});
