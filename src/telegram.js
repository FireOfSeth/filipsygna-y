const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toPlain = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export class Telegram {
  constructor(token) {
    this.token = /^\d+:[\w-]{20,}$/.test(token || '') ? token : '';
    this.offset = 0;
  }

  get enabled() {
    return Boolean(this.token);
  }

  async call(method, body, timeoutMs = 20_000) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  /** Wysyła wiadomość HTML. Bez tokenu lub czatu – wypisuje w konsoli. */
  async send(chatId, html) {
    if (!this.enabled || !chatId) {
      console.log(`\n${toPlain(html)}\n`);
      return;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        await this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        return;
      } catch (err) {
        if (attempt >= 3) {
          console.error(`Nie wysłano wiadomości: ${err.message}\n${toPlain(html)}`);
          return;
        }
        await sleep(3000 * attempt);
      }
    }
  }

  /** Jednorazowo odbiera zaległe komendy (tryb --once). Zwraca offset do zapamiętania. */
  async drainUpdates(onMessage, startOffset = 0) {
    if (!this.enabled) return startOffset;
    this.offset = startOffset;
    try {
      for (let round = 0; round < 5; round++) {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 0, limit: 100, allowed_updates: ['message'] });
        if (!updates.length) break;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          if (u.message?.text) await onMessage(u.message);
        }
      }
    } catch (err) {
      console.error(`Telegram: ${err.message}`);
    }
    return this.offset;
  }

  async poll(onMessage) {
    if (!this.enabled) return;
    for (;;) {
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 30, allowed_updates: ['message'] }, 45_000);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          if (u.message?.text) await onMessage(u.message);
        }
      } catch (err) {
        console.error(`Telegram: ${err.message}`);
        await sleep(5000);
      }
    }
  }
}
