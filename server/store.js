/**
 * Persistência simples em JSON, com escrita atômica (tmp + rename).
 * Sem dependências: para poucas contas e algumas semanas de histórico é mais
 * que suficiente e sobrevive a fechar o app no meio de uma gravação.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_SETTINGS = {
  resetWeekday: 2, // terça-feira
  resetHour: 0,
  resetMinute: 0,
  pollMinutes: 180, // de quanto em quanto tempo atualiza sozinho
};

function defaultData() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, accounts: [] };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = defaultData();
    this.timer = null;
    this.chain = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        ...defaultData(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      };
      if (!Array.isArray(this.data.accounts)) this.data.accounts = [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[store] não consegui ler ${this.file}: ${err.message}`);
      }
    }
    return this.data;
  }

  saveNow() {
    const payload = JSON.stringify(this.data, null, 2);
    this.chain = this.chain
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, payload, 'utf8');
        await rename(tmp, this.file);
      })
      .catch((err) => console.error('[store] falha ao salvar:', err.message));
    return this.chain;
  }

  /**
   * Grava imediatamente no disco.
   *
   * Antes havia um atraso de 150 ms para agrupar gravações seguidas, mas isso
   * deixava uma janela em que encerrar o app logo depois de uma alteração
   * perdia essa alteração. Como o arquivo é pequeno, gravar na hora é mais
   * seguro e a diferença é imperceptível.
   */
  save() {
    clearTimeout(this.timer);
    this.timer = null;
    return this.saveNow();
  }

  async flush() {
    clearTimeout(this.timer);
    await this.saveNow();
  }

  get accounts() {
    return this.data.accounts;
  }

  get settings() {
    return this.data.settings;
  }
}
