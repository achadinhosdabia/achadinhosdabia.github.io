// Supabase Edge Function: checkout-preview
// Apenas validação de catálogo e disponibilidade. NÃO cria pedido,
// NÃO reserva estoque e NÃO processa pagamento.
// Deploy separado da loja GitHub Pages; não habilitar confirmação ainda.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido' });
  try {
    const body = await request.json();
    const items = body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 30)
      return response(400, { error: 'Informe de 1 a 30 itens.' });
    const quantities = new Map<string, number>();
    for (const item of items) {
      if (typeof item?.product_id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.product_id) ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)
        return response(400, { error: 'Produto ou quantidade inválidos.' });
      const qty = (quantities.get(item.product_id) || 0) + item.quantity;
      if (qty > 1000) return response(400, { error: 'Quantidade excedida.' });
      quantities.set(item.product_id, qty);
    }
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !anonKey) return response(503, { error: 'Serviço indisponível.' });
    // Consulta somente produtos publicamente visíveis conforme RLS.
    // Não usar SERVICE_ROLE_KEY para uma prévia pública.
    const db = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await db.from('products')
      .select('id,name,price,stock,active,shipping_enabled')
      .in('id', [...quantities.keys()]);
    if (error) return response(503, { error: 'Não foi possível consultar o catálogo.' });
    if (!data || data.length !== quantities.size)
      return response(409, { error: 'Algum produto não está disponível.' });
    let subtotalCents = 0;
    const checked = [];
    for (const p of data) {
      const qty = quantities.get(p.id)!;
      const cents = Math.round(Number(p.price) * 100);
      if (!p.active || !Number.isSafeInteger(cents) || cents < 0 ||
          !Number.isSafeInteger(p.stock) || p.stock < qty)
        return response(409, { error: 'Produto indisponível ou estoque insuficiente.' });
      subtotalCents += cents * qty;
      checked.push({ product_id: p.id, name: p.name, quantity: qty,
        unit_price: cents / 100, line_total: cents * qty / 100,
        shipping_enabled: Boolean(p.shipping_enabled) });
    }
    return response(200, {
      mode: 'preview_only',
      can_create_order: false,
      items: checked,
      subtotal: subtotalCents / 100,
      message: 'Produtos e preços conferidos. Pedido e frete ainda não foram validados para cobrança.',
    });
  } catch {
    return response(400, { error: 'Não foi possível interpretar a solicitação.' });
  }
});
