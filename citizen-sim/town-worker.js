/**
 * citizen-sim 동네 저장 Worker (Cloudflare Workers + KV, 무료 플랜으로 충분)
 *
 * 역할: 호스트 브라우저가 올리는 동네 스냅샷을 KV에 보관하고, 새 호스트가 시작할 때 돌려준다.
 *       시뮬레이션은 여전히 브라우저에서 돌고, 이 Worker는 "정본 저장소"만 맡는다.
 *
 * API
 *   GET  /town?room=TOWN            → 최신 스냅샷 JSON (없으면 404)
 *   PUT  /town?room=TOWN  (body: 스냅샷 JSON) → 저장. 더 오래된 savedAt 이면 거부(409)
 *   POST /town?room=TOWN            → PUT 과 동일 (탭 종료 시 sendBeacon 용)
 *
 * 설정 (Cloudflare 대시보드)
 *   1. Storage & databases → KV → Create namespace: 이름 "citizen-town"
 *   2. Workers & Pages → Create → Worker → 이 파일 내용 붙여 넣고 Deploy
 *   3. Worker → Settings → Bindings → Add → KV namespace: Variable name "TOWN", namespace "citizen-town"
 *   4. (선택) Variables: ALLOW_ORIGIN = https://namhyonwoo.github.io
 *      (선택) TOWN_KEY = 아무 문자열. 설정하면 쓰기 요청에 ?key=… 가 있어야 한다. index.html 의 TOWN_KEY 와 같게 둔다.
 *   5. Worker 주소를 index.html 의 TOWN_ENDPOINT 에 넣는다.
 *
 * 무료 한도: KV 쓰기 하루 1,000회. 페이지는 3분 주기 + 변경 직후(10초에 1회) + 탭 종료 시에만 올린다.
 */
const DEFAULT_ALLOW = ["https://namhyonwoo.github.io", "http://127.0.0.1:8765", "http://localhost:8765"];
const MAX_BYTES = 512 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allow = env.ALLOW_ORIGIN ? env.ALLOW_ORIGIN.split(",").map(s => s.trim()) : DEFAULT_ALLOW;
    const cors = {
      "Access-Control-Allow-Origin": allow.includes(origin) ? origin : allow[0],
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== "/town") return json({ error: "not found" }, 404);
    if (!env.TOWN) return json({ error: "KV binding TOWN not set" }, 500);

    const room = (url.searchParams.get("room") || "TOWN").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24) || "TOWN";
    const key = "town:" + room;

    if (request.method === "GET") {
      const cur = await env.TOWN.get(key);
      return cur ? new Response(cur, { status: 200, headers: cors }) : json({ error: "no snapshot" }, 404);
    }
    if (request.method === "PUT" || request.method === "POST") {
      if (origin && !allow.includes(origin)) return json({ error: "origin not allowed" }, 403);
      if (env.TOWN_KEY && url.searchParams.get("key") !== env.TOWN_KEY) return json({ error: "bad key" }, 403);
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: "too large" }, 413);
      let snap;
      try { snap = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
      if (!snap || snap.v !== 1 || !snap.init || !snap.state || !Number.isFinite(snap.savedAt)) return json({ error: "bad snapshot" }, 400);
      const prev = await env.TOWN.get(key, { type: "json" });
      if (prev && Number.isFinite(prev.savedAt) && prev.savedAt > snap.savedAt) return json({ error: "older than stored", storedAt: prev.savedAt }, 409);
      await env.TOWN.put(key, JSON.stringify({ ...snap, room, receivedAt: Date.now() }));
      return json({ ok: true, savedAt: snap.savedAt });
    }
    return json({ error: "method" }, 405);
  },
};
