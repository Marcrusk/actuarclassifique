import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('Sessão ausente.');

    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: identity, error: identityError } = await caller.auth.getUser();
    if (identityError || !identity.user) throw new Error('Sessão inválida.');
    const { data: profile, error: profileError } = await caller
      .from('users').select('id,status,role:roles(code)').eq('auth_user_id', identity.user.id).single();
    if (profileError || profile.status !== 'active' || profile.role.code !== 'administrator') throw new Error('Somente administradores podem convidar usuários.');

    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const firstName = String(body.first_name || '').trim();
    const lastName = String(body.last_name || '').trim() || undefined;
    const legacyUserKey = String(body.legacy_user_key || '').trim() || undefined;
    if (!email || !firstName) throw new Error('E-mail e nome são obrigatórios.');

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    let legacyProfile: { id: string; first_name: string; last_name: string | null } | null = null;
    if (legacyUserKey) {
      const { data, error } = await admin.from('users')
        .select('id,first_name,last_name').eq('legacy_user_key', legacyUserKey).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('A ficha legada selecionada não foi encontrada.');
      legacyProfile = data;
    }
    const redirectTo = body.redirect_to || `${request.headers.get('origin') || ''}/#/profile`;
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        first_name: legacyProfile?.first_name || firstName,
        last_name: legacyProfile?.last_name || lastName,
      },
    });
    if (inviteError) throw inviteError;

    const { data: linkedProfile, error: linkError } = await admin.rpc('link_invited_auth_user', {
      p_auth_user_id: invited.user.id,
      p_email: email,
      p_first_name: legacyProfile?.first_name || firstName,
      p_last_name: legacyProfile?.last_name || lastName || null,
      p_legacy_user_key: legacyUserKey || null,
    });
    if (linkError) throw linkError;

    await admin.from('audit_logs').insert({
      actor_id: profile.id,
      actor_auth_user_id: identity.user.id,
      actor_role: 'administrator',
      action: 'user.invited',
      entity_type: 'user',
      entity_id: linkedProfile.id,
      context: { invited_auth_user_id: invited.user.id, email, legacy_user_key: legacyUserKey || null },
    });
    return new Response(JSON.stringify({ id: invited.user.id, email }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
