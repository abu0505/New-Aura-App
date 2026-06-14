import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { usePartner } from '../../hooks/usePartner';
import { generateAICheckClue, generateAIChatBanter, generateAIVote, callGemini, RATE_LIMIT_MARKER, type HumanNames, getGeminiStats, type GeminiStats } from '../../utils/gemini';

type GameState = 'LOBBY' | 'ROLE_REVEAL' | 'CLUE_ROUND' | 'DISCUSSION_ROUND' | 'VOTING_ROUND' | 'ELIMINATION' | 'GAME_OVER';

interface GamePlayer {
  id: string;
  name: string;
  role: 'Civilian' | 'Spy' | 'Mr. White';
  word: string | null;
  clue: string | null;
  isBot: boolean;
  isAlive: boolean;
  hasVoted: boolean;
  votesReceived: number;
  revealClicked: boolean;
}

interface Clue {
  player: string;
  clue: string;
}

interface ChatMessage {
  player: string;
  text: string;
}

// Module-level pure function — safe to use inside useCallback with empty deps
const isMessageGameRelated = (text: string): boolean => {
  const gameKeywords = [
    'clue', 'word', 'spy', 'sus', 'suspicious', 'vote', 'imposter', 'civilian',
    'hint', 'karan', 'neha', 'abuturab', 'rifat', 'guess', 'sabka', 'pakda',
    'kaun', 'who', 'kyun', 'alag', 'different', 'same', 'match', 'nahi mila',
  ];
  return gameKeywords.some(kw => text.toLowerCase().includes(kw));
};

const WORD_PAIRS = [
  { civilian: "Chai", spy: "Coffee" },
  { civilian: "Samosa", spy: "Kachori" },
  { civilian: "Pani Puri", spy: "Sev Puri" },
  { civilian: "Biryani", spy: "Pulao" },
  { civilian: "Maggi", spy: "Pasta" },
  { civilian: "Auto", spy: "Taxi" },
  { civilian: "Salman Khan", spy: "Shah Rukh Khan" },
  { civilian: "Cricket", spy: "Football" },
  { civilian: "Mumbai", spy: "Delhi" },
  { civilian: "Roti", spy: "Paratha" },
  { civilian: "WhatsApp", spy: "Instagram" },
  { civilian: "YouTube", spy: "Netflix" },
  { civilian: "iPhone", spy: "Android" },
  { civilian: "Local Train", spy: "Metro" },
  { civilian: "Haldi", spy: "Mehendi" },
  { civilian: "Ghee", spy: "Butter" },
  { civilian: "Paneer", spy: "Tofu" },
  { civilian: "Jalebi", spy: "Imarti" },
  { civilian: "Dhoni", spy: "Virat Kohli" },
  { civilian: "Shadi", spy: "Engagement" }
];

interface WhoIsTheSpyProps {
  onBack: () => void;
}

export default function WhoIsTheSpy({ onBack }: WhoIsTheSpyProps) {
  const { user } = useAuth();
  const { partner } = usePartner();

  const human1Name = user?.user_metadata?.display_name || "Abuturab";
  const human2Name = partner?.display_name || "Rifat";
  // Bots must call her "Rifat" — only Abu uses his private nickname for her
  const PARTNER_GAME_NAME = "Rifat";

  // Game States
  const [gameState, setGameState] = useState<GameState>('LOBBY');
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [civilianWord, setCivilianWord] = useState('');
  const [clues, setClues] = useState<Clue[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [turnOrder, setTurnOrder] = useState<string[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  
  // Live API Quota stats state
  const [geminiStats, setGeminiStats] = useState<GeminiStats>(getGeminiStats());

  useEffect(() => {
    const handleUpdate = () => setGeminiStats(getGeminiStats());
    window.addEventListener('aura-gemini-stats-updated', handleUpdate);
    const interval = setInterval(handleUpdate, 5000); // refresh every 5s for RPM countdown
    return () => {
      window.removeEventListener('aura-gemini-stats-updated', handleUpdate);
      clearInterval(interval);
    };
  }, []);
  
  // Game Play states
  const [revealUserSecret, setRevealUserSecret] = useState<GamePlayer | null>(null);
  const [clueInput, setClueInput] = useState('');
  const [chatSender, setChatSender] = useState<'human1' | 'human2'>('human1');
  const [humanChatText, setHumanChatText] = useState('');
  const [votes, setVotes] = useState<Record<string, string>>({}); // voterId -> targetName
  const [eliminatedPlayer, setEliminatedPlayer] = useState<GamePlayer | null>(null);
  const [mrWhiteGuess, setMrWhiteGuess] = useState<string | null>(null);
  const [mrWhiteGuessInput, setMrWhiteGuessInput] = useState('');
  const [winner, setWinner] = useState<'Civilians' | 'Spy' | 'Mr. White' | null>(null);

  // AI loading indicators
  const [isBotThinking, setIsBotThinking] = useState<string | null>(null);
  const [isVotingInProgress, setIsVotingInProgress] = useState(false);
  // Shows a dismissable toast when the API is rate-limited
  const [apiError, setApiError] = useState<string | null>(null);

  // Prevents parallel bot chains from stacking on each other
  const isBotChainRunning = useRef(false);
  // Safety timeout: if a chain takes >15s, force-unlock it
  const botChainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Spontaneous bot message timer
  const spontaneousTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to always have fresh state inside async functions (avoids stale closures)
  const playersRef = useRef(players);
  const chatMessagesRef = useRef(chatMessages);
  const cluesRef = useRef(clues);
  const gameStateRef = useRef(gameState);
  // Human names ref so fireBotBanter (useCallback) always has fresh values
  const humanNamesRef = useRef<HumanNames>({ user: human1Name, partner: PARTNER_GAME_NAME });

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);
  useEffect(() => { cluesRef.current = clues; }, [clues]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { humanNamesRef.current = { user: human1Name, partner: PARTNER_GAME_NAME }; }, [human1Name]);

  // ── Chain lock helpers with 15s safety timeout ──
  const lockBotChain = () => {
    isBotChainRunning.current = true;
    if (botChainTimeoutRef.current) clearTimeout(botChainTimeoutRef.current);
    botChainTimeoutRef.current = setTimeout(() => {
      console.warn('[BotChain] 15s safety timeout — force-unlocking chain.');
      isBotChainRunning.current = false;
      setIsBotThinking(null);
    }, 15000);
  };
  const unlockBotChain = () => {
    isBotChainRunning.current = false;
    if (botChainTimeoutRef.current) clearTimeout(botChainTimeoutRef.current);
  };

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat discussion
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isBotThinking]);

  // Start Game handler
  const startNewGame = () => {
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    const isSwapped = Math.random() > 0.5;
    const civWord = isSwapped ? pair.spy : pair.civilian;
    const spyWord = isSwapped ? pair.civilian : pair.spy;

    // Roles for 4 players: 2 Civilians, 1 Spy, 1 Mr. White
    const roles: Array<'Civilian' | 'Spy' | 'Mr. White'> = ['Civilian', 'Civilian', 'Spy', 'Mr. White'];
    const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);

    const initialPlayers: GamePlayer[] = [
      {
        id: 'human1',
        name: human1Name,
        role: shuffledRoles[0],
        word: shuffledRoles[0] === 'Civilian' ? civWord : (shuffledRoles[0] === 'Spy' ? spyWord : null),
        clue: null,
        isBot: false,
        isAlive: true,
        hasVoted: false,
        votesReceived: 0,
        revealClicked: false,
      },
      {
        id: 'human2',
        name: human2Name,
        role: shuffledRoles[1],
        word: shuffledRoles[1] === 'Civilian' ? civWord : (shuffledRoles[1] === 'Spy' ? spyWord : null),
        clue: null,
        isBot: false,
        isAlive: true,
        hasVoted: false,
        votesReceived: 0,
        revealClicked: false,
      },
      {
        id: 'bot1',
        name: 'Karan',
        role: shuffledRoles[2],
        word: shuffledRoles[2] === 'Civilian' ? civWord : (shuffledRoles[2] === 'Spy' ? spyWord : null),
        clue: null,
        isBot: true,
        isAlive: true,
        hasVoted: false,
        votesReceived: 0,
        revealClicked: true, // Bots are pre-revealed
      },
      {
        id: 'bot2',
        name: 'Neha',
        role: shuffledRoles[3],
        word: shuffledRoles[3] === 'Civilian' ? civWord : (shuffledRoles[3] === 'Spy' ? spyWord : null),
        clue: null,
        isBot: true,
        isAlive: true,
        hasVoted: false,
        votesReceived: 0,
        revealClicked: true,
      }
    ];

    setPlayers(initialPlayers);
    setCivilianWord(civWord);
    setGameState('ROLE_REVEAL');
    setClues([]);
    setChatMessages([]);
    setTurnIndex(0);
    setRoundNumber(1);
    setVotes({});
    setEliminatedPlayer(null);
    setMrWhiteGuess(null);
    setWinner(null);
    
    // Choose randomized turn order for alive players
    const order = ['human1', 'bot1', 'human2', 'bot2'].sort(() => Math.random() - 0.5);
    setTurnOrder(order);
  };

  // Reveal popup helper
  const handleRevealCard = (player: GamePlayer) => {
    setRevealUserSecret(player);
    setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, revealClicked: true } : p));
  };

  // Bot Clue Loop
  useEffect(() => {
    if (gameState !== 'CLUE_ROUND') return;
    const activePlayerId = turnOrder[turnIndex];
    const activePlayer = players.find(p => p.id === activePlayerId);
    
    if (activePlayer && activePlayer.isBot && activePlayer.isAlive && !activePlayer.clue) {
      setIsBotThinking(activePlayer.name);
      
      const timer = setTimeout(async () => {
        try {
          const resClue = await generateAICheckClue(
            activePlayer.name,
            activePlayer.word,
            clues,
            activePlayer.role === 'Spy',
            activePlayer.role === 'Mr. White'
          );
          submitClueForPlayer(activePlayerId, resClue || "Vibe check!");
        } catch (err) {
          console.error(err);
          submitClueForPlayer(activePlayerId, "Masti!");
        } finally {
          setIsBotThinking(null);
        }
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [gameState, turnIndex, turnOrder, players]);

  // Submit Clue handler
  const submitClueForPlayer = (playerId: string, clueText: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, clue: clueText } : p));
    setClues(prev => [...prev, { player: player.name, clue: clueText }]);
    setClueInput('');

    // Advance turn to next alive player
    let nextIndex = turnIndex + 1;
    while (nextIndex < turnOrder.length) {
      const nextPlayerId = turnOrder[nextIndex];
      const nextPlayer = players.find(p => p.id === nextPlayerId);
      if (nextPlayer && nextPlayer.isAlive) {
        break;
      }
      nextIndex++;
    }

    if (nextIndex < turnOrder.length) {
      setTurnIndex(nextIndex);
    } else {
      // Clues ended -> discussion
      setGameState('DISCUSSION_ROUND');
      isBotChainRunning.current = false;
      
      // Auto: BOTH bots comment sequentially to kick off discussion
      setTimeout(async () => {
        const allPlayers = playersRef.current;
        const aliveBots = allPlayers.filter(p => p.isBot && p.isAlive);
        if (aliveBots.length === 0) return;
        lockBotChain();

        // First bot reacts to all clues
        const bot1 = aliveBots[0];
        setIsBotThinking(bot1.name);
        let history: ChatMessage[] = [];
        try {
          const msg1 = await generateAIChatBanter(
            bot1.name, bot1.word, bot1.role,
            cluesRef.current, history, 'game_start',
            humanNamesRef.current
          );
          if (msg1 !== RATE_LIMIT_MARKER) {
            const entry1 = { player: bot1.name, text: msg1 };
            history = [entry1];
            setChatMessages([entry1]);
          }
        } catch (e) { console.error(e); } finally { setIsBotThinking(null); }

        // Second bot replies to first bot
        if (aliveBots.length > 1) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
          const bot2 = aliveBots[1];
          setIsBotThinking(bot2.name);
          try {
            const msg2 = await generateAIChatBanter(
              bot2.name, bot2.word, bot2.role,
              cluesRef.current, history, 'respond_to_bot',
              humanNamesRef.current
            );
            if (msg2 !== RATE_LIMIT_MARKER) {
              setChatMessages(prev => [...prev, { player: bot2.name, text: msg2 }]);
            }
          } catch (e) { console.error(e); } finally { setIsBotThinking(null); }
        }
        unlockBotChain();
      }, 1200);
    }
  };

  // isMessageGameRelated is defined at module level (above component) to avoid stale closures

  // Core function: fire one bot message and optionally chain another bot after it
  const fireBotBanter = useCallback(async (
    bot: typeof players[0],
    currentHistory: ChatMessage[],
    triggerType: 'respond_to_human' | 'respond_to_bot' | 'spontaneous' | 'game_start',
    chainNextBot: boolean = false
  ) => {
    setIsBotThinking(bot.name);
    let newHistory = currentHistory;
    try {
      const msg = await generateAIChatBanter(
        bot.name, bot.word, bot.role,
        cluesRef.current, currentHistory, triggerType,
        humanNamesRef.current // always fresh via ref — no stale closure
      );

      // Rate limit — show toast, don't add empty message to chat
      if (msg === RATE_LIMIT_MARKER) {
        setApiError("AI thoda busy hai abhi, 1 minute baad phir try karo!");
        return;
      }

      const entry = { player: bot.name, text: msg };
      newHistory = [...currentHistory, entry];
      setChatMessages(prev => [...prev, entry]);
    } catch (err) {
      console.error('[BotBanter]', err);
    } finally {
      setIsBotThinking(null);
    }

    // Chain: the OTHER bot MIGHT also chime in
    if (chainNextBot) {
      const allPlayers = playersRef.current;
      // Use dynamic bot names — no hardcoded strings
      const botNames = new Set(allPlayers.filter(p => p.isBot).map(p => p.name));
      const aliveBots = allPlayers.filter(p => p.isBot && p.isAlive && p.id !== bot.id);
      const otherBot = aliveBots[0];

      if (otherBot) {
        const lastHumanMsg = newHistory.slice().reverse().find(m => !botNames.has(m.player));
        const isGameChat = lastHumanMsg ? isMessageGameRelated(lastHumanMsg.text) : true;
        const chainChance = isGameChat ? 0.30 : 0.08;

        if (Math.random() < chainChance) {
          await new Promise(r => setTimeout(r, 2800 + Math.random() * 2500));
          await fireBotBanter(otherBot, newHistory, 'respond_to_bot', false);
        }
      }
    }
  }, []);

  // Send Banter message in chat
  const sendChatMessage = async () => {
    const text = humanChatText.trim();
    if (!text) return;
    if (isBotChainRunning.current) return;

    const senderPlayer = players.find(p => p.id === chatSender)!;
    const newMsg = { player: senderPlayer.name, text };
    const updatedHistory = [...chatMessagesRef.current, newMsg];
    setChatMessages(updatedHistory);
    setHumanChatText('');

    if (spontaneousTimer.current) clearTimeout(spontaneousTimer.current);

    const aliveBots = players.filter(p => p.isBot && p.isAlive);
    if (aliveBots.length === 0) return;

    const isGameChat = isMessageGameRelated(text);
    const mentionedBot = aliveBots.find(p => text.toLowerCase().includes(p.name.toLowerCase()));

    let shouldRespond = false;
    if (mentionedBot) {
      shouldRespond = true;
    } else if (isGameChat) {
      shouldRespond = Math.random() < 0.70;
    } else {
      shouldRespond = Math.random() < 0.25; // let humans have private moments
    }
    if (!shouldRespond) return;

    const primaryBot = mentionedBot || aliveBots[Math.floor(Math.random() * aliveBots.length)];
    lockBotChain();
    const delay = 1500 + Math.random() * 1500;
    setTimeout(async () => {
      await fireBotBanter(primaryBot, updatedHistory, 'respond_to_human', !mentionedBot);
      unlockBotChain();
    }, delay);
  };

  // Submit human vote
  const handleCastHumanVote = (voterId: string, targetName: string) => {
    setVotes(prev => ({ ...prev, [voterId]: targetName }));
    setPlayers(prev => prev.map(p => p.id === voterId ? { ...p, hasVoted: true } : p));
  };

  // Bot Votes & Elimination Calculation
  const triggerBotVotesAndElimination = async () => {
    setIsVotingInProgress(true);
    const updatedVotes = { ...votes };
    const alivePlayersList = players.filter(p => p.isAlive).map(p => p.name);

    // Call Gemini for each alive bot's vote
    for (const bot of players.filter(p => p.isBot && p.isAlive)) {
      setIsBotThinking(bot.name);
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const botVoteRes = await generateAIVote(
          bot.name,
          bot.word,
          bot.role,
          clues,
          chatMessages,
          alivePlayersList
        );
        updatedVotes[bot.id] = botVoteRes.vote;
        
        // Show bot vote reasoning naturally in chat
        setChatMessages(prev => [...prev, { 
          player: bot.name, 
          text: `${botVoteRes.reason} Vote: ${botVoteRes.vote}!` 
        }]);
      } catch (e) {
        // Fallback random target
        const targets = players.filter(p => p.isAlive && p.name !== bot.name);
        const fallbackTarget = targets[Math.floor(Math.random() * targets.length)]?.name || human1Name;
        updatedVotes[bot.id] = fallbackTarget;
      }
    }
    setIsBotThinking(null);

    // Tally votes
    const voteTally: Record<string, number> = {};
    players.filter(p => p.isAlive).forEach(p => { voteTally[p.name] = 0; });

    Object.values(updatedVotes).forEach(targetName => {
      if (voteTally[targetName] !== undefined) {
        voteTally[targetName]++;
      }
    });

    // Determine max votes
    let maxVotes = -1;
    let elName = "";
    let isTie = false;

    Object.entries(voteTally).forEach(([name, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        elName = name;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    });

    // In case of a tie, select one of the tied players randomly
    if (isTie) {
      const maxVoteCount = maxVotes;
      const tiedPlayers = Object.entries(voteTally)
        .filter(([_, count]) => count === maxVoteCount)
        .map(([name]) => name);
      elName = tiedPlayers[Math.floor(Math.random() * tiedPlayers.length)];
    }

    const eliminatedObj = players.find(p => p.name === elName);
    if (eliminatedObj) {
      setPlayers(prev => prev.map(p => p.name === elName ? { ...p, isAlive: false, votesReceived: voteTally[p.name] || 0 } : { ...p, votesReceived: voteTally[p.name] || 0 }));
      setEliminatedPlayer(eliminatedObj);
      setGameState('ELIMINATION');
    }
    setIsVotingInProgress(false);
  };

  // Mr. White Guess submission
  const handleMrWhiteGuessResult = (guess: string) => {
    setMrWhiteGuess(guess);
    const isCorrect = guess.toLowerCase().trim() === civilianWord.toLowerCase().trim();
    
    if (isCorrect) {
      setWinner('Mr. White');
    } else {
      // Mr White guessed wrong. Check if spy is alive
      const spyObj = players.find(p => p.role === 'Spy')!;
      if (spyObj.isAlive) {
        setWinner('Spy');
      } else {
        setWinner('Civilians');
      }
    }
    setGameState('GAME_OVER');
  };

  // Bot Mr. White Auto-guess effect
  useEffect(() => {
    if (gameState === 'ELIMINATION' && eliminatedPlayer && eliminatedPlayer.role === 'Mr. White' && eliminatedPlayer.isBot) {
      setIsBotThinking(eliminatedPlayer.name);
      
      const timer = setTimeout(async () => {
        const systemInstruction = `You are Mr. White in 'Who is the Spy'. You got caught. 
Based on these clues: ${JSON.stringify(clues)}, you must guess the Civilian word in exactly 1 word. 
Write ONLY the single word guess in Hinglish or English (e.g. 'Chai' or 'Biryani'). No sentences. No quotes.`;
        
        const prompt = `Guess the secret word. Clues: ${JSON.stringify(clues)}. Return 1 word guess.`;
        
        try {
          let guess = "Chai";
          const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
          if (apiKey) {
            const res = await callGemini(prompt, systemInstruction, false);
            guess = res.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(' ')[0] || "Chai";
          }
          handleMrWhiteGuessResult(guess);
        } catch (e) {
          handleMrWhiteGuessResult("Chai");
        } finally {
          setIsBotThinking(null);
        }
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [gameState, eliminatedPlayer]);

  // Spontaneous bot chimes in during discussion if idle
  useEffect(() => {
    if (gameState !== 'DISCUSSION_ROUND') {
      if (spontaneousTimer.current) clearTimeout(spontaneousTimer.current);
      return;
    }
    // Schedule a bot to speak up spontaneously after 18-30 seconds of inactivity
    const scheduleNextSpontaneous = () => {
      if (spontaneousTimer.current) clearTimeout(spontaneousTimer.current);
      const delay = 18000 + Math.random() * 12000; // 18-30 seconds
      spontaneousTimer.current = setTimeout(async () => {
        if (gameStateRef.current !== 'DISCUSSION_ROUND') return;
        if (isBotChainRunning.current) {
          scheduleNextSpontaneous(); // bot already talking, retry later
          return;
        }

        // Avoid infinite bot-to-bot chat and API rate limit usage when humans are inactive.
        // Bots should only chime in spontaneously if the last message came from a human player.
        const currentMessages = chatMessagesRef.current;
        if (currentMessages.length > 0) {
          const lastMsg = currentMessages[currentMessages.length - 1];
          const allPlayers = playersRef.current;
          const lastPlayer = allPlayers.find(p => p.name === lastMsg.player);
          if (lastPlayer && lastPlayer.isBot) {
            // Last message was from a bot. Skip this chime and check again in the next cycle.
            scheduleNextSpontaneous();
            return;
          }
        }

        const aliveBots = playersRef.current.filter(p => p.isBot && p.isAlive);
        if (aliveBots.length === 0) return;
        const randBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        lockBotChain();
        await fireBotBanter(randBot, chatMessagesRef.current, 'spontaneous', true);
        unlockBotChain();
        scheduleNextSpontaneous();
      }, delay);
    };
    scheduleNextSpontaneous();
    return () => { if (spontaneousTimer.current) clearTimeout(spontaneousTimer.current); };
  }, [gameState, fireBotBanter]);

  // Proceed after elimination reveal (when non Mr. White, or Mr. White has guessed)
  const proceedAfterElimination = () => {
    if (eliminatedPlayer?.role === 'Mr. White') {
      // Handled by guess flow
      return;
    }

    const spy = players.find(p => p.role === 'Spy')!;
    const mrWhite = players.find(p => p.role === 'Mr. White')!;
    const aliveCount = players.filter(p => p.isAlive).length;

    // Victory checks
    if (!spy.isAlive && !mrWhite.isAlive) {
      setWinner('Civilians');
      setGameState('GAME_OVER');
    } else if (spy.isAlive && aliveCount <= 2) {
      setWinner('Spy');
      setGameState('GAME_OVER');
    } else if (mrWhite.isAlive && aliveCount <= 2) {
      setWinner('Mr. White');
      setGameState('GAME_OVER');
    } else {
      // Continue to next round (Rounds of clues)
      setRoundNumber(prev => prev + 1);
      setPlayers(prev => prev.map(p => ({ ...p, clue: null, hasVoted: false, votesReceived: 0 })));
      setClues([]);
      setVotes({});
      setTurnIndex(0);
      setMrWhiteGuess(null);
      setMrWhiteGuessInput('');
      setEliminatedPlayer(null);
      
      // Update turn order based on alive players
      const aliveIds = turnOrder.filter(id => {
        const p = players.find(pl => pl.id === id);
        return p && p.isAlive;
      });
      setTurnOrder(aliveIds);
      setGameState('CLUE_ROUND');
    }
  };

  // Helper check to see if all human players clicked reveal
  const allHumansRevealed = players.filter(p => !p.isBot).every(p => p.revealClicked);
  const allHumansVoted = players.filter(p => !p.isBot && p.isAlive).every(p => votes[p.id]);

  return (
    <div className="w-full h-full bg-[var(--bg-primary)] flex flex-col font-sans overflow-hidden text-[var(--text-primary)] relative">
      
      {/* ──── API ERROR TOAST ──── */}
      <AnimatePresence>
        {apiError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-4 right-4 z-[9999] p-4 bg-red-500/90 backdrop-blur-md rounded-2xl shadow-2xl flex items-center justify-between border border-red-400/50"
          >
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-white">error</span>
              <span className="text-white text-sm font-medium">{apiError}</span>
            </div>
            <button
              onClick={() => setApiError(null)}
              className="text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ──── SCREEN HEADER ──── */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-white/5 bg-black/20 shrink-0 safe-top">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-[#998f81] hover:text-[var(--gold)] hover:bg-white/10 transition-all flex items-center justify-center active:scale-90"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <div>
            <h1 className="font-serif italic text-xl text-[var(--gold)]">Who is the Spy?</h1>
            <p className="text-[9px] font-label uppercase tracking-widest text-[#998f81]">Round {roundNumber} • Status: {gameState}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isBotThinking && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 shrink-0">
              <span className="w-2 h-2 bg-[var(--gold)] rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-[var(--gold)] tracking-wider uppercase">{isBotThinking} is thinking...</span>
            </div>
          )}

          {/* Gemini API Quota Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-mono text-white/50 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${
              geminiStats.rpm >= 12 ? 'bg-red-500 animate-pulse' :
              geminiStats.rpm >= 8 ? 'bg-amber-500 animate-pulse' :
              'bg-emerald-500'
            }`} />
            <span>AI: {geminiStats.rpm}/{geminiStats.maxRpm} RPM • {geminiStats.rpd} Today</span>
          </div>
        </div>
      </header>

      {/* ──── STAGE CONTAINER ──── */}
      <div className="flex-grow overflow-hidden flex flex-col relative">
        <AnimatePresence mode="wait">
          
          {/* 1. LOBBY STATE */}
          {gameState === 'LOBBY' && (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-grow overflow-y-auto p-6 flex flex-col items-center justify-center max-w-2xl mx-auto w-full gap-8"
            >
              <div className="text-center">
                <span className="material-symbols-outlined text-5xl text-[var(--gold)] mb-2 animate-bounce">sports_esports</span>
                <h2 className="text-2xl font-serif italic text-white mb-2">Game Room Lobby</h2>
                <p className="text-sm text-[#998f81]">4 players ready hain game ke liye!</p>
              </div>

              {/* Player Cards */}
              <div className="grid grid-cols-2 gap-4 w-full">
                {[
                  { name: human1Name, role: "You", color: "border-[var(--gold)] bg-[var(--gold)]/5 text-white" },
                  { name: human2Name, role: "Partner", color: "border-white/15 bg-white/[0.03] text-white" },
                  { name: "Karan", role: "Player", color: "border-white/10 bg-white/[0.01] text-white/60" },
                  { name: "Neha", role: "Player", color: "border-white/10 bg-white/[0.01] text-white/60" }
                ].map((p, idx) => (
                  <div key={idx} className={`p-4 rounded-2xl border text-left ${p.color} flex items-center gap-3 shadow-lg`}>
                    <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center border border-white/10 text-xs font-bold uppercase">
                      {p.name[0]}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{p.name}</h4>
                      <p className="text-[10px] text-[#998f81] uppercase tracking-wider">{p.role}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Info panel */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 w-full text-xs text-[#998f81] space-y-2.5 leading-relaxed">
                <h4 className="font-bold text-white/80 uppercase tracking-widest flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">info</span> Rules of the game
                </h4>
                <p>1. <strong>Civilians:</strong> Unhe secret word milega (e.g., "Chai"). Unka kaam hai subtle clues dekar ek doosre ko signal dena aur spy ko catch karna.</p>
                <p>2. <strong>Spy:</strong> Use milta-julta word milega (e.g., "Coffee"). Use civilians ke clues sunkar guess karna hai aur blend in hona hai.</p>
                <p>3. <strong>Mr. White:</strong> Use blank milega. Use clues ko predict karke word guess karna hai aur avoid caught hona hai.</p>
              </div>

              <button
                onClick={startNewGame}
                className="w-full py-3.5 rounded-2xl bg-[var(--gold)] hover:bg-[var(--gold-light)] text-black font-bold text-sm tracking-wider uppercase transition-all shadow-lg active:scale-[0.98]"
              >
                Start Game
              </button>
            </motion.div>
          )}

          {/* 2. ROLE REVEAL STATE */}
          {gameState === 'ROLE_REVEAL' && (
            <motion.div
              key="reveal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow p-6 flex flex-col items-center justify-center max-w-md mx-auto w-full gap-8"
            >
              <div className="text-center">
                <h2 className="text-xl font-bold text-white mb-2">Secret Word Reveal</h2>
                <p className="text-xs text-[#998f81] leading-relaxed">
                  Apne-apne card par click karke secret word privately check karein. Dhyan rahe, doosra player na dekh paye!
                </p>
              </div>

              <div className="flex flex-col gap-4 w-full">
                {players.map(p => (
                  <div key={p.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold">
                        {p.name[0]}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white/90">{p.name}</h4>
                        <p className="text-[10px] text-[#998f81] uppercase tracking-wider">{p.isBot ? "AI Bot" : "Human Player"}</p>
                      </div>
                    </div>

                    <div>
                      {p.isBot ? (
                        <span className="text-[10px] text-emerald-400 font-bold uppercase bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-400/20">Ready ✓</span>
                      ) : p.revealClicked ? (
                        <button
                          onClick={() => handleRevealCard(p)}
                          className="text-[10px] text-amber-300 font-bold uppercase bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-full border border-amber-400/20 transition-all"
                        >
                          Seen - Show Again
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRevealCard(p)}
                          className="text-[10px] text-black font-bold uppercase bg-[var(--gold)] hover:bg-[var(--gold-light)] px-4 py-1.5 rounded-full transition-all active:scale-95 shadow-md"
                        >
                          Tap to Reveal
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {allHumansRevealed && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setGameState('CLUE_ROUND')}
                  className="w-full py-3.5 rounded-2xl bg-[var(--gold)] text-black font-bold text-sm tracking-wider uppercase transition-all shadow-md active:scale-95 mt-4"
                >
                  Start Round 1 Clues
                </motion.button>
              )}
            </motion.div>
          )}

          {/* 3. CLUE ROUND STATE */}
          {gameState === 'CLUE_ROUND' && (
            <motion.div
              key="clues"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow p-6 flex flex-col justify-between h-full"
            >
              {/* Clues List */}
              <div className="flex-grow overflow-y-auto space-y-4 max-w-xl mx-auto w-full pb-6">
                <div className="text-center py-2 shrink-0">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#998f81]">Word Clues Round</h3>
                  <p className="text-[11px] text-white/50 mt-1">Sabhi players turn-by-turn ek clue denge.</p>
                </div>

                <div className="space-y-3">
                  {players.map(p => (
                    <div
                      key={p.id}
                      className={`p-4 rounded-2xl border transition-all duration-300 ${
                        !p.isAlive ? "opacity-30 border-white/5 bg-white/[0.01]" :
                        turnOrder[turnIndex] === p.id 
                          ? "border-[var(--gold)] bg-[var(--gold)]/5 shadow-[0_0_15px_rgba(212,175,55,0.08)]"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold ${turnOrder[turnIndex] === p.id && p.isAlive ? "text-[var(--gold)] border-[var(--gold)]/30" : ""}`}>
                            {p.name[0]}
                          </div>
                          <div>
                            <span className="font-bold text-sm text-white/90">{p.name}</span>
                            {turnOrder[turnIndex] === p.id && p.isAlive && (
                              <span className="text-[9px] font-bold text-[var(--gold)] uppercase bg-[var(--gold)]/10 px-1.5 py-0.5 rounded ml-2 animate-pulse">Their Turn</span>
                            )}
                          </div>
                        </div>

                        <div>
                          {p.clue ? (
                            <span className="font-serif italic font-bold text-base text-[var(--gold)] bg-black/30 border border-white/5 px-4 py-1.5 rounded-xl block">
                              "{p.clue}"
                            </span>
                          ) : !p.isAlive ? (
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Eliminated</span>
                          ) : turnOrder[turnIndex] === p.id && isBotThinking === p.name ? (
                            <div className="flex gap-1 py-1 px-2 bg-white/5 rounded-lg">
                              <span className="w-1.5 h-1.5 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          ) : (
                            <span className="text-[10px] text-[#998f81] uppercase tracking-wider italic">Waiting...</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Turn input overlay */}
              <div className="shrink-0 bg-white/5 border border-white/10 p-4 rounded-3xl max-w-xl mx-auto w-full shadow-lg">
                {(() => {
                  const activePlayerId = turnOrder[turnIndex];
                  const activePlayer = players.find(p => p.id === activePlayerId);
                  
                  if (!activePlayer || !activePlayer.isAlive) return null;
                  
                  if (activePlayer.isBot) {
                    return (
                      <div className="text-center py-2 text-xs text-[#998f81] italic">
                        🤖 {activePlayer.name} soch kar clue likh raha hai...
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-xs font-bold text-[var(--gold)] tracking-wider uppercase">
                          ✍️ {activePlayer.name}, apna clue enter karein:
                        </span>
                        
                        <button
                          onClick={() => {
                            // Show secret word for this player privately
                            setRevealUserSecret(activePlayer);
                          }}
                          className="text-[9px] font-bold text-white/60 hover:text-[var(--gold)] flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg border border-white/10"
                        >
                          <span className="material-symbols-outlined text-[10px]">visibility</span>
                          <span>Show Word</span>
                        </button>
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={clueInput}
                          onChange={(e) => setClueInput(e.target.value)}
                          placeholder="Type a 1-3 word clue in Hinglish..."
                          className="flex-grow px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-[var(--gold)] transition-colors"
                          onKeyDown={(e) => e.key === 'Enter' && clueInput.trim() && submitClueForPlayer(activePlayerId, clueInput)}
                        />
                        <button
                          disabled={!clueInput.trim()}
                          onClick={() => submitClueForPlayer(activePlayerId, clueInput)}
                          className="px-5 rounded-xl bg-[var(--gold)] hover:bg-[var(--gold-light)] disabled:opacity-40 text-black font-bold text-xs uppercase tracking-wider transition-all"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          )}

          {/* 4. DISCUSSION STATE */}
          {gameState === 'DISCUSSION_ROUND' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow flex flex-col justify-between h-full overflow-hidden"
            >
              {/* Clues Summary Panel (Sticky at top) */}
              <div className="px-6 py-3 border-b border-white/5 bg-black/10 shrink-0 flex items-center gap-3 overflow-x-auto scrollbar-hide">
                <span className="text-[10px] font-bold text-[#998f81] uppercase tracking-widest shrink-0">Clues:</span>
                {players.filter(p => p.clue).map(p => (
                  <div key={p.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs shrink-0">
                    <span className="font-semibold text-white/80">{p.name}:</span>
                    <span className="font-serif italic text-[var(--gold)]">"{p.clue}"</span>
                  </div>
                ))}
              </div>

              {/* Chat log messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-xs text-[#998f81] italic">
                    Koi baat nahi hua abhi. Karun ya Neha se baat shuru karo ya apne aap type karo!
                  </div>
                ) : (
                  <div className="space-y-3.5 max-w-xl mx-auto w-full">
                    {chatMessages.map((msg, idx) => {
                      const isMe = msg.player === human1Name;
                      const isPartner = msg.player === human2Name;
                      
                      let cardStyle = "bg-white/5 border border-white/10 text-white/90";
                      if (isMe) cardStyle = "bg-[var(--gold)]/10 border border-[var(--gold)]/25 text-white mr-auto text-left";
                      if (isPartner) cardStyle = "bg-white/[0.08] border border-white/20 text-white ml-auto text-left";

                      return (
                        <div key={idx} className={`flex flex-col max-w-[85%] ${isMe ? 'mr-auto' : isPartner ? 'ml-auto' : 'ml-0'}`}>
                          <div className={`text-[10px] text-[#998f81] uppercase tracking-wider mb-1 px-1 font-bold ${isMe ? 'text-left' : isPartner ? 'text-right' : 'text-left'}`}>
                            {msg.player}
                          </div>
                          <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${cardStyle}`}>
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                    {isBotThinking && (
                      <div className="flex flex-col max-w-[75%] ml-0">
                        <div className="text-[10px] text-[#998f81] uppercase tracking-wider mb-1 text-left font-bold">
                          {isBotThinking}
                        </div>
                        <div className="px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10">
                          <div className="flex gap-1.5 py-1">
                            <span className="w-2 h-2 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-[var(--gold)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* Chat Input panel */}
              <div className="shrink-0 bg-black/30 border-t border-white/5 p-4 flex flex-col gap-3">
                {/* Selector for local testing (Who is typing) */}
                <div className="flex items-center justify-between max-w-xl mx-auto w-full px-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setChatSender('human1')}
                      className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${chatSender === 'human1' ? 'bg-[var(--gold)] border-[var(--gold)] text-black' : 'bg-white/5 border-white/10 text-white/60'}`}
                    >
                      Sender: {human1Name}
                    </button>
                    <button
                      onClick={() => setChatSender('human2')}
                      className={`px-3 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${chatSender === 'human2' ? 'bg-[var(--gold)] border-[var(--gold)] text-black' : 'bg-white/5 border-white/10 text-white/60'}`}
                    >
                      Sender: {human2Name}
                    </button>
                  </div>

                  <button
                    onClick={() => setGameState('VOTING_ROUND')}
                    className="px-4 py-1.5 rounded-xl bg-[var(--gold)] hover:bg-[var(--gold-light)] text-black font-black text-[10px] uppercase tracking-wider shadow-lg active:scale-95 transition-all"
                  >
                    Go to Voting ➔
                  </button>
                </div>

                <div className="flex gap-2 max-w-xl mx-auto w-full">
                  <input
                    type="text"
                    value={humanChatText}
                    onChange={(e) => setHumanChatText(e.target.value)}
                    placeholder={`Type message as ${chatSender === 'human1' ? human1Name : human2Name}...`}
                    className="flex-grow px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-[var(--gold)] transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  />
                  
                  <button
                    onClick={sendChatMessage}
                    className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-[var(--gold)] text-[var(--gold)] hover:bg-white/10 transition-all flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-lg">send</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* 5. VOTING STATE */}
          {gameState === 'VOTING_ROUND' && (
            <motion.div
              key="voting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow p-6 flex flex-col justify-between h-full max-w-lg mx-auto w-full"
            >
              <div className="text-center py-2">
                <span className="material-symbols-outlined text-4xl text-[var(--gold)] animate-pulse">how_to_vote</span>
                <h2 className="text-xl font-bold text-white mt-2">Voting Phase</h2>
                <p className="text-xs text-[#998f81] mt-1">Sabh players vote karke ek spy ko eliminate karenge.</p>
              </div>

              {/* Humans Vote inputs */}
              <div className="space-y-5 my-6 flex-grow overflow-y-auto pr-1">
                {players.filter(p => !p.isBot && p.isAlive).map(voter => (
                  <div key={voter.id} className="p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
                    <h3 className="text-xs font-bold text-[var(--gold)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">face</span>
                      {voter.name}, select who you think is the spy:
                    </h3>

                    {votes[voter.id] ? (
                      <div className="p-3 bg-black/40 border border-white/5 rounded-xl flex items-center justify-between text-sm">
                        <span className="text-white/60">Voted for:</span>
                        <span className="font-bold text-amber-300">{votes[voter.id]}</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {players.filter(p => p.id !== voter.id && p.isAlive).map(target => (
                          <button
                            key={target.id}
                            onClick={() => handleCastHumanVote(voter.id, target.name)}
                            className="py-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-amber-400 text-xs text-white/80 font-bold transition-all hover:bg-white/10 active:scale-95"
                          >
                            {target.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Show details of clues to refresh memory */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] text-[#998f81] space-y-1.5">
                  <span className="font-bold uppercase text-white/70 block mb-1">Quick Clue Recap:</span>
                  {players.filter(p => p.clue).map(p => (
                    <div key={p.id}>• {p.name}: <span className="font-serif italic text-white/80">"{p.clue}"</span></div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              {allHumansVoted && !isVotingInProgress && (
                <button
                  onClick={triggerBotVotesAndElimination}
                  className="w-full py-3.5 rounded-2xl bg-[var(--gold)] text-black font-bold text-sm tracking-wider uppercase transition-all shadow-md active:scale-95"
                >
                  Tally Votes (Get AI Votes)
                </button>
              )}

              {isVotingInProgress && (
                <div className="text-center py-4 text-xs text-[#998f81] italic">
                  Calculating bot votes and resolving elimination...
                </div>
              )}
            </motion.div>
          )}

          {/* 6. ELIMINATION STATE */}
          {gameState === 'ELIMINATION' && eliminatedPlayer && (
            <motion.div
              key="elimination"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow p-6 flex flex-col items-center justify-center max-w-md mx-auto w-full gap-8 text-center"
            >
              <div>
                <span className="material-symbols-outlined text-6xl text-rose-500 animate-bounce mb-2">gavel</span>
                <h2 className="text-2xl font-serif italic text-white mb-1">Voting Results</h2>
                <p className="text-xs text-[#998f81]">Sabhse zyada votes milne par eliminate kiya gaya.</p>
              </div>

              {/* Voted Out Card */}
              <div className="p-6 rounded-3xl bg-white/5 border border-rose-500/30 w-full relative overflow-hidden shadow-2xl">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500" />
                
                <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-lg font-bold text-rose-400 mx-auto mb-4">
                  {eliminatedPlayer.name[0]}
                </div>
                
                <h3 className="text-xl font-bold text-white">{eliminatedPlayer.name} is Voted Out!</h3>
                <p className="text-xs text-[#998f81] uppercase tracking-wider mt-1">{eliminatedPlayer.isBot ? "AI Bot" : "Human Player"}</p>

                <div className="mt-6 pt-5 border-t border-white/5">
                  <span className="text-[10px] font-bold text-[#998f81] uppercase tracking-widest block mb-2">True Role:</span>
                  
                  <span className={`text-sm font-bold uppercase tracking-wider px-4 py-1.5 rounded-full border ${
                    eliminatedPlayer.role === 'Civilian' ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/20" :
                    eliminatedPlayer.role === 'Spy' ? "text-red-400 bg-red-500/10 border-red-400/20 animate-pulse" :
                    "text-amber-300 bg-amber-500/10 border-amber-400/20"
                  }`}>
                    {eliminatedPlayer.role}
                  </span>

                  {eliminatedPlayer.role !== 'Mr. White' && (
                    <p className="text-sm mt-4 text-[#998f81]">
                      Their secret word was: <strong className="text-white">"{eliminatedPlayer.word}"</strong>
                    </p>
                  )}
                </div>
              </div>

              {/* MR WHITE GUESSING SCREEN */}
              {eliminatedPlayer.role === 'Mr. White' && (
                <div className="p-5 rounded-2xl bg-white/5 border border-white/10 w-full space-y-4">
                  <h4 className="text-sm font-bold text-amber-300 flex items-center gap-1.5 justify-center">
                    <span className="material-symbols-outlined text-sm">psychology</span>
                    Mr. White Guess Phase!
                  </h4>
                  <p className="text-xs text-[#998f81] leading-relaxed">
                    Kyunki Mr. White eliminate ho gaye hain, unke paas Civilian secret word guess karne ka ek chance hai. Agar sahi guess kiya toh Mr. White jeet jayenge!
                  </p>

                  {eliminatedPlayer.isBot ? (
                    <div className="text-center py-2 text-xs text-[#998f81] italic">
                      🤖 Bot Neha guess karne ka soch rahi hai...
                    </div>
                  ) : (
                    // Human Mr White Guess Inputs
                    <div className="space-y-3 pt-2">
                      <div className="text-[10px] font-bold uppercase text-[var(--gold)] text-left">
                        {eliminatedPlayer.name}, civilian word guess karein:
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={mrWhiteGuessInput}
                          onChange={(e) => setMrWhiteGuessInput(e.target.value)}
                          placeholder="Type secret word guess..."
                          className="flex-grow px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/30 text-xs focus:outline-none"
                        />
                        <button
                          disabled={!mrWhiteGuessInput.trim()}
                          onClick={() => handleMrWhiteGuessResult(mrWhiteGuessInput)}
                          className="px-4 py-2 rounded-xl bg-[var(--gold)] text-black font-bold text-xs uppercase"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Continue button for non Mr White eliminations */}
              {eliminatedPlayer.role !== 'Mr. White' && (
                <button
                  onClick={proceedAfterElimination}
                  className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold text-sm tracking-wider uppercase transition-all shadow-md active:scale-95"
                >
                  Proceed ➔
                </button>
              )}

            </motion.div>
          )}

          {/* 7. GAME OVER STATE */}
          {gameState === 'GAME_OVER' && (
            <motion.div
              key="gameover"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow p-6 flex flex-col justify-between h-full max-w-xl mx-auto w-full"
            >
              <div className="text-center py-4">
                <span className="material-symbols-outlined text-6xl text-[var(--gold)] animate-bounce mb-2">emoji_events</span>
                <h2 className="text-3xl font-serif italic text-white">Victory!</h2>
                
                <h3 className={`text-xl font-bold uppercase tracking-widest mt-2 ${
                  winner === 'Civilians' ? "text-emerald-400" :
                  winner === 'Spy' ? "text-red-400" : "text-amber-300"
                }`}>
                  {winner} Won the Game!
                </h3>
              </div>

              {/* Words Tally Card */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 shadow-lg space-y-3.5 my-4 flex-grow overflow-y-auto">
                <h4 className="text-xs font-bold text-[#998f81] uppercase tracking-wider border-b border-white/5 pb-2">Player Roles & Words Summary</h4>
                
                <div className="space-y-3">
                  {players.map(p => (
                    <div key={p.id} className="p-3 bg-black/30 border border-white/5 rounded-xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-bold">
                          {p.name[0]}
                        </div>
                        <div>
                          <span className="font-bold text-white/90">{p.name} {p.isBot && "🤖"}</span>
                          <span className={`block text-[9px] uppercase font-semibold ${
                            p.role === 'Civilian' ? "text-emerald-400" :
                            p.role === 'Spy' ? "text-red-400" : "text-amber-300"
                          }`}>
                            {p.role}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-white/60 block">Clue: <strong className="text-[var(--gold)]">"{p.clue || 'None'}"</strong></span>
                        <span className="text-[#998f81] text-[10px]">Word: <strong>"{p.word || '?'}"</strong></span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Mr White Guess Logs */}
                {mrWhiteGuess && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs">
                    <span className="font-bold text-amber-300 uppercase block mb-1">Mr. White Guess Result:</span>
                    Mr. White guessed: <strong className="text-white">"{mrWhiteGuess}"</strong>. 
                    Civilian Word was: <strong className="text-white">"{civilianWord}"</strong>.
                  </div>
                )}
              </div>

              <button
                onClick={startNewGame}
                className="w-full py-3.5 rounded-2xl bg-[var(--gold)] text-black font-bold text-sm tracking-wider uppercase transition-all shadow-md active:scale-95"
              >
                Play Again
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ──── SECRET REVEAL POPUP ──── */}
      {revealUserSecret && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex items-center justify-center p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[var(--bg-primary)] border border-white/10 p-8 rounded-3xl max-w-sm w-full text-center relative shadow-2xl"
          >
            <h3 className="text-lg font-bold text-white mb-2">Secret Identity Card</h3>
            <p className="text-xs text-[#998f81] mb-6">Apna secret word privately read karein:</p>

            <div className="p-6 rounded-2xl bg-black/40 border border-white/5 shadow-inner mb-6">
              <span className="text-[10px] font-bold text-[#998f81] uppercase tracking-widest block mb-2">Your Secret Word:</span>
              
              <span className="text-2xl font-serif italic text-[var(--gold)] tracking-wide font-black block">
                {revealUserSecret.word || "❓ (No Word)"}
              </span>
              
              <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border inline-block mt-4 ${
                revealUserSecret.role === 'Civilian' ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/20" :
                revealUserSecret.role === 'Spy' ? "text-red-400 bg-red-500/10 border-red-400/20" :
                "text-amber-300 bg-amber-500/10 border-amber-400/20"
              }`}>
                You are: {revealUserSecret.role}
              </span>
            </div>

            <button
              onClick={() => setRevealUserSecret(null)}
              className="px-6 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-[#998f81] hover:text-white transition-all uppercase"
            >
              I have seen it
            </button>
          </motion.div>
        </div>
      )}

    </div>
  );
}
