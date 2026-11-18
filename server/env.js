/**
 * Leitura segura de variáveis de ambiente.
 *
 * O app não exige segredos; apenas configurações opcionais (porta, caminhos).
 * Este módulo centraliza o acesso para evitar espalhar process.env pelo código.
 */
export function env(key, fallback = '') {
  const value = process.env[key];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

export function envInt(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env(key, '');
  if (raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}