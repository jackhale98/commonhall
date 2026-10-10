-- Middletown, Connecticut: the Common Council's meetings, agenda items (resolutions,
-- ordinances, appropriations) and members from the city's CivicPlus Agenda Center
-- and website, read daily by the "Load Middletown agendas" workflow (the agendas are
-- PDFs, read with pdftotext); and a daily 311 report from SeeClickFix (public API, no
-- key; only the report is stored). The council is elected citywide, so "Load council
-- districts" loads the city's whole boundary (district 0).

select cron.schedule('sync-middletown-311', '23 10 * * *', $$select private.invoke_sync('sync-middletown-311')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('load-middletown-agendas', 'Middletown Common Council', '1 day', 'workflow: Load Middletown agendas'),
  ('middletown-311', 'Middletown 311 requests', '1 day', 'sync-middletown-311')
on conflict (job) do nothing;
