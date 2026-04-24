import { useState, useRef, useEffect } from 'react';
import { Camera, Plus, Activity as ActivityIcon, Utensils, X, Image as ImageIcon, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { GoogleGenAI, Type } from '@google/genai';
import { generateContentWithRetry } from '../lib/aiUtils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

import { ScrollArea } from '../../components/ui/scroll-area';

export function Journal() {
  const [tab, setTab] = useState<'sport' | 'nutrition' | 'events'>('sport');
  const [meals, setMeals] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingMeal, setEditingMeal] = useState<any>(null);
  const [itemToDelete, setItemToDelete] = useState<{collectionName: string, id: string} | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);

  const handleUpdateMeal = async (updatedMeal: any) => {
    if (!auth.currentUser) return;
    try {
      const { id, ...data } = updatedMeal;
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/meals`, id), data);
      setEditingMeal(null);
    } catch (err) { console.error("Erreur mise à jour repas:", err); }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const mealsQ = query(collection(db, `users/${auth.currentUser.uid}/meals`), orderBy('recordedAt', 'desc'));
    const unSubMeals = onSnapshot(mealsQ, (snap) => setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    const actQ = query(collection(db, `users/${auth.currentUser.uid}/activities`), orderBy('recordedAt', 'desc'));
    const unSubAct = onSnapshot(actQ, (snap) => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    const evQ = query(collection(db, `users/${auth.currentUser.uid}/events`), orderBy('date', 'asc'));
    const unSubEv = onSnapshot(evQ, (snap) => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => { unSubMeals(); unSubAct(); unSubEv(); };
  }, []);

  const handleDeleteItem = (collectionName: string, id: string) => {
    setItemToDelete({ collectionName, id });
  };

  const confirmDelete = async () => {
    if (!auth.currentUser || !itemToDelete) return;
    try {
      await deleteDoc(doc(db, `users/${auth.currentUser.uid}/${itemToDelete.collectionName}`, itemToDelete.id));
      setItemToDelete(null);
    } catch (error) { console.error('Erreur :', error); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzingImage(true);
    setIsAdding(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = (event.target?.result as string).split(',')[1];
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const responseData = await generateContentWithRetry(ai, {
          model: "gemini-3-flash-preview",
          contents: {
            parts: [
              { inlineData: { mimeType: file.type, data: base64Data } },
              { text: "Analyse cette image de repas. Réponds IMPÉRATIVEMENT EN FRANÇAIS. Fournis une courte description du plat (ex: Salade de poulet), estime le poids total de l'assiette en grammes (au moins 100), et donne les totaux nutritionnels (calories, protéines en g, glucides en g, lipides en g)." }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
               type: Type.OBJECT,
               properties: {
                 description: { type: Type.STRING },
                 weightInGrams: { type: Type.NUMBER },
                 calories: { type: Type.NUMBER },
                 proteins: { type: Type.NUMBER },
                 carbs: { type: Type.NUMBER },
                 fats: { type: Type.NUMBER }
               },
               required: ["description", "weightInGrams", "calories", "proteins", "carbs", "fats"]
            }
          }
        });

        const result = JSON.parse(responseData.text.trim());
        if (auth.currentUser) {
          await addDoc(collection(db, `users/${auth.currentUser.uid}/meals`), {
             description: result.description,
             weightInGrams: result.weightInGrams || 250,
             calories: result.calories,
             proteins: result.proteins,
             carbs: result.carbs,
             fats: result.fats,
             imageUrl: "analyzed by AI", 
             recordedAt: new Date().toISOString()
          });
        }
      } catch (err) {
         console.error("Error analyzing image:", err);
         alert("Désolé, je n'ai pas pu analyser ce repas.");
      } finally {
        setAnalyzingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleManualSportSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
       if (auth.currentUser) {
          await addDoc(collection(db, `users/${auth.currentUser.uid}/activities`), {
             name: formData.get('name') as string,
             sportType: formData.get('sportType') as string,
             source: 'manual',
             duration: parseInt(formData.get('duration') as string),
             intensity: formData.get('intensity') as string,
             recordedAt: new Date().toISOString()
          });
          setIsAdding(false);
       }
    } catch(err) { console.error("Error adding activity", err); }
  };

  const handleEventSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
       if (auth.currentUser) {
          await addDoc(collection(db, `users/${auth.currentUser.uid}/events`), {
             title: formData.get('title') as string,
             type: formData.get('type') as string,
             date: formData.get('date') as string,
             notes: formData.get('notes') as string || "",
             createdAt: new Date().toISOString()
          });
          setIsAdding(false);
       }
    } catch(err) { console.error("Error adding event", err); }
  };

  return (
    <div className="flex flex-col h-full pt-6">
      <div className="flex items-center justify-between mb-8 px-6">
        <div>
          <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white">Journal</h1>
          <h2 className="text-sm font-bold text-orange-500 uppercase tracking-widest mt-1">{format(new Date(), 'EEEE d MMM', {locale: fr})}</h2>
        </div>
        <motion.button 
          whileHover={{ scale: 1.1, rotate: 180 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          onClick={() => setIsAdding(true)}
          className="w-14 h-14 bg-gradient-to-tr from-orange-500 to-red-500 text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.4)]"
        >
          <Plus size={28} />
        </motion.button>
      </div>
      
      {/* Tab Nav */}
      <div className="flex space-x-2 bg-[#1A1C23] p-1.5 rounded-2xl mb-2 mx-6 border border-white/5 relative shrink-0">
        {(['sport', 'nutrition', 'events'] as const).map((t) => (
          <button 
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 px-2 text-[11px] uppercase tracking-wider font-bold rounded-xl transition relative z-10 ${tab === t ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {tab === t && (
              <motion.div
                layoutId="journal-tab"
                className="absolute inset-0 bg-[#2A2D35] rounded-xl shadow-sm border border-white/10"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-20">
              {t === 'sport' ? 'Training' : t === 'nutrition' ? 'Nutrition' : 'Events'}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {analyzingImage && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-gradient-to-r from-orange-500/20 to-red-500/10 p-4 mx-6 mt-4 rounded-2xl mb-6 border border-orange-500/30 flex items-center space-x-4 shrink-0"
          >
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500/30 border-t-orange-500"></div>
            <span className="text-sm font-bold text-orange-400 uppercase tracking-wide">Analyse IA en cours...</span>
          </motion.div>
        )}
      </AnimatePresence>

      <ScrollArea className="flex-1 shrink-0 overflow-y-auto">
        <div className="space-y-4 px-6 pb-6 pt-2">
          <AnimatePresence mode="popLayout">
          {tab === 'sport' ? (
             activities.length === 0 ? (
               <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-slate-600 italic text-center py-10 uppercase tracking-widest font-bold">AUCUNE SESSION MANUELLE</motion.p>
             ) : (
               activities.map((act, i) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05 }}
                    key={act.id} 
                    className="bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex flex-col relative group"
                  >
                    <div className="flex items-center justify-between z-10 relative">
                      <div className="flex-1">
                        <h3 className="font-bold text-white text-sm tracking-tight">{act.name}</h3>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-1">{act.sportType} <span className="text-orange-500">•</span> {act.intensity} {act.distance ? `• ${act.distance.toFixed(1)} km` : ''}</p>
                      </div>
                      <div className="text-right flex items-center space-x-4">
                        <span className="block font-black text-xl italic tracking-tighter text-white">{act.duration} <span className="text-[10px] text-slate-500">MIN</span></span>
                        <button onClick={() => handleDeleteItem('activities', act.id)} className="text-slate-600 hover:text-red-500 transition-colors">
                           <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    {act.insights && (
                      <div className="mt-3 pt-3 border-t border-white/5 z-10 relative">
                        <div className="flex items-center space-x-2 text-cyan-400 mb-1">
                          <span className="text-[9px] font-black uppercase tracking-widest bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">Coach IA</span>
                        </div>
                        <p className="text-xs text-slate-300 font-medium leading-relaxed">{act.insights}</p>
                      </div>
                    )}
                  </motion.div>
               ))
             )
          ) : tab === 'nutrition' ? (
             meals.length === 0 ? (
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
                 <div className="w-20 h-20 bg-[#1A1C23] rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                   <Utensils size={32} className="text-slate-600" />
                 </div>
                 <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Scanne ton prochain repas</p>
               </motion.div>
             ) : (
               meals.map((meal, i) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05 }}
                    key={meal.id} 
                    onClick={() => setEditingMeal(meal)}
                    className="bg-[#1A1C23] p-5 rounded-3xl border border-white/5 relative group cursor-pointer hover:border-orange-500/30 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <p className="text-sm font-medium text-slate-300 leading-relaxed flex-1 pr-4">{meal.description}</p>
                      <div className="flex items-center space-x-3 shrink-0">
                        <span className="font-black italic tracking-tighter text-orange-500 text-xl">{meal.calories} <span className="text-[10px] text-slate-500 uppercase">Kcal</span></span>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteItem('meals', meal.id); }} className="text-slate-600 hover:text-red-500 transition-colors p-2 -mr-2">
                           <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="flex space-x-2 text-[10px] uppercase font-bold tracking-widest border-t border-white/5 pt-4">
                      <span className="bg-white/5 px-2 py-1 rounded text-slate-300">PRO <span className="text-white">{meal.proteins}g</span></span>
                      <span className="bg-white/5 px-2 py-1 rounded text-slate-300">GLU <span className="text-white">{meal.carbs}g</span></span>
                      <span className="bg-white/5 px-2 py-1 rounded text-slate-300">LIP <span className="text-white">{meal.fats}g</span></span>
                    </div>
                  </motion.div>
               ))
             )
          ) : (
             events.length === 0 ? (
               <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-slate-600 italic text-center py-10 uppercase tracking-widest font-bold">AUCUN OBJECTIF FIXÉ</motion.p>
             ) : (
               events.map((ev, i) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05 }}
                    key={ev.id} 
                    className="bg-[#1A1C23] p-5 rounded-2xl border border-white/5 flex items-start justify-between relative overflow-hidden group"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-orange-500 to-red-500 block"></div>
                    <div className="flex-1 pl-3">
                      <h3 className="font-bold text-white tracking-tight">{ev.title}</h3>
                      <p className="text-[11px] font-black uppercase tracking-widest text-[#FC4C02] mb-2 mt-1">{format(new Date(ev.date), 'dd MMM yyyy', {locale: fr})}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest inline-block border border-slate-700 px-2 py-0.5 rounded mr-2">{ev.type}</p>
                      {ev.notes && <p className="text-xs text-slate-400 mt-3 font-medium leading-relaxed bg-[#0F1115] p-3 rounded-xl border border-white/5">{ev.notes}</p>}
                    </div>
                    <button onClick={() => handleDeleteItem('events', ev.id)} className="text-slate-600 hover:text-red-500 transition-colors ml-4 shrink-0 mt-1">
                       <Trash2 size={18} />
                    </button>
                  </motion.div>
               ))
             )
          )}
          </AnimatePresence>
        </div>
      </ScrollArea>

      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end"
          >
            <motion.div 
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[#1A1C23] border-t border-white/10 rounded-t-[40px] w-full max-h-[85vh] overflow-y-auto p-8 pb-32"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="font-black text-2xl italic tracking-tighter uppercase text-white">Ajout</h3>
                <button onClick={() => setIsAdding(false)} className="bg-white/5 p-3 rounded-full text-slate-400 hover:text-white transition"><X size={24}/></button>
              </div>
              
              {tab === 'nutrition' ? (
                 <div className="space-y-4">
                   <button 
                     onClick={() => fileInputRef.current?.click()}
                     className="w-full flex flex-col items-center justify-center p-10 border border-white/10 rounded-3xl bg-gradient-to-br from-orange-500/10 to-red-500/5 hover:from-orange-500/20 hover:to-red-500/10 transition-colors text-orange-500 group"
                   >
                     <Camera size={48} className="mb-4 group-hover:scale-110 transition-transform duration-300" />
                     <span className="font-black uppercase tracking-wider text-sm">SCAN IA REPAS</span>
                   </button>
                   <input 
                     type="file" accept="image/*" capture="environment" ref={fileInputRef} className="hidden" 
                     onChange={handleImageUpload} 
                   />
                 </div>
              ) : tab === 'sport' ? (
                 <form onSubmit={handleManualSportSubmit} className="space-y-5">
                   <div>
                     <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Activité</label>
                     <input required name="name" type="text" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors" placeholder="Ex: Leg Day" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Type</label>
                       <select required name="sportType" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors appearance-none">
                          <option value="Workout">Entraînement</option>
                          <option value="WeightTraining">Musculation</option>
                          <option value="Crossfit">Crossfit/HYROX</option>
                          <option value="Other">Autre</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Durée (min)</label>
                       <input required name="duration" type="number" min="1" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors" placeholder="45" />
                     </div>
                   </div>
                   <div>
                     <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Intensité</label>
                     <select required name="intensity" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors appearance-none">
                        <option value="Légère">Légère</option>
                        <option value="Modérée">Modérée</option>
                        <option value="Intense">Intense</option>
                        <option value="Extrême">Z4/Z5 (Extrême)</option>
                     </select>
                   </div>
                   <button type="submit" className="w-full bg-[#FC4C02] text-white font-black uppercase tracking-widest py-5 rounded-xl mt-6 shadow-[0_0_20px_rgba(252,76,2,0.3)] hover:bg-orange-600 transition-colors">SAUVEGARDER</button>
                 </form>
              ) : (
                 <form onSubmit={handleEventSubmit} className="space-y-5">
                   <div>
                     <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Mission</label>
                     <input required name="title" type="text" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors" placeholder="Ex: Semi de Paris" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Date</label>
                       <input required name="date" type="date" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-slate-400 focus:outline-none focus:border-orange-500 transition-colors [color-scheme:dark]" />
                     </div>
                     <div>
                       <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Type</label>
                       <select required name="type" className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors appearance-none">
                          <option value="Compétition">Race Day</option>
                          <option value="Match">Match</option>
                          <option value="Objectif Perso">PR / Objectif</option>
                          <option value="Autre">Autre</option>
                       </select>
                     </div>
                   </div>
                   <div>
                     <label className="text-[10px] font-bold uppercase tracking-widest text-[#FC4C02] pl-1">Stratégie / Notes</label>
                     <textarea name="notes" rows={2} className="w-full mt-2 bg-[#0F1115] border border-white/10 rounded-xl px-5 py-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors placeholder-slate-600" placeholder="Ex: Sub 2h, gel au km 10"></textarea>
                   </div>
                   <button type="submit" className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-black uppercase tracking-widest py-5 rounded-xl mt-6 shadow-[0_0_20px_rgba(249,115,22,0.4)] hover:opacity-90 transition-opacity">VERROUILLER L'OBJECTIF</button>
                 </form>
              )}
            </motion.div>
          </motion.div>
        )}
        {editingMeal && (
          <MealEditorModal 
            meal={editingMeal} 
            onClose={() => setEditingMeal(null)} 
            onSave={handleUpdateMeal}
          />
        )}
        
        {itemToDelete && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1A1C23] border border-white/10 rounded-3xl w-full max-w-sm p-6 text-center"
            >
              <Trash2 size={48} className="mx-auto text-red-500 mb-4 opacity-80" />
              <h3 className="font-black text-xl tracking-tight text-white mb-2">Supprimer l'entrée ?</h3>
              <p className="text-sm text-slate-400 mb-6 font-medium">Cette action est définitive. Impossible de revenir en arrière.</p>
              <div className="flex space-x-3">
                <button onClick={() => setItemToDelete(null)} className="flex-1 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] text-slate-300 bg-white/5 hover:bg-white/10 transition border border-white/5">Annuler</button>
                <button onClick={confirmDelete} className="flex-1 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] text-white bg-red-500 hover:bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.4)] transition">Supprimer</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MealEditorModal({ meal, onClose, onSave }: any) {
  const dbWeight = meal.weightInGrams || 250;
  const [weight, setWeight] = useState(dbWeight);

  const factor = weight / dbWeight;
  const c = Math.round(meal.calories * factor);
  const p = Math.round(meal.proteins * factor);
  const g = Math.round(meal.carbs * factor);
  const l = Math.round(meal.fats * factor);

  const data = [
    { name: 'Protéines', value: p, color: '#0ea5e9' },
    { name: 'Glucides', value: g, color: '#eab308' },
    { name: 'Lipides', value: l, color: '#f97316' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end"
    >
      <motion.div 
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-[#1A1C23] border-t border-white/10 rounded-t-[40px] w-full max-h-[90vh] overflow-y-auto p-8 pb-32"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-black text-xl tracking-tight text-white flex-1 pr-4">{meal.description}</h3>
          <button onClick={onClose} className="bg-white/5 p-2 rounded-full text-slate-400 hover:text-white transition"><X size={20}/></button>
        </div>

        <div className="bg-[#0F1115] rounded-3xl p-6 border border-white/5 mb-6">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} stroke="none">
                  {data.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1A1C23', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                  itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                  formatter={(val: any) => [`${val}g`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div className="flex justify-center space-x-6 mt-4">
            <div className="flex flex-col items-center"><span className="w-3 h-3 rounded-full bg-[#0ea5e9] mb-1"></span><span className="text-xs font-bold text-white">{p}g</span><span className="text-[10px] text-slate-500 uppercase">PRO</span></div>
            <div className="flex flex-col items-center"><span className="w-3 h-3 rounded-full bg-[#eab308] mb-1"></span><span className="text-xs font-bold text-white">{g}g</span><span className="text-[10px] text-slate-500 uppercase">GLU</span></div>
            <div className="flex flex-col items-center"><span className="w-3 h-3 rounded-full bg-[#f97316] mb-1"></span><span className="text-xs font-bold text-white">{l}g</span><span className="text-[10px] text-slate-500 uppercase">LIP</span></div>
          </div>
        </div>

        <div className="mb-8 pl-1 pr-1">
          <div className="flex justify-between items-center mb-4">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Poids Estimé</label>
            <span className="text-orange-500 font-bold text-xl">{weight} <span className="text-sm">g</span></span>
          </div>
          <input 
            type="range" 
            min={Math.round(dbWeight * 0.2)} 
            max={Math.round(dbWeight * 3)} 
            step={5}
            value={weight} 
            onChange={(e) => setWeight(parseInt(e.target.value))}
            className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer mb-2"
          />
          <div className="flex justify-between text-[10px] font-bold text-slate-500">
            <span>Moins</span>
            <span className="text-white bg-white/5 py-1 px-3 rounded-full border border-white/5">{c} KCAL</span>
            <span>Plus</span>
          </div>
        </div>

        <button 
          onClick={() => onSave({ ...meal, weightInGrams: weight, calories: c, proteins: p, carbs: g, fats: l })}
          className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white font-black uppercase tracking-widest py-5 rounded-xl shadow-[0_0_20px_rgba(249,115,22,0.4)] hover:opacity-90 transition-opacity"
        >
          METTRE À JOUR
        </button>
      </motion.div>
    </motion.div>
  )
}
