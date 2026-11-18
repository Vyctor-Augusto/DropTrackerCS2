/**
 * Cliente das partes públicas da Steam (sem login, sem API key).
 *
 * - Resolve link de perfil / vanity / SteamID64 -> SteamID64 + nome + avatar.
 * - Lê o inventário público de CS2 (appid 730) e devolve a lista de assetid.
 *
 * Nada aqui autentica na conta: só lê o que já é público.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CS2_APP_ID = 730;
const CS2_CONTEXT_ID = 2;

/** Nomes de raridade em português, pelo id interno da Steam. */
const RARITY_PT = {
  Rarity_Common_Weapon: 'Grau Consumidor',
  Rarity_Uncommon_Weapon: 'Grau Industrial',
  Rarity_Rare_Weapon: 'Grau Militar',
  Rarity_Mythical_Weapon: 'Restrito',
  Rarity_Legendary_Weapon: 'Classificado',
  Rarity_Ancient_Weapon: 'Encoberto',
  Rarity_Contraband: 'Contrabando',
  Rarity_Common: 'Grau Comum',
  Rarity_Uncommon: 'Grau Superior',
  Rarity_Rare: 'Notável',
  Rarity_Mythical: 'Exótico',
  Rarity_Legendary: 'Extraordinário',
};

function rarityOf(desc) {
  const tags = Array.isArray(desc.tags) ? desc.tags : [];
  const tag = tags.find((t) => t && t.category === 'Rarity');
  if (!tag) return { rarity: '', color: '' };
  const label =
    RARITY_PT[tag.internal_name] ||
    tag.localized_tag_name ||
    String(tag.internal_name || '').replace(/^Rarity_/, '');
  return { rarity: label, color: String(tag.color || '').replace(/^#/, '') };
}

export class SteamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SteamError';
    this.code = code;
  }
}

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function request(url, accept = 'text/html') {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
  } catch (err) {
    throw new SteamError('network', `Não consegui falar com a Steam (${err.message}).`);
  }

  if (res.status === 429) {
    throw new SteamError('ratelimit', 'A Steam limitou as requisições. Tente de novo em alguns minutos.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new SteamError('private', 'A Steam negou o acesso (inventário privado ou perfil restrito).');
  }
  if (res.status === 404) {
    throw new SteamError('notfound', 'Perfil não encontrado na Steam.');
  }
  if (!res.ok) {
    throw new SteamError('http', `A Steam respondeu com status ${res.status}.`);
  }
  return res;
}

/** Extrai SteamID64 / vanity de um link colado pelo usuário. */
export function parseProfileInput(raw) {
  const input = String(raw || '').trim();
  if (!input) throw new SteamError('invalid', 'Informe o link do perfil ou o SteamID64.');

  const idMatch = input.match(/(7656119\d{10})/);
  if (idMatch) return { steamId: idMatch[1] };

  if (/^\[U:1:\d+\]$/i.test(input)) {
    throw new SteamError('invalid', 'Formato [U:1:...] não suportado. Cole o link do perfil.');
  }

  const vanityMatch = input.match(/\/id\/([A-Za-z0-9_.-]+)/);
  if (vanityMatch) return { vanity: vanityMatch[1] };

  if (/^https?:\/\//i.test(input)) {
    throw new SteamError('invalid', 'Link não reconhecido. Use steamcommunity.com/id/SEU_NOME ou /profiles/7656...');
  }

  if (/^[A-Za-z0-9_.-]{2,32}$/.test(input)) return { vanity: input };

  throw new SteamError('invalid', 'Não consegui identificar o perfil nesse texto.');
}

async function fetchProfileXml(url) {
  const res = await request(url);
  const xml = await res.text();
  const steamId = xml.match(/<steamID64>(\d+)<\/steamID64>/)?.[1];
  if (!steamId) {
    throw new SteamError('notfound', 'Perfil não encontrado (o link está correto?).');
  }
  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
    return m ? decodeXml(m[1]).trim() : '';
  };
  return {
    steamId,
    name: pick('steamID'),
    avatar: pick('avatarMedium') || pick('avatar'),
    visibility: /<privacyState>([^<]+)<\/privacyState>/.exec(xml)?.[1] || 'unknown',
  };
}

/** Aceita link/vanity/SteamID64 e devolve { steamId, name, avatar }. */
export async function resolveProfile(raw) {
  const parsed = parseProfileInput(raw);

  if (parsed.steamId) {
    try {
      const profile = await fetchProfileXml(`https://steamcommunity.com/profiles/${parsed.steamId}/?xml=1`);
      return {
        steamId: profile.steamId,
        name: profile.name || `Conta ${parsed.steamId.slice(-4)}`,
        avatar: profile.avatar,
      };
    } catch (err) {
      // Perfil privado não impede usar o inventário. Segue com o ID puro.
      if (err.code === 'private' || err.code === 'notfound') {
        return { steamId: parsed.steamId, name: `Conta ${parsed.steamId.slice(-4)}`, avatar: '' };
      }
      throw err;
    }
  }

  const profile = await fetchProfileXml(
    `https://steamcommunity.com/id/${encodeURIComponent(parsed.vanity)}/?xml=1`,
  );

  if (profile.visibility === 'private') {
    throw new SteamError('private', 'Esse perfil é privado. Cole o link /profiles/7656... ou o SteamID64.');
  }

  return { steamId: profile.steamId, name: profile.name || parsed.vanity, avatar: profile.avatar };
}

/**
 * Lê o inventário público de CS2 e devolve os itens (assetid + nome + ícone).
 * Pagina de 2000 em 2000 até acabar.
 */
export async function fetchInventory(steamId) {
  const assets = [];
  let startAssetid = null;

  for (let page = 0; page < 40; page += 1) {
    const url = new URL(`https://steamcommunity.com/inventory/${steamId}/${CS2_APP_ID}/${CS2_CONTEXT_ID}`);
    url.searchParams.set('l', 'english');
    url.searchParams.set('count', '2000');
    if (startAssetid) url.searchParams.set('start_assetid', startAssetid);

    const res = await request(url, 'application/json');
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SteamError('parse', 'A Steam devolveu algo que não era JSON (inventário privado?).');
    }

    const failed = data.success === false || data.success === 'false' || data.Error;
    if (failed) {
      const message = String(data.Error || '');
      if (/private|denied|403/i.test(message)) {
        throw new SteamError(
          'private',
          'Inventário privado. Deixe o inventário de CS2 público nas configurações da Steam.',
        );
      }
      throw new SteamError('steam', message || 'A Steam recusou a consulta do inventário.');
    }

    const descriptions = new Map();
    for (const desc of data.descriptions || []) {
      descriptions.set(`${desc.classid}_${desc.instanceid}`, desc);
    }

    for (const asset of data.assets || []) {
      const desc = descriptions.get(`${asset.classid}_${asset.instanceid}`) || {};
      const rarity = rarityOf(desc);
      assets.push({
        assetid: String(asset.assetid),
        name: desc.market_name || desc.name || 'Item',
        icon: desc.icon_url || '',
        // Nome canônico usado pelo Mercado (é a chave para consultar preço).
        hash: desc.market_hash_name || desc.market_name || desc.name || '',
        type: desc.type || '',
        rarity: rarity.rarity,
        color: rarity.color,
      });
    }

    if (data.more_items && data.last_assetid) {
      startAssetid = String(data.last_assetid);
    } else {
      break;
    }
  }

  return assets;
}
