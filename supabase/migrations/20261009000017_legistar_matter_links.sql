-- Legistar's website rejects the API's MatterGuid ("Invalid parameters!"). Link matters
-- through the gateway, which redirects from the API's MatterId.
update public.local_matters
   set legistar_url = 'https://' || city || '.legistar.com/gateway.aspx?M=L&ID=' || matter_id
 where legistar_url is distinct from 'https://' || city || '.legistar.com/gateway.aspx?M=L&ID=' || matter_id;
