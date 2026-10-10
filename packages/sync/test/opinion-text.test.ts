import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { opinionSummary } from '../src/state/opinion-text.ts';

const sample = readFileSync(new URL('./fixtures/opinions/sjc-sample.txt', import.meta.url), 'utf8');

describe('opinionSummary', () => {
  it("reads the reporter's subject keywords and the opinion's opening paragraph", () => {
    const { keywords, opening } = opinionSummary(sample);
    expect(keywords).toBe(
      'Homicide. Evidence, Prior misconduct, Hearsay. Constitutional Law, Confrontation of witnesses. Practice, Criminal, Capital case.',
    );
    expect(opening).toBe(
      "The defendant was convicted of murder in the first degree for the shooting death of the victim outside a Dorchester apartment building in 2018. On appeal, she argues that the judge erred in admitting evidence of a prior dispute between the defendant and the victim, and that a witness's statement to police was inadmissible hearsay. We affirm.",
    );
  });

  it('reads a per curiam opening and gives null for what it cannot find', () => {
    expect(
      opinionSummary(
        'Some header\n\n     PER CURIAM.  The petitioner appeals from a judgment of a single justice denying relief.\n',
      ),
    ).toEqual({
      keywords: null,
      opening: 'The petitioner appeals from a judgment of a single justice denying relief.',
    });
    expect(opinionSummary('Damaged text with no structure at all.')).toEqual({ keywords: null, opening: null });
  });
});
