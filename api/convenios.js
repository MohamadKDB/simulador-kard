// Função serverless (Vercel) — intermedia leitura/escrita do convenios.json no GitHub.
// O token do GitHub e a senha de admin ficam em variáveis de ambiente da Vercel,
// nunca chegam ao navegador.
//
// Env vars necessárias (Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN   — fine-grained PAT com Contents: Read and write no repo
//   ADMIN_PASSWORD — senha compartilhada com quem pode editar

const REPO = 'MohamadKDB/simulador-kard';
const FILE = 'convenios.json';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

function ghHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'simulador-kard-admin'
  };
}

export default async function handler(req, res) {
  if (!process.env.GITHUB_TOKEN || !process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: 'Servidor não configurado: defina GITHUB_TOKEN e ADMIN_PASSWORD nas variáveis de ambiente da Vercel.' });
    return;
  }

  // ---------- GET: leitura sempre fresca (sem cache de deploy) ----------
  if (req.method === 'GET') {
    const r = await fetch(`${API}?ref=${BRANCH}`, { headers: ghHeaders() });
    if (!r.ok) {
      res.status(502).json({ error: `GitHub: erro ${r.status} ao ler o arquivo.` });
      return;
    }
    const j = await r.json();
    const data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data });
    return;
  }

  // ---------- POST: valida senha e salva ----------
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não suportado.' });
    return;
  }

  const { password, check, data, message } = req.body || {};

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    await new Promise(r => setTimeout(r, 800)); // desacelera tentativas de força bruta
    res.status(401).json({ error: 'Senha incorreta.' });
    return;
  }

  // só verificação de senha (botão "Conectar")
  if (check) {
    res.status(200).json({ ok: true });
    return;
  }

  // validação estrutural mínima antes de commitar
  if (!Array.isArray(data) || !data.length) {
    res.status(400).json({ error: 'Dados inválidos: esperado um array de convênios.' });
    return;
  }
  for (const c of data) {
    if (!c.id || !c.nome || !c.uf || !c.vigencia || !Array.isArray(c.ofertas) || !c.ofertas.length) {
      res.status(400).json({ error: `Convênio inválido: ${c.nome || c.id || '?'}` });
      return;
    }
    for (const o of c.ofertas) {
      if (!o.rotulo || !Array.isArray(o.taxas) || !o.taxas.length) {
        res.status(400).json({ error: `Oferta inválida em ${c.nome}.` });
        return;
      }
      for (const t of o.taxas) {
        if (typeof t.taxa !== 'number' || !t.mult || !Object.keys(t.mult).length) {
          res.status(400).json({ error: `Taxa inválida em ${c.nome}.` });
          return;
        }
      }
    }
  }

  // lê o sha atual e commita por cima (last-write-wins)
  const cur = await fetch(`${API}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (!cur.ok) {
    res.status(502).json({ error: `GitHub: erro ${cur.status} ao ler o arquivo atual.` });
    return;
  }
  const sha = (await cur.json()).sha;

  const put = await fetch(API, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message: `admin: ${message || 'atualiza convênios'}`,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
      sha,
      branch: BRANCH
    })
  });
  if (!put.ok) {
    let msg = '';
    try { msg = (await put.json()).message || ''; } catch (e) {}
    res.status(502).json({ error: `GitHub: erro ${put.status} ao salvar. ${msg}` });
    return;
  }

  res.status(200).json({ ok: true });
}
