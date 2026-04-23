import { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, getDocs, limit, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Send, Bot, Loader2, Mic, Volume2, Square, Zap } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

import { ScrollArea } from '../../components/ui/scroll-area';

export function Coach() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, `users/${auth.currentUser.uid}/chatHistory`), 
      orderBy('createdAt', 'asc')
    );
    const unSub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unSub();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if ((window as any).__currentAudioSource) {
        try { (window as any).__currentAudioSource.stop(); } catch(e) {}
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("La saisie vocale n'est pas supportée sur ce navigateur.");
      return;
    }

    if (isListening) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => prev + (prev ? " " : "") + transcript);
      setIsListening(false);
    };
    
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };
    
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  const playAudio = async (text: string, messageId: string) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!(window as any).__audioCtx) {
      (window as any).__audioCtx = new AudioContextClass();
    }
    const audioCtx = (window as any).__audioCtx;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    try {
      const unlockSource = audioCtx.createBufferSource();
      unlockSource.buffer = audioCtx.createBuffer(1, 1, 24000);
      unlockSource.connect(audioCtx.destination);
      unlockSource.start(0);
    } catch(e) {}

    if (playingId === messageId || loadingAudioId === messageId) {
      if ((window as any).__currentAudioSource) {
        try { (window as any).__currentAudioSource.stop(); } catch(e) {}
        (window as any).__currentAudioSource = null;
      }
      setPlayingId(null);
      setLoadingAudioId(null);
      (window as any).__requestedAudioId = null;
      window.speechSynthesis.cancel();
      return;
    }

    if ((window as any).__currentAudioSource) {
      try { (window as any).__currentAudioSource.stop(); } catch(e) {}
      (window as any).__currentAudioSource = null;
    }
    window.speechSynthesis.cancel();

    setPlayingId(null);
    setLoadingAudioId(messageId);
    (window as any).__requestedAudioId = messageId;
    
    try {
      const cleanText = text
        .replace(/[#*`_]/g, '')
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, '');

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const fetchAudio = ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          },
        },
      });

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout TTS")), 40000));
      const response = await Promise.race([fetchAudio, timeoutPromise]) as any;

      if ((window as any).__requestedAudioId !== messageId) return;

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Audio nul");

      setLoadingAudioId(null);
      setPlayingId(messageId);

      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      const sampleCount = bytes.length / 2;
      const audioBuffer = audioCtx.createBuffer(1, sampleCount, 24000);
      const channelData = audioBuffer.getChannelData(0);
      const dataView = new DataView(bytes.buffer);
      
      for (let i = 0; i < sampleCount; i++) {
         channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
      
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.onended = () => {
           if ((window as any).__requestedAudioId === messageId) {
              setPlayingId(null);
           }
      };
      source.start();
      (window as any).__currentAudioSource = source;

    } catch (err) {
      console.error("TTS Error:", err);
      if ((window as any).__requestedAudioId === messageId) {
        setLoadingAudioId(null);
        setPlayingId(messageId); 
        window.speechSynthesis.cancel();
        
        const fbText = text.replace(/[#*`_]/g, ''); 
        const msg = new SpeechSynthesisUtterance(fbText);
        msg.lang = 'fr-FR';
        msg.onend = () => setPlayingId(null);
        msg.onerror = () => setPlayingId(null);
        window.speechSynthesis.speak(msg);
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !auth.currentUser) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      await addDoc(collection(db, `users/${auth.currentUser.uid}/chatHistory`), {
        role: 'user',
        text: userMessage,
        createdAt: new Date().toISOString()
      });

      const mealsSnap = await getDocs(query(collection(db, `users/${auth.currentUser.uid}/meals`), orderBy('recordedAt', 'desc'), limit(5)));
      const meals = mealsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const actSnap = await getDocs(query(collection(db, `users/${auth.currentUser.uid}/activities`), orderBy('recordedAt', 'desc'), limit(5)));
      const activities = actSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const eventsSnap = await getDocs(query(collection(db, `users/${auth.currentUser.uid}/events`), orderBy('date', 'asc'), limit(5)));
      const upcomingEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((e: any) => new Date(e.date) >= new Date(new Date().setHours(0,0,0,0)));

      const contextData = {
        recentMeals: meals,
        recentActivities: activities,
        upcomingGoalsAndEvents: upcomingEvents
      };

      const systemInstruction = `Tu es AthletIA, un coach sportif et nutritionnel motivant. Tu réponds de manière courte, percutante et amicale. Tu peux désormais interagir avec le journal de l'utilisateur.
Voici le contexte de l'utilisateur (ses repas, activités récentes, et objectifs, avec leurs IDs respectifs) :
${JSON.stringify(contextData)}

Utilise ce contexte pour répondre intelligemment à ses questions. S'il te demande d'ajouter, modifier ou supprimer un repas, un entraînement (activité) ou un objectif, tu DOIS utiliser les outils (functions) à ta disposition. Pour les fonctions de modification/suppression, cherche l'ID exact dans le contexte fourni. S'il dit "je viens de courir", utilise l'outil pour l'ajouter, puis félicite-le. Prends en compte ses futurs objectifs pour tes conseils. 
IMPORTANT: Pour éviter que la voix ne soit trop longue à générer, tu dois IMPÉRATIVEMENT répondre de manière EXTRÊMEMENT COURTE (1 à 2 phrases MAXIMUM). Va droit au but. N'utilise JAMAIS d'emojis.`;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const tools = [{
        functionDeclarations: [
          {
            name: "add_meal",
            description: "Ajoute un repas au journal. Utilise cette fonction si l'utilisateur te demande d'ajouter ce qu'il a mangé.",
            parameters: { type: Type.OBJECT, properties: { description: {type: Type.STRING}, calories: {type: Type.NUMBER}, proteins: {type: Type.NUMBER}, carbs: {type: Type.NUMBER}, fats: {type: Type.NUMBER}, weightInGrams: {type: Type.NUMBER} }, required: ["description", "calories", "proteins", "carbs", "fats"] }
          },
          {
            name: "update_meal",
            description: "Modifie un repas existant. Nécessite l'ID du repas.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, description: {type: Type.STRING}, calories: {type: Type.NUMBER}, proteins: {type: Type.NUMBER}, carbs: {type: Type.NUMBER}, fats: {type: Type.NUMBER}, weightInGrams: {type: Type.NUMBER} }, required: ["id"] }
          },
          {
            name: "delete_meal",
            description: "Supprime un repas. Nécessite l'ID du repas.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING} }, required: ["id"] }
          },
          {
            name: "add_activity",
            description: "Ajoute un entraînement/activité sportive.",
            parameters: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, sportType: {type: Type.STRING, description: "Workout, WeightTraining, Crossfit, ou Other"}, duration: {type: Type.NUMBER, description: "Durée en minutes"}, intensity: {type: Type.STRING, description: "Légère, Modérée, Intense ou Extrême"} }, required: ["name", "sportType", "duration", "intensity"] }
          },
          {
            name: "update_activity",
            description: "Modifie un entraînement existant. Nécessite l'ID.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, name: {type: Type.STRING}, sportType: {type: Type.STRING}, duration: {type: Type.NUMBER}, intensity: {type: Type.STRING} }, required: ["id"] }
          },
          {
            name: "delete_activity",
            description: "Supprime un entraînement via son ID.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING} }, required: ["id"] }
          },
          {
            name: "add_event",
            description: "Ajoute un événement ou objectif (course, compétition).",
            parameters: { type: Type.OBJECT, properties: { title: {type: Type.STRING}, date: {type: Type.STRING, description: "Format YYYY-MM-DD"}, type: {type: Type.STRING, description: "Compétition, Match, Objectif Perso, Autre"}, notes: {type: Type.STRING} }, required: ["title", "date", "type"] }
          },
          {
            name: "update_event",
            description: "Modifie un événement ou objectif. Nécessite son ID.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING}, title: {type: Type.STRING}, date: {type: Type.STRING}, type: {type: Type.STRING}, notes: {type: Type.STRING} }, required: ["id"] }
          },
          {
            name: "delete_event",
            description: "Supprime un événement ou objectif via son ID.",
            parameters: { type: Type.OBJECT, properties: { id: {type: Type.STRING} }, required: ["id"] }
          }
        ]
      }];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: userMessage,
        config: { systemInstruction, tools }
      });

      let aiText = response.text || "";

      if (response.functionCalls && response.functionCalls.length > 0) {
         for (const call of response.functionCalls) {
            const args = call.args as any;
            try {
               switch(call.name) {
                 case 'add_meal':
                   await addDoc(collection(db, `users/${auth.currentUser.uid}/meals`), { ...args, imageUrl: "ajouté par coach", recordedAt: new Date().toISOString() });
                   break;
                 case 'update_meal':
                   const { id: mId, ...mData } = args;
                   if (Object.keys(mData).length > 0) await updateDoc(doc(db, `users/${auth.currentUser.uid}/meals`, mId), mData);
                   break;
                 case 'delete_meal':
                   await deleteDoc(doc(db, `users/${auth.currentUser.uid}/meals`, args.id));
                   break;
                 case 'add_activity':
                   await addDoc(collection(db, `users/${auth.currentUser.uid}/activities`), { ...args, source: "manual", recordedAt: new Date().toISOString() });
                   break;
                 case 'update_activity':
                   { const { id: aId, ...aData } = args;
                     if (Object.keys(aData).length > 0) await updateDoc(doc(db, `users/${auth.currentUser.uid}/activities`, aId), aData); }
                   break;
                 case 'delete_activity':
                   await deleteDoc(doc(db, `users/${auth.currentUser.uid}/activities`, args.id));
                   break;
                 case 'add_event':
                   await addDoc(collection(db, `users/${auth.currentUser.uid}/events`), { ...args, createdAt: new Date().toISOString() });
                   break;
                 case 'update_event':
                   { const { id: eId, ...eData } = args;
                     if (Object.keys(eData).length > 0) await updateDoc(doc(db, `users/${auth.currentUser.uid}/events`, eId), eData); }
                   break;
                 case 'delete_event':
                   await deleteDoc(doc(db, `users/${auth.currentUser.uid}/events`, args.id));
                   break;
               }
            } catch (err) { console.error("Error executing function call:", err); }
         }
         
         if (!aiText) {
             aiText = "J'ai bien pris en compte ta demande et mis à jour ton journal ! 💪";
         }
      }

      if (!aiText) aiText = "Opération effectuée !";

      await addDoc(collection(db, `users/${auth.currentUser.uid}/chatHistory`), {
        role: 'model',
        text: aiText,
        createdAt: new Date().toISOString()
      });

    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0F1115] relative">
      <header className="p-5 bg-[#1A1C23]/80 backdrop-blur-md border-b border-white/5 flex items-center space-x-4 shrink-0 z-10 sticky top-0">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center text-white shadow-[0_0_15px_rgba(249,115,22,0.4)] ring-2 ring-white/10">
          <Zap size={24} className={isLoading ? "animate-pulse" : ""} />
        </div>
        <div>
          <h1 className="font-black italic uppercase tracking-tighter text-white text-xl">AthletIA</h1>
          <div className="flex items-center mt-1">
            <span className="w-2 h-2 rounded-full bg-cyan-500 mr-2 shadow-[0_0_8px_rgba(6,182,212,0.8)] animate-pulse"></span>
            <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">Connecté</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto w-full bg-[#0F1115] shrink">
        <div className="p-4 space-y-6">
          {messages.length === 0 && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center h-full text-center p-6 opacity-80 mt-10">
               <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6">
                 <Zap size={48} className="text-orange-500/50" />
               </div>
               <p className="text-sm font-bold text-slate-400 uppercase tracking-widest leading-relaxed">Prêt pour l'entraînement. <br/>Pose tes questions ou debrief ta session.</p>
            </motion.div>
          )}
          
          <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const isModel = msg.role === 'model';
            const isPlaying = playingId === msg.id;
            const isLoadingAudio = loadingAudioId === msg.id;
            
            return (
              <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 250, damping: 20 }}
                key={msg.id} 
                className={`flex ${isModel ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-[85%] rounded-3xl p-5 relative group ${isModel ? 'bg-[#1A1C23] border border-white/5 text-slate-200 shadow-xl' : 'bg-gradient-to-tr from-[#FC4C02] to-red-500 text-white shadow-[0_5px_20px_rgba(252,76,2,0.3)]'}`}>
                  <div className={`text-sm markdown-body prose prose-sm prose-p:leading-relaxed prose-p:mb-2 max-w-none ${isModel ? 'prose-invert' : 'text-white'}`}>
                    <Markdown>{msg.text}</Markdown>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <span className={`text-[9px] font-bold tracking-widest uppercase ${isModel ? 'text-slate-500' : 'text-orange-200'}`}>
                      {new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                    
                    {isModel && (
                      <button 
                        onClick={() => playAudio(msg.text, msg.id)}
                        className="ml-3 text-slate-500 hover:text-orange-500 transition-colors bg-white/5 p-2 rounded-full"
                        title={isPlaying ? "Arrêter" : (isLoadingAudio ? "Chargement..." : "Écouter")}
                      >
                        {isLoadingAudio ? (
                          <Loader2 size={14} className="animate-spin text-orange-500" />
                        ) : isPlaying ? (
                          <div className="flex items-center space-x-1">
                            <span className="w-1 h-3 bg-orange-500 animate-pulse rounded-full"></span>
                            <span className="w-1 h-3 bg-orange-500 animate-pulse rounded-full delay-75"></span>
                            <span className="w-1 h-3 bg-orange-500 animate-pulse rounded-full delay-150"></span>
                          </div>
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
          </AnimatePresence>
          
          <AnimatePresence>
          {isLoading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="flex justify-start">
              <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-5 flex items-center space-x-3">
                <Loader2 size={18} className="animate-spin text-[#FC4C02]" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Analyse...</span>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
          <div ref={messagesEndRef} className="h-4 pb-12" />
        </div>
      </div>

      <div className="p-4 bg-[#1A1C23] border-t border-white/5 shrink-0 z-10 sticky bottom-0">
        <form onSubmit={handleSend} className="flex items-center space-x-3 relative">
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            type="button" 
            onClick={handleVoiceInput}
            title="Saisie vocale"
            className={`w-12 h-12 flex shrink-0 items-center justify-center rounded-full transition-colors relative z-20 ${isListening ? 'bg-red-500/20 text-red-500' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            {isListening && <span className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping opacity-50"></span>}
            <Mic size={20} />
          </motion.button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? "Parlez maintenant..." : "Message pour AthletIA..."}
            className="flex-1 bg-[#0F1115] border border-white/10 rounded-full px-6 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors shadow-inner"
          />
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            type="submit" 
            disabled={!input.trim() || isLoading}
            className="w-12 h-12 flex shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white disabled:opacity-50 shadow-[0_0_15px_rgba(249,115,22,0.4)]"
          >
            <Send size={18} className="translate-x-[1px]" />
          </motion.button>
        </form>
      </div>
    </div>
  );
}
