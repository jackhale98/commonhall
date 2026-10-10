-- Senate amendment votes (and cloture or tabling motions on amendments) name the
-- amendment as their document, so they were stored without the bill they amend.
-- The sync now reads the bill from the file's amendment block; this links the
-- votes already stored, from the question ("… S.Amdt. 6776 to S. 4668 (…)").
update public.votes v
   set bill_id = v.congress || '-' || lower(replace(m[1], '.', '')) || '-' || m[2]
  from (
    select id, regexp_match(question,
             ' to (H\.R\.|S\.|H\.J\.Res\.|S\.J\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.|H\.Res\.|S\.Res\.) ?(\d+)') as m
      from public.votes
     where chamber = 'senate' and bill_id is null and amendment is not null
  ) x
 where x.id = v.id and x.m is not null;

-- Budget-waiver motions on amendments ("… Re: Schiff Amdt. No. 5740") don't name the
-- bill in the question. Stored votes are never re-read, so remove the current
-- session's unlinked ones: the next Senate vote sync fetches them again (it reads
-- every roll call on senate.gov's menu that we don't hold) and links the bill.
-- Positions go with them (on delete cascade) and come back with the re-read.
delete from public.votes
 where chamber = 'senate' and congress = 119 and session = 2
   and bill_id is null and amendment is not null;
