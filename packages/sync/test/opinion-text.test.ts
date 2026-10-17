import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { opinionSummary, stateSeparateOpinions } from '../src/state/opinion-text.ts';

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

describe('opinionSummary on real slip opinions', () => {
  const real = (name: string) => readFileSync(new URL(`./fixtures/opinions/${name}`, import.meta.url), 'utf8');

  it('reads a double-spaced opening paragraph to its end', () => {
    const { keywords, opening } = opinionSummary(real('sjc-goncalves-slip-layout.txt'));
    expect(keywords).toMatch(/^Evidence, Photograph, State of mind/);
    expect(opening).toMatch(/^The defendant, Clerence H\. Goncalves, surreptitiously photographed/);
    expect(opening).toMatch(/The defendant challenges both convictions on appeal\.$/);
  });

  it('reads an opening from text extracted without the layout', () => {
    const { opening } = opinionSummary(real('sjc-holbrook-slip-raw.txt'));
    expect(opening).toMatch(/^Before us is the defendant's appeal from the denial of his amended second motion/);
    expect(opening!.length).toBeGreaterThan(200);
  });

  it("reads a Connecticut opinion's opening, without footnote markers or line-end hyphens", () => {
    const { keywords, opening } = opinionSummary(real('conn-jose-t-opinion-layout.txt'));
    expect(keywords).toBeNull();
    expect(opening).toMatch(/^The defendant, Jose T\., appeals directly to this court/);
    expect(opening).toContain('§ 53-21 (a) (2). His principal claim');
    // Cut at a sentence end, not after "State v.".
    expect(opening).toMatch(/evaluating her credibility\.$/);
  });

  it('names concurring and dissenting opinions from their headings', () => {
    expect(stateSeparateOpinions(real('sjc-piper-headings.txt'))).toEqual([
      { author: 'Kafker', kind: 'concurring', joined: ['Wendlandt'] },
      { author: 'Chief Justice Budd', kind: 'dissenting', joined: [] },
    ]);
    expect(
      stateSeparateOpinions(
        '\n     GEORGES, J. (concurring in part and dissenting in part, with whom Budd, C.J., and Dewar, J., join).\n',
      ),
    ).toEqual([
      {
        author: 'Georges',
        kind: 'concurring in part and dissenting in part',
        joined: ['Chief Justice Budd', 'Dewar'],
      },
    ]);
    expect(stateSeparateOpinions(real('sjc-goncalves-slip-layout.txt'))).toEqual([]);
  });
});
