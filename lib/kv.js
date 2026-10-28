// Tiny Upstash REST client: one pipeline call, results returned in order.
// Returns null when KV is not configured, so callers can fail closed on purpose.
export function makeKv({ url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN, fetchImpl = fetch } = {}) {
  if (!url || !token) return null;
  return {
    async run(commands) {
      const r = await fetchImpl(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(2500)
      });
      if (!r.ok) throw new Error(`kv ${r.status}`);
      const out = await r.json();
      return out.map(x => {
        if (x.error) throw new Error('kv command failed');
        return x.result;
      });
    }
  };
}
