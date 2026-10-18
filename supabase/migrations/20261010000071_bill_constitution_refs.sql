-- The constitutional provisions a House bill's sponsor cites as Congress's authority
-- to pass it, read from the constitutional authority statement Congress.gov returns
-- with each bill (packages/sync/src/federal/authority.ts), as Res Publica refs
-- ('Constitution.1.8.3', 'Amendment.14.5'). Bill pages link each one to the clause on
-- respublicalibrary.org.
--
-- Null means not read yet; an empty array means the bill has no statement or names no
-- numbered provision (Senate bills, simple resolutions, measures reported by a
-- committee). New and updated bills get it from the detail the bill sync already
-- fetches. The rest, about 11,000 House bills and joint resolutions, are caught up by
-- sync-committees, 60 an hour, most recently active first: one Congress.gov request
-- each (the "congress" hourly budget), about 1,440 a day for eight days.

alter table public.bills add column constitution_refs text[];

comment on column public.bills.constitution_refs is
  'Res Publica refs of the constitutional provisions the sponsor cites as authority (House bills); null until read.';
