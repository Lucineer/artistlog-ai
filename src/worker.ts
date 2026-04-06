// artistlog.ai — Cloudflare Worker
import {
  ArtworkPortfolio,
  GalleryCurator,
  StudioJournal,
  ExhibitionTracker,
  CommissionManager,
  type Artwork,
  type Gallery,
  type JournalEntry,
  type Exhibition,
  type Commission,
} from "./art/tracker";

export interface Env {
  DEEPSEEK_API_KEY: string;
}

const portfolio = new ArtworkPortfolio();
const curator = new GalleryCurator();
const journal = new StudioJournal();
const exhibitions = new ExhibitionTracker();
const commissions = new CommissionManager();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function error(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const { message } = (await request.json()) as { message: string };
  if (!message) return error("message is required");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      try {
        const resp = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              {
                role: "system",
                content:
                  "You are a creative assistant for artists. Help with artistic technique, portfolio curation, exhibition planning, and creative process. Be inspiring and knowledgeable about art history, materials, and the business of art.",
              },
              { role: "user", content: message },
            ],
            stream: true,
          }),
        });

        if (!resp.ok || !resp.body) {
          send(JSON.stringify({ error: "DeepSeek API error" }));
          controller.close();
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") {
              send("[DONE]");
              continue;
            }
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) send(JSON.stringify({ content }));
            } catch {
              /* skip malformed chunks */
            }
          }
        }
      } catch (err) {
        send(JSON.stringify({ error: String(err) }));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleArtworks(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as Artwork["status"] | null;
    const tag = url.searchParams.get("tag");
    const q = url.searchParams.get("q");
    if (q) return json(portfolio.search(q));
    return json(portfolio.list(status ? { status } : tag ? { tag } : undefined));
  }

  const body = (await request.json()) as Partial<Artwork>;
  if (!body.title || !body.medium) return error("title and medium are required");
  const artwork = portfolio.add({
    title: body.title,
    medium: body.medium,
    dimensions: body.dimensions || "",
    imageRefs: body.imageRefs || [],
    price: body.price ?? null,
    year: body.year || new Date().getFullYear(),
    status: body.status || "in_progress",
    tags: body.tags || [],
  });
  return json(artwork, 201);
}

async function handleGallery(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.replace("/api/gallery", "").split("/").filter(Boolean);

  if (request.method === "GET") {
    if (pathParts.length === 1) {
      const gallery = curator.get(pathParts[0]);
      if (!gallery) return error("Gallery not found", 404);
      return json(gallery);
    }
    return json(curator.list());
  }

  if (request.method === "POST") {
    const body = (await request.json()) as Partial<Gallery>;
    if (!body.name) return error("name is required");
    const gallery = curator.create({
      name: body.name,
      description: body.description || "",
      artworkIds: body.artworkIds || [],
      curated: body.curated ?? true,
    });
    return json(gallery, 201);
  }

  return error("Method not allowed", 405);
}

async function handleJournal(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mood = url.searchParams.get("mood") as JournalEntry["mood"] | null;
    const artworkId = url.searchParams.get("artworkId");
    return json(journal.list(mood ? { mood } : artworkId ? { artworkId } : undefined));
  }

  const body = (await request.json()) as Partial<JournalEntry>;
  if (!body.title || !body.body) return error("title and body are required");
  const entry = journal.add({
    date: body.date || new Date().toISOString().slice(0, 10),
    title: body.title,
    body: body.body,
    mood: body.mood || "reflective",
    artworkId: body.artworkId || null,
    tags: body.tags || [],
  });
  return json(entry, 201);
}

async function handleExhibitions(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as Exhibition["status"] | null;
    if (status === "upcoming") return json(exhibitions.upcoming());
    if (status === "current") return json(exhibitions.current());
    return json(exhibitions.list(status ? { status } : undefined));
  }

  const body = (await request.json()) as Partial<Exhibition>;
  if (!body.title || !body.venue) return error("title and venue are required");
  const exhibition = exhibitions.add({
    title: body.title,
    venue: body.venue,
    startDate: body.startDate || "",
    endDate: body.endDate || "",
    artworkIds: body.artworkIds || [],
    status: body.status || "upcoming",
    description: body.description || "",
  });
  return json(exhibition, 201);
}

async function handleCommissions(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as Commission["status"] | null;
    return json(commissions.list(status ? { status } : undefined));
  }

  const body = (await request.json()) as Partial<Commission>;
  if (!body.clientName || !body.title) return error("clientName and title are required");
  const commission = commissions.add({
    clientName: body.clientName,
    clientEmail: body.clientEmail || "",
    title: body.title,
    description: body.description || "",
    medium: body.medium || "",
    budget: body.budget || 0,
    deadline: body.deadline || "",
    status: body.status || "inquiry",
    progress: body.progress || 0,
    notes: body.notes || [],
  });
  return json(commission, 201);
}

async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (pathname === '/health') return new Response(JSON.stringify({ status: 'ok', repo: 'artistlog-ai', timestamp: Date.now() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  if (pathname === '/vessel.json') { try { const vj = await import('./vessel.json', { with: { type: 'json' } }); return new Response(JSON.stringify(vj.default || vj), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); } catch { return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } }

  if (pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
  if (pathname.startsWith("/api/artworks")) return handleArtworks(request);
  if (pathname.startsWith("/api/gallery")) return handleGallery(request);
  if (pathname.startsWith("/api/studio/journal")) return handleJournal(request);
  if (pathname.startsWith("/api/exhibitions")) return handleExhibitions(request);
  if (pathname.startsWith("/api/commissions")) return handleCommissions(request);

  // Serve static HTML for root
  if (pathname === "/" || pathname === "/app.html") {
    const html = await env.ASSETS?.fetch(new Request(new URL("/app.html", url.origin)));
    if (html) return html;
    // Fallback: try fetching from KV or return a redirect
    return new Response(getAppHTML(), { headers: { 'Content-Type': 'text/html' } });
  }

  return error("Not found", 404);
}


function getAppHTML(): string {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>artistlog.ai — Portfolio &amp; Creative Process</title>\n<style>\n  :root {\n    --bg: #FAFAFA;\n    --surface: #FFFFFF;\n    --text: #111111;\n    --text-secondary: #555555;\n    --accent: #B8860B;\n    --accent-light: #DAA520;\n    --border: #E0E0E0;\n    --radius: 8px;\n    --shadow: 0 1px 3px rgba(0,0,0,0.08);\n  }\n\n  * { margin: 0; padding: 0; box-sizing: border-box; }\n\n  body {\n    font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', system-ui, sans-serif;\n    background: var(--bg);\n    color: var(--text);\n    line-height: 1.6;\n  }\n\n  /* Header */\n  header {\n    background: var(--surface);\n    border-bottom: 1px solid var(--border);\n    padding: 16px 32px;\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    position: sticky;\n    top: 0;\n    z-index: 100;\n  }\n\n  .logo {\n    font-size: 20px;\n    font-weight: 700;\n    letter-spacing: -0.5px;\n    color: var(--text);\n  }\n  .logo span { color: var(--accent); }\n\n  nav { display: flex; gap: 4px; }\n  nav button {\n    background: none;\n    border: none;\n    padding: 8px 16px;\n    font-size: 14px;\n    color: var(--text-secondary);\n    cursor: pointer;\n    border-radius: var(--radius);\n    transition: all 0.2s;\n    font-weight: 500;\n  }\n  nav button:hover { background: var(--bg); color: var(--text); }\n  nav button.active { background: var(--text); color: var(--surface); }\n\n  /* Main */\n  main { max-width: 1200px; margin: 0 auto; padding: 32px; }\n\n  .view { display: none; }\n  .view.active { display: block; }\n\n  /* Section Headers */\n  .section-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 24px;\n  }\n  .section-header h2 {\n    font-size: 24px;\n    font-weight: 600;\n    letter-spacing: -0.5px;\n  }\n  .section-header h2 span { color: var(--accent); }\n\n  /* Buttons */\n  .btn {\n    padding: 8px 20px;\n    border: none;\n    border-radius: var(--radius);\n    font-size: 14px;\n    font-weight: 500;\n    cursor: pointer;\n    transition: all 0.2s;\n  }\n  .btn-primary { background: var(--accent); color: #fff; }\n  .btn-primary:hover { background: var(--accent-light); }\n  .btn-outline { background: none; border: 1px solid var(--border); color: var(--text); }\n  .btn-outline:hover { border-color: var(--accent); color: var(--accent); }\n\n  /* Portfolio Grid */\n  .portfolio-grid {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\n    gap: 20px;\n  }\n\n  .artwork-card {\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    overflow: hidden;\n    transition: all 0.2s;\n  }\n  .artwork-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-2px); }\n\n  .artwork-image {\n    width: 100%;\n    height: 220px;\n    background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: #bbb;\n    font-size: 14px;\n  }\n\n  .artwork-info { padding: 16px; }\n  .artwork-info h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }\n  .artwork-info p { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }\n  .artwork-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }\n\n  .status-badge {\n    display: inline-block;\n    padding: 2px 10px;\n    border-radius: 12px;\n    font-size: 11px;\n    font-weight: 600;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n  }\n  .status-available { background: #e8f5e9; color: #2e7d32; }\n  .status-sold { background: #fce4ec; color: #c62828; }\n  .status-in_progress { background: #fff3e0; color: #e65100; }\n  .status-archived { background: #f5f5f5; color: #757575; }\n\n  .price { font-size: 16px; font-weight: 600; color: var(--accent); }\n\n  /* Tags */\n  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }\n  .tag {\n    padding: 2px 8px;\n    background: var(--bg);\n    border-radius: 4px;\n    font-size: 11px;\n    color: var(--text-secondary);\n  }\n\n  /* Studio Journal */\n  .journal-entries { display: flex; flex-direction: column; gap: 16px; }\n\n  .journal-entry {\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    padding: 20px;\n    border-left: 3px solid var(--accent);\n  }\n  .journal-entry h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }\n  .journal-entry .date { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }\n  .journal-entry .body { font-size: 14px; line-height: 1.7; color: var(--text-secondary); }\n\n  .mood-badge {\n    display: inline-block;\n    padding: 2px 8px;\n    border-radius: 4px;\n    font-size: 11px;\n    font-weight: 500;\n    margin-right: 8px;\n  }\n  .mood-inspired { background: #fff8e1; color: #f57f17; }\n  .mood-frustrated { background: #fce4ec; color: #c62828; }\n  .mood-reflective { background: #e3f2fd; color: #1565c0; }\n  .mood-excited { background: #e8f5e9; color: #2e7d32; }\n  .mood-calm { background: #f3e5f5; color: #6a1b9a; }\n\n  /* Exhibition Timeline */\n  .timeline { position: relative; padding-left: 32px; }\n  .timeline::before {\n    content: \'\';\n    position: absolute;\n    left: 8px;\n    top: 0;\n    bottom: 0;\n    width: 2px;\n    background: var(--border);\n  }\n\n  .timeline-item {\n    position: relative;\n    margin-bottom: 24px;\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    padding: 20px;\n  }\n  .timeline-item::before {\n    content: \'\';\n    position: absolute;\n    left: -28px;\n    top: 24px;\n    width: 10px;\n    height: 10px;\n    border-radius: 50%;\n    background: var(--accent);\n    border: 2px solid var(--surface);\n  }\n  .timeline-item.current::before { background: #2e7d32; box-shadow: 0 0 0 4px rgba(46,125,50,0.2); }\n  .timeline-item.upcoming::before { background: var(--accent); box-shadow: 0 0 0 4px rgba(184,134,11,0.2); }\n\n  .timeline-item h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }\n  .timeline-item .venue { font-size: 14px; color: var(--accent); margin-bottom: 4px; }\n  .timeline-item .dates { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }\n  .timeline-item .desc { font-size: 14px; color: var(--text-secondary); }\n  .timeline-item .artworks-count { font-size: 12px; color: var(--accent); margin-top: 8px; }\n\n  /* Commission Tracker */\n  .commissions-list { display: flex; flex-direction: column; gap: 12px; }\n\n  .commission-card {\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    padding: 20px;\n  }\n\n  .commission-header {\n    display: flex;\n    justify-content: space-between;\n    align-items: flex-start;\n    margin-bottom: 12px;\n  }\n  .commission-header h3 { font-size: 16px; font-weight: 600; }\n  .commission-header .client { font-size: 13px; color: var(--text-secondary); }\n\n  .commission-details {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));\n    gap: 12px;\n    margin-bottom: 12px;\n  }\n  .commission-detail label {\n    display: block;\n    font-size: 11px;\n    color: var(--text-secondary);\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n    margin-bottom: 2px;\n  }\n  .commission-detail span { font-size: 14px; font-weight: 500; }\n\n  .progress-bar {\n    width: 100%;\n    height: 6px;\n    background: var(--bg);\n    border-radius: 3px;\n    overflow: hidden;\n    margin-top: 8px;\n  }\n  .progress-fill {\n    height: 100%;\n    background: var(--accent);\n    border-radius: 3px;\n    transition: width 0.3s;\n  }\n\n  /* Chat */\n  .chat-container {\n    display: flex;\n    flex-direction: column;\n    height: calc(100vh - 160px);\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    overflow: hidden;\n  }\n\n  .chat-messages {\n    flex: 1;\n    overflow-y: auto;\n    padding: 20px;\n    display: flex;\n    flex-direction: column;\n    gap: 12px;\n  }\n\n  .chat-msg {\n    max-width: 80%;\n    padding: 12px 16px;\n    border-radius: var(--radius);\n    font-size: 14px;\n    line-height: 1.6;\n  }\n  .chat-msg.user {\n    align-self: flex-end;\n    background: var(--text);\n    color: var(--surface);\n    border-bottom-right-radius: 2px;\n  }\n  .chat-msg.assistant {\n    align-self: flex-start;\n    background: var(--bg);\n    color: var(--text);\n    border-bottom-left-radius: 2px;\n  }\n\n  .chat-input {\n    display: flex;\n    gap: 8px;\n    padding: 16px;\n    border-top: 1px solid var(--border);\n  }\n  .chat-input input {\n    flex: 1;\n    padding: 10px 16px;\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    font-size: 14px;\n    background: var(--bg);\n    color: var(--text);\n    outline: none;\n  }\n  .chat-input input:focus { border-color: var(--accent); }\n\n  /* Modal */\n  .modal-overlay {\n    display: none;\n    position: fixed;\n    top: 0; left: 0; right: 0; bottom: 0;\n    background: rgba(0,0,0,0.4);\n    z-index: 200;\n    align-items: center;\n    justify-content: center;\n  }\n  .modal-overlay.active { display: flex; }\n\n  .modal {\n    background: var(--surface);\n    border-radius: 12px;\n    padding: 32px;\n    width: 90%;\n    max-width: 520px;\n    max-height: 90vh;\n    overflow-y: auto;\n  }\n  .modal h2 { font-size: 20px; font-weight: 600; margin-bottom: 20px; }\n  .modal .field { margin-bottom: 16px; }\n  .modal label {\n    display: block;\n    font-size: 12px;\n    font-weight: 600;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n    color: var(--text-secondary);\n    margin-bottom: 4px;\n  }\n  .modal input, .modal textarea, .modal select {\n    width: 100%;\n    padding: 10px 12px;\n    border: 1px solid var(--border);\n    border-radius: var(--radius);\n    font-size: 14px;\n    background: var(--bg);\n    color: var(--text);\n    outline: none;\n    font-family: inherit;\n  }\n  .modal input:focus, .modal textarea:focus { border-color: var(--accent); }\n  .modal textarea { resize: vertical; min-height: 80px; }\n  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }\n\n  /* Empty state */\n  .empty-state {\n    text-align: center;\n    padding: 60px 20px;\n    color: var(--text-secondary);\n  }\n  .empty-state h3 { font-size: 18px; margin-bottom: 8px; color: var(--text); }\n  .empty-state p { font-size: 14px; }\n\n  @media (max-width: 768px) {\n    header { padding: 12px 16px; flex-direction: column; gap: 12px; }\n    main { padding: 16px; }\n    nav { flex-wrap: wrap; justify-content: center; }\n    .portfolio-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }\n  }\n</style>\n</head>\n<body>\n\n<header>\n  <div class="logo">artistlog<span>.ai</span></div>\n  <nav>\n    <button class="active" onclick="showView(\'portfolio\')">Portfolio</button>\n    <button onclick="showView(\'journal\')">Studio Journal</button>\n    <button onclick="showView(\'exhibitions\')">Exhibitions</button>\n    <button onclick="showView(\'commissions\')">Commissions</button>\n    <button onclick="showView(\'chat\')">Creative Chat</button>\n  </nav>\n</header>\n\n<main>\n  <!-- Portfolio View -->\n  <div id="view-portfolio" class="view active">\n    <div class="section-header">\n      <h2>Portfolio <span>.</span></h2>\n      <button class="btn btn-primary" onclick="openModal(\'artwork\')">+ Add Artwork</button>\n    </div>\n    <div id="portfolio-grid" class="portfolio-grid"></div>\n  </div>\n\n  <!-- Studio Journal View -->\n  <div id="view-journal" class="view">\n    <div class="section-header">\n      <h2>Studio Journal <span>.</span></h2>\n      <button class="btn btn-primary" onclick="openModal(\'journal\')">+ New Entry</button>\n    </div>\n    <div id="journal-entries" class="journal-entries"></div>\n  </div>\n\n  <!-- Exhibitions View -->\n  <div id="view-exhibitions" class="view">\n    <div class="section-header">\n      <h2>Exhibitions <span>.</span></h2>\n      <button class="btn btn-primary" onclick="openModal(\'exhibition\')">+ Add Exhibition</button>\n    </div>\n    <div id="exhibition-timeline" class="timeline"></div>\n  </div>\n\n  <!-- Commissions View -->\n  <div id="view-commissions" class="view">\n    <div class="section-header">\n      <h2>Commissions <span>.</span></h2>\n      <button class="btn btn-primary" onclick="openModal(\'commission\')">+ New Commission</button>\n    </div>\n    <div id="commissions-list" class="commissions-list"></div>\n  </div>\n\n  <!-- Chat View -->\n  <div id="view-chat" class="view">\n    <div class="section-header">\n      <h2>Creative Chat <span>.</span></h2>\n    </div>\n    <div class="chat-container">\n      <div id="chat-messages" class="chat-messages">\n        <div class="chat-msg assistant">\n          Welcome to your creative space. I\'m here to help with technique, portfolio curation, exhibition planning, or just talk art. What\'s on your mind?\n        </div>\n      </div>\n      <div class="chat-input">\n        <input type="text" id="chat-input" placeholder="Ask about technique, materials, exhibitions..." onkeydown="if(event.key===\'Enter\')sendChat()">\n        <button class="btn btn-primary" onclick="sendChat()">Send</button>\n      </div>\n    </div>\n  </div>\n</main>\n\n<!-- Modals -->\n<div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">\n  <div class="modal" id="modal-content"></div>\n</div>\n\n<script>\nconst API = \'\';\n\n// --- State ---\nlet artworks = [];\nlet journalEntries = [];\nlet exhibitionList = [];\nlet commissionList = [];\n\n// --- Navigation ---\nfunction showView(name) {\n  document.querySelectorAll(\'.view\').forEach(v => v.classList.remove(\'active\'));\n  document.querySelectorAll(\'nav button\').forEach(b => b.classList.remove(\'active\'));\n  document.getElementById(\'view-\' + name).classList.add(\'active\');\n  event.target.classList.add(\'active\');\n}\n\n// --- API Helpers ---\nasync function api(path, method = \'GET\', body = null) {\n  const opts = { method, headers: { \'Content-Type\': \'application/json\' } };\n  if (body) opts.body = JSON.stringify(body);\n  const res = await fetch(API + path, opts);\n  return res.json();\n}\n\n// --- Renderers ---\nfunction renderPortfolio() {\n  const grid = document.getElementById(\'portfolio-grid\');\n  if (!artworks.length) {\n    grid.innerHTML = \'<div class="empty-state"><h3>No artworks yet</h3><p>Add your first piece to start building your portfolio.</p></div>\';\n    return;\n  }\n  grid.innerHTML = artworks.map(a => `\n    <div class="artwork-card">\n      <div class="artwork-image">${a.imageRefs.length ? \'\' : \'No image\'}</div>\n      <div class="artwork-info">\n        <h3>${esc(a.title)}</h3>\n        <p>${esc(a.medium)}${a.dimensions ? \' — \' + esc(a.dimensions) : \'\'}</p>\n        <div class="artwork-meta">\n          <span class="status-badge status-${a.status}">${a.status}</span>\n          ${a.price ? \'<span class="price">$\' + a.price.toLocaleString() + \'</span>\' : \'\'}\n        </div>\n        ${a.tags.length ? \'<div class="tags">\' + a.tags.map(t => \'<span class="tag">\' + esc(t) + \'</span>\').join(\'\') + \'</div>\' : \'\'}\n      </div>\n    </div>\n  `).join(\'\');\n}\n\nfunction renderJournal() {\n  const el = document.getElementById(\'journal-entries\');\n  if (!journalEntries.length) {\n    el.innerHTML = \'<div class="empty-state"><h3>Journal is empty</h3><p>Document your creative process and reflections.</p></div>\';\n    return;\n  }\n  el.innerHTML = journalEntries.map(e => `\n    <div class="journal-entry">\n      <h3><span class="mood-badge mood-${e.mood}">${e.mood}</span>${esc(e.title)}</h3>\n      <div class="date">${e.date}</div>\n      <div class="body">${esc(e.body)}</div>\n      ${e.tags.length ? \'<div class="tags">\' + e.tags.map(t => \'<span class="tag">\' + esc(t) + \'</span>\').join(\'\') + \'</div>\' : \'\'}\n    </div>\n  `).join(\'\');\n}\n\nfunction renderExhibitions() {\n  const el = document.getElementById(\'exhibition-timeline\');\n  if (!exhibitionList.length) {\n    el.innerHTML = \'<div class="empty-state"><h3>No exhibitions</h3><p>Track your upcoming and past shows here.</p></div>\';\n    return;\n  }\n  el.innerHTML = exhibitionList.map(e => `\n    <div class="timeline-item ${e.status}">\n      <h3>${esc(e.title)}</h3>\n      <div class="venue">${esc(e.venue)}</div>\n      <div class="dates">${e.startDate}${e.endDate ? \' — \' + e.endDate : \'\'}</div>\n      <div class="desc">${esc(e.description)}</div>\n      ${e.artworkIds.length ? \'<div class="artworks-count">\' + e.artworkIds.length + \' artworks</div>\' : \'\'}\n    </div>\n  `).join(\'\');\n}\n\nfunction renderCommissions() {\n  const el = document.getElementById(\'commissions-list\');\n  if (!commissionList.length) {\n    el.innerHTML = \'<div class="empty-state"><h3>No commissions</h3><p>Track client work and commission progress here.</p></div>\';\n    return;\n  }\n  el.innerHTML = commissionList.map(c => `\n    <div class="commission-card">\n      <div class="commission-header">\n        <div>\n          <h3>${esc(c.title)}</h3>\n          <div class="client">${esc(c.clientName)}${c.clientEmail ? \' — \' + esc(c.clientEmail) : \'\'}</div>\n        </div>\n        <span class="status-badge status-${c.status === \'in_progress\' ? \'in_progress\' : c.status === \'completed\' ? \'available\' : \'archived\'}">${c.status}</span>\n      </div>\n      <div class="commission-details">\n        <div class="commission-detail"><label>Medium</label><span>${esc(c.medium || \'—\')}</span></div>\n        <div class="commission-detail"><label>Budget</label><span>${c.budget ? \'$\' + c.budget.toLocaleString() : \'—\'}</span></div>\n        <div class="commission-detail"><label>Deadline</label><span>${c.deadline || \'—\'}</span></div>\n        <div class="commission-detail"><label>Progress</label><span>${c.progress}%</span></div>\n      </div>\n      ${c.description ? \'<p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">\' + esc(c.description) + \'</p>\' : \'\'}\n      <div class="progress-bar"><div class="progress-fill" style="width:${c.progress}%"></div></div>\n    </div>\n  `).join(\'\');\n}\n\n// --- Chat ---\nasync function sendChat() {\n  const input = document.getElementById(\'chat-input\');\n  const msg = input.value.trim();\n  if (!msg) return;\n  input.value = \'\';\n\n  const messages = document.getElementById(\'chat-messages\');\n  messages.innerHTML += `<div class="chat-msg user">${esc(msg)}</div>`;\n  messages.scrollTop = messages.scrollHeight;\n\n  try {\n    const res = await fetch(API + \'/api/chat\', {\n      method: \'POST\',\n      headers: { \'Content-Type\': \'application/json\' },\n      body: JSON.stringify({ message: msg }),\n    });\n\n    const reader = res.body.getReader();\n    const decoder = new TextDecoder();\n    let assistantEl = null;\n\n    while (true) {\n      const { done, value } = await reader.read();\n      if (done) break;\n      const text = decoder.decode(value, { stream: true });\n      const lines = text.split(\'\\n\');\n\n      for (const line of lines) {\n        if (!line.startsWith(\'data: \')) continue;\n        const payload = line.slice(6).trim();\n        if (payload === \'[DONE]\') break;\n        try {\n          const parsed = JSON.parse(payload);\n          if (parsed.content) {\n            if (!assistantEl) {\n              assistantEl = document.createElement(\'div\');\n              assistantEl.className = \'chat-msg assistant\';\n              messages.appendChild(assistantEl);\n            }\n            assistantEl.textContent += parsed.content;\n            messages.scrollTop = messages.scrollHeight;\n          }\n        } catch {}\n      }\n    }\n  } catch (err) {\n    messages.innerHTML += `<div class="chat-msg assistant" style="color:#c62828">Connection error. Make sure the worker is running.</div>`;\n  }\n  messages.scrollTop = messages.scrollHeight;\n}\n\n// --- Modals ---\nfunction openModal(type) {\n  const overlay = document.getElementById(\'modal-overlay\');\n  const content = document.getElementById(\'modal-content\');\n\n  const forms = {\n    artwork: `\n      <h2>Add Artwork</h2>\n      <div class="field"><label>Title</label><input id="m-title" required></div>\n      <div class="field"><label>Medium</label><input id="m-medium" placeholder="Oil on canvas" required></div>\n      <div class="field"><label>Dimensions</label><input id="m-dimensions" placeholder="24 x 36 in"></div>\n      <div class="field"><label>Price ($)</label><input id="m-price" type="number"></div>\n      <div class="field"><label>Year</label><input id="m-year" type="number" value="${new Date().getFullYear()}"></div>\n      <div class="field"><label>Status</label>\n        <select id="m-status">\n          <option value="in_progress">In Progress</option>\n          <option value="available">Available</option>\n          <option value="sold">Sold</option>\n          <option value="archived">Archived</option>\n        </select>\n      </div>\n      <div class="field"><label>Tags (comma separated)</label><input id="m-tags" placeholder="abstract, landscape"></div>\n      <div class="modal-actions">\n        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>\n        <button class="btn btn-primary" onclick="submitArtwork()">Add</button>\n      </div>`,\n    journal: `\n      <h2>New Journal Entry</h2>\n      <div class="field"><label>Title</label><input id="m-title" required></div>\n      <div class="field"><label>Date</label><input id="m-date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>\n      <div class="field"><label>Mood</label>\n        <select id="m-mood">\n          <option value="reflective">Reflective</option>\n          <option value="inspired">Inspired</option>\n          <option value="excited">Excited</option>\n          <option value="frustrated">Frustrated</option>\n          <option value="calm">Calm</option>\n        </select>\n      </div>\n      <div class="field"><label>Thoughts</label><textarea id="m-body" rows="5" required></textarea></div>\n      <div class="field"><label>Tags (comma separated)</label><input id="m-tags" placeholder="process, technique"></div>\n      <div class="modal-actions">\n        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>\n        <button class="btn btn-primary" onclick="submitJournal()">Save</button>\n      </div>`,\n    exhibition: `\n      <h2>Add Exhibition</h2>\n      <div class="field"><label>Title</label><input id="m-title" required></div>\n      <div class="field"><label>Venue</label><input id="m-venue" required></div>\n      <div class="field"><label>Start Date</label><input id="m-start" type="date"></div>\n      <div class="field"><label>End Date</label><input id="m-end" type="date"></div>\n      <div class="field"><label>Status</label>\n        <select id="m-status">\n          <option value="upcoming">Upcoming</option>\n          <option value="current">Current</option>\n          <option value="past">Past</option>\n        </select>\n      </div>\n      <div class="field"><label>Description</label><textarea id="m-desc" rows="3"></textarea></div>\n      <div class="modal-actions">\n        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>\n        <button class="btn btn-primary" onclick="submitExhibition()">Add</button>\n      </div>`,\n    commission: `\n      <h2>New Commission</h2>\n      <div class="field"><label>Client Name</label><input id="m-client" required></div>\n      <div class="field"><label>Client Email</label><input id="m-email" type="email"></div>\n      <div class="field"><label>Title</label><input id="m-title" required></div>\n      <div class="field"><label>Description</label><textarea id="m-desc" rows="3"></textarea></div>\n      <div class="field"><label>Medium</label><input id="m-medium" placeholder="Acrylic on canvas"></div>\n      <div class="field"><label>Budget ($)</label><input id="m-budget" type="number"></div>\n      <div class="field"><label>Deadline</label><input id="m-deadline" type="date"></div>\n      <div class="modal-actions">\n        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>\n        <button class="btn btn-primary" onclick="submitCommission()">Create</button>\n      </div>`,\n  };\n\n  content.innerHTML = forms[type] || \'\';\n  overlay.classList.add(\'active\');\n}\n\nfunction closeModal() {\n  document.getElementById(\'modal-overlay\').classList.remove(\'active\');\n}\n\n// --- Form Submissions ---\nasync function submitArtwork() {\n  const data = {\n    title: document.getElementById(\'m-title\').value,\n    medium: document.getElementById(\'m-medium\').value,\n    dimensions: document.getElementById(\'m-dimensions\').value,\n    price: document.getElementById(\'m-price\').value ? Number(document.getElementById(\'m-price\').value) : null,\n    year: Number(document.getElementById(\'m-year\').value),\n    status: document.getElementById(\'m-status\').value,\n    tags: document.getElementById(\'m-tags\').value.split(\',\').map(s => s.trim()).filter(Boolean),\n    imageRefs: [],\n  };\n  if (!data.title || !data.medium) return;\n  const result = await api(\'/api/artworks\', \'POST\', data);\n  if (!result.error) { artworks.unshift(result); renderPortfolio(); }\n  closeModal();\n}\n\nasync function submitJournal() {\n  const data = {\n    title: document.getElementById(\'m-title\').value,\n    date: document.getElementById(\'m-date\').value,\n    mood: document.getElementById(\'m-mood\').value,\n    body: document.getElementById(\'m-body\').value,\n    tags: document.getElementById(\'m-tags\').value.split(\',\').map(s => s.trim()).filter(Boolean),\n    artworkId: null,\n  };\n  if (!data.title || !data.body) return;\n  const result = await api(\'/api/studio/journal\', \'POST\', data);\n  if (!result.error) { journalEntries.unshift(result); renderJournal(); }\n  closeModal();\n}\n\nasync function submitExhibition() {\n  const data = {\n    title: document.getElementById(\'m-title\').value,\n    venue: document.getElementById(\'m-venue\').value,\n    startDate: document.getElementById(\'m-start\').value,\n    endDate: document.getElementById(\'m-end\').value,\n    status: document.getElementById(\'m-status\').value,\n    description: document.getElementById(\'m-desc\').value,\n    artworkIds: [],\n  };\n  if (!data.title || !data.venue) return;\n  const result = await api(\'/api/exhibitions\', \'POST\', data);\n  if (!result.error) { exhibitionList.unshift(result); renderExhibitions(); }\n  closeModal();\n}\n\nasync function submitCommission() {\n  const data = {\n    clientName: document.getElementById(\'m-client\').value,\n    clientEmail: document.getElementById(\'m-email\').value,\n    title: document.getElementById(\'m-title\').value,\n    description: document.getElementById(\'m-desc\').value,\n    medium: document.getElementById(\'m-medium\').value,\n    budget: document.getElementById(\'m-budget\').value ? Number(document.getElementById(\'m-budget\').value) : 0,\n    deadline: document.getElementById(\'m-deadline\').value,\n    status: \'inquiry\',\n    progress: 0,\n    notes: [],\n  };\n  if (!data.clientName || !data.title) return;\n  const result = await api(\'/api/commissions\', \'POST\', data);\n  if (!result.error) { commissionList.unshift(result); renderCommissions(); }\n  closeModal();\n}\n\n// --- Utility ---\nfunction esc(s) {\n  if (!s) return \'\';\n  const d = document.createElement(\'div\');\n  d.textContent = s;\n  return d.innerHTML;\n}\n\n// --- Init ---\nasync function init() {\n  const [a, j, e, c] = await Promise.all([\n    api(\'/api/artworks\'),\n    api(\'/api/studio/journal\'),\n    api(\'/api/exhibitions\'),\n    api(\'/api/commissions\'),\n  ]);\n  artworks = Array.isArray(a) ? a : [];\n  journalEntries = Array.isArray(j) ? j : [];\n  exhibitionList = Array.isArray(e) ? e : [];\n  commissionList = Array.isArray(c) ? c : [];\n  renderPortfolio();\n  renderJournal();\n  renderExhibitions();\n  renderCommissions();\n}\n\ninit();\n</script>\n</body>\n</html>\n';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return router(request, env);
  },
};
