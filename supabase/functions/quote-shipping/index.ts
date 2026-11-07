
import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://achadinhosdabia.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const zip = (value: unknown) =>
  String(value ?? '').replace(/\D/g, '');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CartItem = {
  product_id: string;
  quantity: number;
};

type Product = {
  id: string;
  price: number;
  stock: number;
  origin_zip: string | null;
  weight_kg: number;
  width_cm: number;
  height_cm: number;
  length_cm: number;
};

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

const recent = new Map<string, number[]>();

function parseItems(input: any): CartItem[] {
  const rawItems = Array.isArray(input?.items)
    ? input.items
    : input?.product_id
      ? [{ product_id: input.product_id, quantity: 1 }]
      : [];

  if (rawItems.length < 1 || rawItems.length > 30) {
    throw new Error('INVALID_ITEMS');
  }

  const grouped = new Map<string, number>();

  for (const item of rawItems) {
    const id = String(item?.product_id ?? '');
    const quantity = Number(item?.quantity);

    if (
      !uuidPattern.test(id) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      throw new Error('INVALID_ITEMS');
    }

    const key = id.toLowerCase();
    const total = (grouped.get(key) || 0) + quantity;

    if (total > 100) {
      throw new Error('INVALID_ITEMS');
    }

    grouped.set(key, total);
  }

  const result = Array.from(grouped, ([product_id, quantity]) => ({
    product_id,
    quantity,
  }));

  if (
    result.length > 30 ||
    result.reduce((sum, item) => sum + item.quantity, 0) > 100
  ) {
    throw new Error('INVALID_ITEMS');
  }

  return result;
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('origin') || '';
  // Chamadas internas não enviam Origin. Exigir segredo exclusivo do servidor.
  // Não aceitar segredo para contornar Origin quando um navegador envia Origin inválido.
  const configuredSecret = Deno.env.get('CHECKOUT_INTERNAL_SECRET') || '';
  const providedSecret = req.headers.get('x-checkout-internal-secret') || '';
  const internal = !requestOrigin && configuredSecret.length >= 32 &&
    providedSecret === configuredSecret;
  if (!allowedOrigins.has(requestOrigin) && !internal) {
    return new Response('Origin not allowed', { status: 403 });
  }
  const origin = internal ? 'https://achadinhosdabia.github.io' : requestOrigin;

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  const requester =
    req.headers.get('cf-connecting-ip') || 'unknown';

  const now = Date.now();
  const visits = (recent.get(requester) || [])
    .filter((time) => now - time < 60000);

  if (visits.length >= 10) {
    return json(
      { error: 'Muitas consultas. Aguarde um minuto.' },
      429,
      origin
    );
  }

  visits.push(now);
  recent.set(requester, visits);

  if (recent.size > 5000) recent.clear();

  let input: any;

  try {
    input = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, origin);
  }

  const destination = zip(input?.destination_zip);

  if (!/^\d{8}$/.test(destination)) {
    return json({ error: 'CEP inválido' }, 400, origin);
  }

  let items: CartItem[];

  try {
    items = parseItems(input);
  } catch {
    return json(
      { error: 'Produtos ou quantidades inválidos' },
      400,
      origin
    );
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return json(
      { error: 'Cotação não configurada. Combine com o vendedor.' },
      503,
      origin
    );
  }

  const environment =
    Deno.env.get('ME_ENV') === 'production'
      ? 'production'
      : 'sandbox';

  const base =
    environment === 'production'
      ? 'https://melhorenvio.com.br'
      : 'https://sandbox.melhorenvio.com.br';

  const contact = 'wandarley.pereira@gmail.com';

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const ids = items.map((item) => item.product_id);

    const [productResult, settingsResult, tokenResult] =
      await Promise.all([
        db
          .from('products')
          .select(
            'id,price,stock,origin_zip,weight_kg,width_cm,height_cm,length_cm'
          )
          .in('id', ids)
          .eq('active', true)
          .eq('shipping_enabled', true),

        db
          .from('store_settings')
          .select('origin_zip')
          .eq('id', 1)
          .maybeSingle(),

        db
          .from('melhor_envio_tokens')
          .select('access_token,expires_at')
          .eq('id', 1)
          .eq('environment', environment)
          .maybeSingle(),
      ]);

    if (productResult.error) {
      throw Error(`products: ${productResult.error.message}`);
    }

    if (settingsResult.error) {
      throw Error(`store_settings: ${settingsResult.error.message}`);
    }

    if (tokenResult.error) {
      throw Error(`melhor_envio_tokens: ${tokenResult.error.message}`);
    }

    const products = (productResult.data || []) as Product[];
    const settings = settingsResult.data;
    const stored = tokenResult.data;

    if (!stored?.access_token) {
      return json(
        { error: 'Melhor Envio ainda não conectado.' },
        503,
        origin
      );
    }

    if (
      !stored.expires_at ||
      !Number.isFinite(Date.parse(stored.expires_at)) ||
      Date.parse(stored.expires_at) <= Date.now() + 60000
    ) {
      return json(
        {
          error:
            'Autorização do Melhor Envio expirada. Solicite renovação ao administrador.',
        },
        503,
        origin
      );
    }

    if (products.length !== items.length) {
      return json(
        {
          quotes: [],
          message: 'Um ou mais produtos estão indisponíveis para envio.',
        },
        200,
        origin
      );
    }

    const productMap = new Map(
      products.map((p) => [p.id.toLowerCase(), p])
    );

    const storeOrigin = zip(
      settings?.origin_zip || '18076070'
    );

    const origins = new Set<string>();

    let totalWeight = 0;
    let totalHeight = 0;
    let maxWidth = 0;
    let maxLength = 0;
    let totalValue = 0;
    let totalQuantity = 0;

    for (const item of items) {
      const p = productMap.get(item.product_id.toLowerCase());

      if (!p || Number(p.stock) < item.quantity) {
        return json(
          {
            quotes: [],
            message: 'Quantidade indisponível em estoque.',
          },
          200,
          origin
        );
      }

      const sizes = [
        Number(p.weight_kg),
        Number(p.width_cm),
        Number(p.height_cm),
        Number(p.length_cm),
      ];

      const price = Number(p.price);

      if (
        sizes.some((n) => !Number.isFinite(n) || n <= 0 || n > 200) ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return json(
          {
            quotes: [],
            message: 'Medidas ou preços de envio indisponíveis.',
          },
          200,
          origin
        );
      }

      const originZip = zip(p.origin_zip || storeOrigin);

      if (!/^\d{8}$/.test(originZip)) {
        return json(
          {
            quotes: [],
            message: 'CEP de origem inválido.',
          },
          200,
          origin
        );
      }

      origins.add(originZip);

      totalWeight += sizes[0] * item.quantity;
      totalHeight += sizes[2] * item.quantity;
      maxWidth = Math.max(maxWidth, sizes[1]);
      maxLength = Math.max(maxLength, sizes[3]);
      totalValue += price * item.quantity;
      totalQuantity += item.quantity;
    }

    if (origins.size !== 1) {
      return json(
        {
          quotes: [],
          message:
            'Os produtos possuem CEPs de origem diferentes. Combine a entrega com a loja.',
        },
        200,
        origin
      );
    }

    const round = (value: number, decimals: number) =>
      Number(value.toFixed(decimals));

    const packageData = {
      width: round(maxWidth, 2),
      height: round(totalHeight, 2),
      length: round(maxLength, 2),
      weight: round(totalWeight, 3),
      insurance_value: round(totalValue, 2),
    };

    if (
      !Number.isFinite(totalValue) ||
      !Number.isFinite(totalWeight) ||
      totalValue <= 0 ||
      totalWeight <= 0 ||
      packageData.width > 200 ||
      packageData.height > 200 ||
      packageData.length > 200 ||
      packageData.weight > 200
    ) {
      return json(
        {
          quotes: [],
          message:
            'O volume conjunto excede os limites de cálculo. Combine a entrega com a loja.',
        },
        200,
        origin
      );
    }

    const originZip = Array.from(origins)[0];

    // Uma unidade lógica representa o pacote completo.
    // Evita multiplicar novamente as medidas e o peso.
    const shippingProducts = [
      {
        id: 'carrinho-conjunto',
        ...packageData,
        quantity: 1,
      },
    ];

    const api = await fetch(
      `${base}/api/v2/me/shipment/calculate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stored.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': `Achadinhos da BIA (${contact})`,
        },
        body: JSON.stringify({
          from: { postal_code: originZip },
          to: { postal_code: destination },
          products: shippingProducts,
          options: {
            receipt: false,
            own_hand: false,
          },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!api.ok) {
      console.warn('MELHOR ENVIO: resposta HTTP', api.status);

      return json(
        {
          quotes: [],
          message: 'Não foi possível cotar para este destino.',
        },
        200,
        origin
      );
    }

    const values = await api.json();

    if (Array.isArray(values)) {
      console.info(
        'DIAGNOSTICO TRANSPORTADORAS:',
        JSON.stringify(
          values.map((v) => ({
            id: v.id ?? null,
            transportadora: String(
              v.company?.name ?? 'não informada'
            ).slice(0, 60),
            servico: String(
              v.name ?? 'não informado'
            ).slice(0, 60),
            situacao: v.error ? 'indisponível' : 'retornado',
            motivo: v.error
              ? String(
                  typeof v.error === 'string'
                    ? v.error
                    : JSON.stringify(v.error)
                ).slice(0, 220)
              : null,
          }))
        )
      );
    }

    const quotes = (Array.isArray(values) ? values : [])
      .filter(
        (v) =>
          !v.error &&
          Number(v.custom_price ?? v.price) > 0
      )
      .map((v) => ({
        company: String(
          v.company?.name || 'Transportadora'
        ).slice(0, 60),
        service: String(v.name || 'Serviço').slice(0, 60),
        price: Number(v.custom_price ?? v.price),
        days:
          Number(
            v.custom_delivery_time ?? v.delivery_time
          ) || 0,
      }))
      .filter((q) => q.days > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 8);

    return json(
      {
        quotes,
        package_estimate: {
          ...packageData,
          total_quantity: totalQuantity,
        },
      },
      200,
      origin
    );

  } catch (error) {
    console.error(
      'ERRO NA COTACAO:',
      error instanceof Error ? error.message : String(error)
    );

    return json(
      { error: 'Cotação indisponível no momento' },
      502,
      origin
    );
  }
});