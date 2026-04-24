import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { Utensils, ShoppingCart, Trash2, ChevronRight, Clock, Flame, BookOpen, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ScrollArea } from '../../components/ui/scroll-area';

export function Cuisine() {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [shoppingLists, setShoppingLists] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'recipes' | 'shopping'>('recipes');

  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.currentUser) return;

    const rQ = query(collection(db, `users/${auth.currentUser.uid}/recipes`), orderBy('createdAt', 'desc'));
    const unsubscribeR = onSnapshot(rQ, (snap) => {
      setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const sQ = query(collection(db, `users/${auth.currentUser.uid}/shoppingLists`), orderBy('createdAt', 'desc'));
    const unsubscribeS = onSnapshot(sQ, (snap) => {
      setShoppingLists(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubscribeR();
      unsubscribeS();
    };
  }, []);

  const handleDeleteRecipe = async (id: string) => {
    if (!auth.currentUser) return;
    await deleteDoc(doc(db, `users/${auth.currentUser.uid}/recipes`, id));
  };

  const handleDeleteList = async (id: string) => {
    if (!auth.currentUser) return;
    await deleteDoc(doc(db, `users/${auth.currentUser.uid}/shoppingLists`, id));
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 pb-32">
        <header className="mb-8 pt-4">
          <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white mb-1">
            Cuisine <span className="text-orange-500">&</span> Liste
          </h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Alimentation intelligente par AthletIA</p>
        </header>

        <div className="flex p-1 bg-[#1A1C23] rounded-2xl border border-white/5 mb-8">
          <button 
            onClick={() => setActiveTab('recipes')}
            className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl transition-all ${activeTab === 'recipes' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400'}`}
          >
            <Utensils size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest">Recettes</span>
          </button>
          <button 
            onClick={() => setActiveTab('shopping')}
            className={`flex-1 flex items-center justify-center space-x-2 py-3 rounded-xl transition-all ${activeTab === 'shopping' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400'}`}
          >
            <ShoppingCart size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest">Courses</span>
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'recipes' ? (
            <motion.div 
              key="recipes"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              {recipes.length === 0 ? (
                <div className="bg-[#1A1C23] p-12 rounded-3xl border border-dashed border-white/10 text-center">
                  <BookOpen size={40} className="mx-auto text-slate-700 mb-4" />
                  <p className="text-sm text-slate-500 font-medium mb-6">Demande au Coach une recette adaptée à ton entraînement !</p>
                  <button 
                    onClick={() => navigate('/coach')}
                    className="bg-orange-500 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-orange-500/20 active:scale-95 transition-all"
                  >
                    Générer une suggestion ➔
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex justify-end mb-2">
                    <button 
                      onClick={() => navigate('/coach')}
                      className="text-[10px] font-bold text-orange-500 uppercase tracking-widest flex items-center"
                    >
                      Nouvelle suggestion <ChevronRight size={12} className="ml-1" />
                    </button>
                  </div>
                  {recipes.map(recipe => (
                    <div key={recipe.id} className="bg-[#1A1C23] border border-white/5 rounded-3xl p-6 relative group overflow-hidden">
                       <div className="absolute top-0 right-0 p-8 opacity-[0.02] transform translate-x-4 -translate-y-4">
                          <Utensils size={100} />
                       </div>
                       <div className="flex justify-between items-start mb-4 relative z-10">
                          <div className="bg-orange-500/10 text-orange-500 p-2 rounded-xl border border-orange-500/20">
                             <Utensils size={20} />
                          </div>
                          <button onClick={() => handleDeleteRecipe(recipe.id)} className="p-2 text-slate-600 hover:text-red-500 transition-colors">
                             <Trash2 size={16} />
                          </button>
                       </div>
                       <h3 className="text-xl font-black italic text-white uppercase tracking-tighter mb-2">{recipe.title}</h3>
                       <div className="flex items-center space-x-4 mb-4">
                          <div className="flex items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                             <Flame size={12} className="mr-1 text-orange-500" />
                             {recipe.calories} kcal
                          </div>
                       </div>
                       <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-4 mb-6">
                          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1 flex items-center">
                             <BookOpen size={10} className="mr-1" /> Pourquoi ?
                          </p>
                          <p className="text-xs text-blue-200/70 leading-relaxed italic">"{recipe.reason}"</p>
                       </div>

                       <div className="space-y-4">
                          <div>
                             <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ingrédients</h4>
                             <p className="text-xs text-slate-300 leading-loose whitespace-pre-line">{recipe.ingredients}</p>
                          </div>
                          <div>
                             <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Préparation</h4>
                             <p className="text-xs text-slate-300 leading-loose whitespace-pre-line">{recipe.instructions}</p>
                          </div>
                       </div>
                    </div>
                  ))}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="shopping"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              {shoppingLists.length === 0 ? (
                <div className="bg-[#1A1C23] p-12 rounded-3xl border border-dashed border-white/10 text-center">
                  <ShoppingCart size={40} className="mx-auto text-slate-700 mb-4" />
                  <p className="text-sm text-slate-500 font-medium mb-6">L'IA peut générer ta liste de courses basée sur ton planning.</p>
                  <button 
                    onClick={() => navigate('/coach')}
                    className="bg-orange-500 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-orange-500/20 active:scale-95 transition-all"
                  >
                    Générer ma liste ➔
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex justify-end mb-2">
                    <button 
                      onClick={() => navigate('/coach')}
                      className="text-[10px] font-bold text-orange-500 uppercase tracking-widest flex items-center"
                    >
                      Mettre à jour <ChevronRight size={12} className="ml-1" />
                    </button>
                  </div>
                  {shoppingLists.map(list => (
                    <div key={list.id} className="bg-[#1A1C23] border border-white/5 rounded-3xl p-6">
                       <div className="flex justify-between items-start mb-4">
                          <h3 className="text-lg font-black italic text-white uppercase tracking-tighter">{list.title}</h3>
                          <button onClick={() => handleDeleteList(list.id)} className="p-2 text-slate-600 hover:text-red-500 transition-colors">
                             <Trash2 size={16} />
                          </button>
                       </div>
                       <div className="bg-[#0F1115] border border-white/5 rounded-2xl p-4 mb-4">
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Articles</p>
                          <p className="text-xs text-slate-300 leading-loose whitespace-pre-line">{list.items}</p>
                       </div>
                       {list.nutritionalInfo && (
                          <div className="bg-orange-500/5 border border-orange-500/10 rounded-2xl p-4">
                             <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1 flex items-center">
                                <Zap size={10} className="mr-1" /> Focus Nutritionnel
                             </p>
                             <p className="text-xs text-orange-200/70 leading-relaxed italic">{list.nutritionalInfo}</p>
                          </div>
                       )}
                    </div>
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ScrollArea>
  );
}
