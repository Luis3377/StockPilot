// Manual beta finding: a time link defaulted to the first source in the list. Nothing is chosen
// for the user now: a link left on "Choose…" is pointed out when saving.
import { describe, expect, it } from 'vitest';
import { addTimeEntry, createSource } from './sourcing';
import { emptyData } from './types';
import { clock } from './testUtils';

describe('time entry links', () => {
  it('a link with nothing chosen is refused with a clear message, not filled in', () => {
    const data = createSource(emptyData(), { name: 'Saturday Garage Sale', type: 'garage_sale' }, clock()).data;
    expect(() => addTimeEntry(data, { date: '2026-11-05', minutes: 60, activity: 'sourcing', links: [{ kind: 'source', id: '', sharePct: null }], split: 'equal' }, clock())).toThrow('Choose which source this time was for, or remove that link.');
    const ok = addTimeEntry(data, { date: '2026-11-05', minutes: 60, activity: 'sourcing', links: [], split: 'equal' }, clock());
    expect(ok.data.sourcing.timeEntries[0].links).toEqual([]); // unlinked: general work
  });
});
