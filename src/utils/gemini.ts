// Gemini API Client Utility for Aura Games
// Model: gemini-2.5-flash

interface Clue {
  player: string;
  clue: string;
}

interface ChatMessage {
  player: string;
  text: string;
}

// Exported so WhoIsTheSpy.tsx can pass it through
export interface HumanNames {
  user: string;    // e.g. "Abuturab"
  partner: string; // Always "Rifat" in game context — bots must NOT use nicknames
}

// Sentinel returned when the API is rate-limited (429).
// Callers check for this and show a user-visible error instead of silently failing.
export const RATE_LIMIT_MARKER = "__RATE_LIMIT__";

// ─── Humor profile builder ────────────────────────────────────────────────────
// Injected into every chat banter call so bots know WHO they're talking to.
function buildHumorProfile(names: HumanNames): string {
  return `Who you are playing with:
- ${names.user}: Witty, uses casual Hinglish ("yrrr", "aree yaar", "chal na"), playful with his wife.
- ${names.partner} (his wife): Playful, direct, sometimes sarcastically funny. ALWAYS call her "${names.partner}" — NEVER use any nickname or shortened form of her name. Only her husband is allowed to use his private nickname for her.
Both of them talk the way young Indian couples text on WhatsApp — fun, quick, real. Match their energy when they talk to you.`;
}

// Local API calls tracker for quota monitoring
export interface GeminiStats {
  rpm: number;       // calls in last 60 seconds
  rpd: number;       // calls in last 24 hours
  maxRpm: number;    // constant 15
  maxRpd: number;    // constant 1500
}

export function getGeminiStats(): GeminiStats {
  try {
    const stored = localStorage.getItem('aura_gemini_calls');
    const timestamps: number[] = stored ? JSON.parse(stored) : [];
    const now = Date.now();
    
    // filter 24h
    const daily = timestamps.filter(t => now - t < 24 * 60 * 60 * 1000);
    // filter 60s
    const minutely = daily.filter(t => now - t < 60 * 1000);
    
    return {
      rpm: minutely.length,
      rpd: daily.length,
      maxRpm: 15,
      maxRpd: 1500
    };
  } catch (e) {
    return { rpm: 0, rpd: 0, maxRpm: 15, maxRpd: 1500 };
  }
}

function recordGeminiCall() {
  try {
    const stored = localStorage.getItem('aura_gemini_calls');
    const timestamps: number[] = stored ? JSON.parse(stored) : [];
    const now = Date.now();
    
    // Clean up older than 24h to keep localStorage small
    const cleaned = timestamps.filter(t => now - t < 24 * 60 * 60 * 1000);
    cleaned.push(now);
    
    localStorage.setItem('aura_gemini_calls', JSON.stringify(cleaned));
    
    // Dispatch a custom event so UI components can listen and re-render live stats
    window.dispatchEvent(new CustomEvent('aura-gemini-stats-updated', {
      detail: { rpm: cleaned.filter(t => now - t < 60 * 1000).length, rpd: cleaned.length }
    }));
  } catch (e) {
    console.error('[Gemini Games] Failed to record call:', e);
  }
}

function getApiKeys(): string[] {
  const keysStr = import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GEMINI_API_KEY;
  if (keysStr) {
    return keysStr.split(',').map((k: string) => k.trim()).filter(Boolean);
  }
  return [];
}

let currentKeyIndex = 0;

// ─── Core API caller ──────────────────────────────────────────────────────────
export async function callGemini(
  prompt: string,
  systemInstruction: string,
  jsonMode: boolean = false,
  retryCount: number = 0
): Promise<string> {
  recordGeminiCall();
  const keys = getApiKeys();
  if (keys.length === 0) {
    console.warn("[Gemini Games] No Gemini API Key defined in environment.");
    if (jsonMode) {
      return JSON.stringify({ vote: "Abuturab", reason: "API key set nahi hai!" });
    }
    return "No Key Set";
  }

  // Bound index safely
  if (currentKeyIndex >= keys.length) {
    currentKeyIndex = 0;
  }

  const activeKey = keys[currentKeyIndex];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${activeKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.95,
          maxOutputTokens: jsonMode ? 150 : 300,
          responseMimeType: jsonMode ? "application/json" : "text/plain",
        },
      }),
    });

    // ── Rate limit: rotate key and retry ──
    if (response.status === 429) {
      const errText = await response.text();
      console.warn(`[Gemini Games] Key index ${currentKeyIndex} rate-limited (429). Details:`, errText);

      if (retryCount < keys.length - 1) {
        currentKeyIndex = (currentKeyIndex + 1) % keys.length;
        console.log(`[Gemini Games] Rotating to key index ${currentKeyIndex} and retrying request...`);
        return callGemini(prompt, systemInstruction, jsonMode, retryCount + 1);
      }

      console.error("[Gemini Games] All registered API keys have been exhausted!");
      if (jsonMode) {
        return JSON.stringify({ vote: "Abuturab", reason: "Thodi der mein dobara vote karunga!" });
      }
      return RATE_LIMIT_MARKER;
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[Gemini Games] HTTP Error:", response.status, errBody);
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text.trim();
  } catch (err) {
    console.error(`[Gemini Games] Fetch Error on key index ${currentKeyIndex}:`, err);
    
    // Rotate and retry on network/fetch errors too
    if (retryCount < keys.length - 1) {
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;
      console.log(`[Gemini Games] Fetch error, rotating to key index ${currentKeyIndex} and retrying...`);
      return callGemini(prompt, systemInstruction, jsonMode, retryCount + 1);
    }

    if (jsonMode) {
      return JSON.stringify({ vote: "Abuturab", reason: "Connection error ho gaya!" });
    }
    return "Yaar, connection thoda slow hai abhi!";
  }
}

// ─── Clue generation ──────────────────────────────────────────────────────────
/**
 * Generates a subtle 1-3 word Hinglish clue for a bot player.
 */
export async function generateAICheckClue(
  playerName: string,
  word: string | null,
  previousClues: Clue[],
  isSpy: boolean,
  isMrWhite: boolean
): Promise<string> {
  const systemInstruction = `You are ${playerName}, a regular young Indian person playing 'Who is the Spy' (Undercover) with close friends.
You speak in natural, casual Hinglish. Your response is ONLY the clue text itself — 1 to 3 words maximum.
Do NOT write sentences, explanations, quotes, or any other text. Just the raw clue words.
Examples of good clue format: "tapri wali", "kulhad", "bisleri ki dushman", "train se better", "ghar ka scene"`;

  const prevCluesText =
    previousClues.length > 0
      ? `Clues given so far:\n${previousClues.map((c) => `${c.player}: "${c.clue}"`).join("\n")}`
      : "No clues given yet. You go first.";

  let prompt = "";
  if (isMrWhite) {
    prompt = `You are MR. WHITE — you have NO secret word. You got a blank card.
${prevCluesText}

Study these clues and figure out what the common word might be. Then write a 1-3 word clue that fits the vibe so you blend in.
Do NOT explain. Output ONLY the 1-3 word clue.`;
  } else if (isSpy) {
    prompt = `You are the SPY. Your word is "${word}" (slightly different from civilians' word).
${prevCluesText}

Write a 1-3 word clue describing "${word}" that is subtle enough civilians won't instantly spot you're different, but vague enough to not obviously reveal your word.
Be clever. Avoid obvious hints. Output ONLY the 1-3 word clue.`;
  } else {
    prompt = `You are a CIVILIAN. Your secret word is "${word}".
${prevCluesText}

Write a 1-3 word Hinglish clue for "${word}". Make it SUBTLE — not obvious, not a direct translation or synonym.
Think of indirect associations (vibes, cultural references, experiences).
Bad examples (too obvious): if word is 'Chai', don't say 'tea', 'drink', 'cup', 'hot'.
Good examples: 'tapri wali', 'sardi ka yaar', 'kulhad mein'.
Output ONLY the 1-3 word clue.`;
  }

  const response = await callGemini(prompt, systemInstruction, false);
  if (response === RATE_LIMIT_MARKER) return "Vibe check";
  return response
    .split("\n")[0]
    .replace(/['""`]/g, "")
    .replace(/^(clue:|my clue:|answer:)/i, "")
    .trim()
    .slice(0, 40);
}

// ─── Discussion banter ────────────────────────────────────────────────────────
/**
 * Generates a natural Hinglish chat message for the discussion phase.
 *
 * @param humanNames - The real player names so bots address them correctly.
 *   `partner` should always be "Rifat" — bots must NOT use the husband's private
 *   nickname for her ("Riffuu").
 * @param triggerType - WHY this message is being generated (changes the instruction).
 */
export async function generateAIChatBanter(
  playerName: string,
  word: string | null,
  role: "Civilian" | "Spy" | "Mr. White",
  clues: Clue[],
  chatHistory: ChatMessage[],
  triggerType: "respond_to_human" | "respond_to_bot" | "spontaneous" | "game_start" = "respond_to_human",
  humanNames: HumanNames = { user: "Abuturab", partner: "Rifat" }
): Promise<string> {
  // Increased window from 6 → 10 for better continuity
  const lastFewMessages = chatHistory.slice(-10);
  const cluesList = clues.map((c) => `${c.player}: "${c.clue}"`).join("\n");
  const chatList = lastFewMessages.map((m) => `${m.player}: ${m.text}`).join("\n");
  const myClue = clues.find((c) => c.player === playerName);

  // Role context
  let roleContext = "";
  if (role === "Mr. White") {
    roleContext = `You are Mr. White — you have NO secret word and must blend in.`;
  } else if (role === "Spy") {
    roleContext = `You are the SPY with word "${word}". Act like a civilian. Deflect suspicion.`;
  } else {
    roleContext = `You are a CIVILIAN with word "${word}". Help find the Spy.`;
  }

  // Trigger instruction — specific directive for what to say
  const lastMsg = lastFewMessages[lastFewMessages.length - 1];
  const lastText = lastMsg?.text || "";
  const lastSpeaker = lastMsg?.player || "";
  let triggerInstruction = "";

  if (triggerType === "game_start") {
    const suspiciousClue = clues.find((c) => c.player !== playerName);
    triggerInstruction = `All clues just came in. You are reacting for the first time.
Pick ONE specific clue from the list that seems off to you, mention that player by name, and say WHY it seems odd.
Example: "Yaar, ${suspiciousClue?.player || "woh"} ka clue toh bilkul alag lag raha hai, kuch toh hai."`;
  } else if (triggerType === "spontaneous") {
    triggerInstruction = `Conversation has gone quiet. Bring up ONE game-related point — accuse someone based on their clue, defend your own clue, or ask someone directly why they gave that clue. Talk about the GAME only.`;
  } else if (triggerType === "respond_to_bot") {
    triggerInstruction = `${lastSpeaker} just said: "${lastText}"
If you AGREE with their suspicion: agree and add your OWN separate reason from a different angle.
If you DISAGREE: challenge them and explain why.
If it was funny: react briefly.
Do NOT just echo what they said. Add something genuinely new.`;
  } else {
    triggerInstruction = `${lastSpeaker} said: "${lastText}"
Respond DIRECTLY to what they said. Answer their question if they asked one. Defend yourself if accused. React to their accusation if they accused someone else. Stay on topic.`;
  }

  const humorProfile = buildHumorProfile(humanNames);

  const systemInstruction = `You are ${playerName}, a young Indian person playing "Who is the Spy" with ${humanNames.user} and ${humanNames.partner}.
You speak in natural Hinglish the way Indians text on WhatsApp — casual, real, direct.

${humorProfile}

STRICT RULES:
1. Write exactly 1 sentence. Write 2 ONLY if the situation genuinely demands it. Every sentence MUST be grammatically COMPLETE — NEVER stop mid-sentence.
2. NEVER use abbreviations or short forms. Full words only: write "suspicious" not "susp", "actually" not "actly", "something" not "smthn".
3. Do NOT just agree — add your own unique take or observation.
4. Stay relevant. If the conversation has nothing to do with you or the game, stay quiet.
5. Sound like a real human texting, NOT an AI writing an essay. No "Hello!", no bullet points, no formal tone.
6. NEVER call ${humanNames.partner} by any nickname. ONLY use "${humanNames.partner}".
7. Return ONLY the message text. No name prefix, no surrounding quotes.`;

  const prompt = `Game situation:
${roleContext}

Clues given:
${cluesList || "(no clues yet)"}

${myClue ? `Your own clue: "${myClue.clue}"` : "You have not given a clue yet."}

Recent chat (last 10 messages):
${chatList || "(no messages yet)"}

What to do now:
${triggerInstruction}

Write as ${playerName}. Be complete. Be brief. Be natural:`;

  const response = await callGemini(prompt, systemInstruction, false);

  // Bubble up rate limit so the component can show UI
  if (response === RATE_LIMIT_MARKER) return RATE_LIMIT_MARKER;

  return response
    .replace(/^(karan|neha|abuturab|riffuu|rifat):\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

// ─── Vote generation ──────────────────────────────────────────────────────────
/**
 * Decides who the bot votes for and provides a humorous Hinglish reason.
 */
export async function generateAIVote(
  playerName: string,
  word: string | null,
  role: "Civilian" | "Spy" | "Mr. White",
  clues: Clue[],
  chatHistory: ChatMessage[],
  alivePlayers: string[]
): Promise<{ vote: string; reason: string }> {
  const validTargets = alivePlayers.filter((p) => p !== playerName);
  const cluesList = clues.map((c) => `${c.player}: "${c.clue}"`).join("\n");
  const chatList = chatHistory
    .slice(-6)
    .map((m) => `${m.player}: ${m.text}`)
    .join("\n");

  const systemInstruction = `You are ${playerName} deciding who to vote out in "Who is the Spy".
You must return a JSON object ONLY. Format:
{"vote": "<player name>", "reason": "<short Hinglish reason>"}
The "vote" value MUST be exactly one of: ${validTargets.join(", ")}.
The "reason" should be funny, suspicious, and in Hinglish (1 short complete sentence, max 20 words).
Do NOT include any text outside the JSON object.`;

  const prompt = `Your name: ${playerName}
Your role: ${role}
${word ? `Your word: "${word}"` : "You have no word (Mr. White)"}

All clues:
${cluesList || "(no clues)"}

Recent chat:
${chatList || "(no chat)"}

Valid vote targets (choose EXACTLY one): ${validTargets.join(", ")}

Based on all evidence, who is most suspicious? Vote them out.
Return JSON only: {"vote": "...", "reason": "..."}`;

  const responseText = await callGemini(prompt, systemInstruction, true);
  try {
    const data = JSON.parse(responseText);
    if (validTargets.includes(data.vote)) {
      return { vote: data.vote, reason: data.reason || "Sus lag raha tha!" };
    }
    const fallback = validTargets[Math.floor(Math.random() * validTargets.length)];
    return { vote: fallback, reason: data.reason || "Mujhe ye sabse sus laga!" };
  } catch {
    const fallback = validTargets[Math.floor(Math.random() * validTargets.length)];
    return { vote: fallback, reason: "Kuch toh gadbad hai daya!" };
  }
}
