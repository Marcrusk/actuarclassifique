begin;

do $$
declare
  v_manager_auth uuid := '10000000-0000-0000-0000-000000000001';
  v_analyst_auth uuid := '10000000-0000-0000-0000-000000000002';
  v_other_auth uuid := '10000000-0000-0000-0000-000000000003';
  v_manager uuid; v_analyst uuid; v_other uuid;
  v_team uuid; v_other_team uuid; v_cycle uuid; v_rule uuid;
  v_request public.requests; v_entry public.point_ledger;
begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    ('00000000-0000-0000-0000-000000000000',v_manager_auth,'authenticated','authenticated','manager.test@actuar.local','x',now(),'{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',v_analyst_auth,'authenticated','authenticated','analyst.test@actuar.local','x',now(),'{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',v_other_auth,'authenticated','authenticated','other.test@actuar.local','x',now(),'{}','{}',now(),now());

  select id into v_team from public.teams where code='Sistema';
  select id into v_other_team from public.teams where code='Catraca';
  select id into v_cycle from public.score_cycles where code='2026-08';
  select id into v_rule from public.point_rules where request_type='priority' and team_id=v_team order by version desc limit 1;

  update public.users set first_name='Gestor Teste',status='active',role_id=(select id from public.roles where code='manager'),primary_team_id=v_team where auth_user_id=v_manager_auth returning id into v_manager;
  update public.users set first_name='Analista Teste',status='active',primary_team_id=v_team,responsible_manager_id=v_manager,legacy_user_key='test_analyst' where auth_user_id=v_analyst_auth returning id into v_analyst;
  update public.users set first_name='Outro Gestor',status='active',role_id=(select id from public.roles where code='manager'),primary_team_id=v_other_team where auth_user_id=v_other_auth returning id into v_other;
  insert into public.manager_teams(manager_id,team_id) values(v_manager,v_team),(v_other,v_other_team);

  perform set_config('request.jwt.claim.sub',v_analyst_auth::text,true);
  select * into v_request from public.create_request('priority','TESTE-001','Cliente teste','2026-08-10 10:00-03','Cenário auditável',null,'Gestão','Demanda atribuída','Evidência registrada',null,null,null,null,true);
  if v_request.analyst_id<>v_analyst or v_request.expected_points<>50 or v_request.status<>'pending_review' then raise exception 'Falha ao criar solicitação com identidade/regra da sessão'; end if;

  perform set_config('request.jwt.claim.sub',v_other_auth::text,true);
  begin perform public.begin_request_review(v_request.id); raise exception 'Gestor de outra equipe acessou a solicitação'; exception when others then if sqlerrm='Gestor de outra equipe acessou a solicitação' then raise; end if; end;

  perform set_config('request.jwt.claim.sub',v_manager_auth::text,true);
  perform public.begin_request_review(v_request.id);
  perform public.request_correction(v_request.id,'Detalhe a evidência',array['criteria_evidence']);

  perform set_config('request.jwt.claim.sub',v_analyst_auth::text,true);
  perform public.resubmit_request(v_request.id,jsonb_build_object('criteria_evidence','Evidência corrigida'),'Correção enviada');

  perform set_config('request.jwt.claim.sub',v_manager_auth::text,true);
  perform public.begin_request_review(v_request.id);
  select * into v_entry from public.approve_request(v_request.id,null,'Critérios atendidos');
  perform public.approve_request(v_request.id,null,'Repetição idempotente');
  if (select count(*) from public.point_ledger where request_id=v_request.id and movement_type='credit')<>1 then raise exception 'Aprovação duplicou o crédito'; end if;

  perform set_config('request.jwt.claim.sub',v_analyst_auth::text,true);
  begin perform public.create_request('priority','TESTE-FECHADO','Cliente','2026-07-01','Fora do ciclo',null,null,null,null,null,null,null,null,true); raise exception 'Solicitação sem ciclo foi aceita'; exception when others then if sqlerrm='Solicitação sem ciclo foi aceita' then raise; end if; end;
end $$;

rollback;
