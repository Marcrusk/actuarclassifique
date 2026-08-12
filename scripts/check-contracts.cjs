const fs = require('node:fs');
const migration = fs.readFileSync('supabase/migrations/202608100001_performance_platform.sql', 'utf8');
const required = ['users','teams','team_memberships','roles','permissions','manager_teams','score_cycles','point_rules','requests','request_evidences','request_events','manager_decisions','point_ledger','notifications','audit_logs'];
const missing = required.filter(name => !new RegExp(`create table(?: if not exists)? public\\.${name}\\b`, 'i').test(migration));
if (missing.length) { console.error(`Entidades ausentes: ${missing.join(', ')}`); process.exit(1); }
for (const rpc of ['import_legacy_profiles','link_invited_auth_user','submit_request','begin_request_review','request_correction','resubmit_request','approve_request','not_approve_request','cancel_approved_request','close_score_cycle']) {
  if (!new RegExp(`function public\\.${rpc}\\b`, 'i').test(migration)) { console.error(`RPC ausente: ${rpc}`); process.exit(1); }
}
console.log('Contrato de dados e RPCs verificado.');
