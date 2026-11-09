// Verificação somente-leitura do acesso administrativo da Achadinhos da BIA.
// Não cria pedidos, não acessa estoque e não utiliza service_role.
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://achadinhosdabia.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://achadinhosdabia.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  const reply = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (!origin || !allowedOrigins.has(origin))
    return reply(403, { error: 'Origem não autorizada.' });

  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) return reply(401, { error: 'Login necessário.' });
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return reply(503, { error: 'Autenticação indisponível.' });

  try {
    const client = createClient(url, anon, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: 'Sessão inválida.' });
    const { data: membership, error: memberError } = await client
      .from('admins').select('user_id').eq('user_id', auth.user.id).maybeSingle();
    if (memberError) return reply(503, { error: 'Não foi possível verificar o acesso.' });
    if (!membership) return reply(403, { admin: false, message: 'Usuário sem permissão administrativa.' });
    return reply(200, { admin: true, message: 'Administrador autenticado com sucesso.' });
  } catch {
    return reply(503, { error: 'Falha ao verificar o acesso.' });
  }
});
