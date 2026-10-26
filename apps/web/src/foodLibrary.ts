/** Fondal Fit educational food library. Approximate per-100g values, NOT laboratory nutrition analysis. */
export type Food={id:string;name:string;kcal:number;protein:number;carbs:number;fat:number;group:'protein'|'carb'|'vegetable'|'fat'};
export type Portion={id:string;grams:number};
export type Meal={id:string;title:string;ingredients:Portion[];tags:string[]};
export const FOODS:Food[]=[
{id:'chicken',name:'Pollo cocido',kcal:165,protein:31,carbs:0,fat:3.6,group:'protein'},
{id:'beef',name:'Carne vacuna magra',kcal:210,protein:28,carbs:0,fat:11,group:'protein'},
{id:'fish',name:'Pescado blanco',kcal:110,protein:23,carbs:0,fat:2,group:'protein'},
{id:'eggs',name:'Huevo entero',kcal:143,protein:13,carbs:1,fat:10,group:'protein'},
{id:'lentils',name:'Lentejas cocidas',kcal:116,protein:9,carbs:20,fat:0.4,group:'protein'},
{id:'rice',name:'Arroz cocido',kcal:130,protein:2.7,carbs:28,fat:0.3,group:'carb'},
{id:'potato',name:'Papa hervida',kcal:87,protein:1.9,carbs:20,fat:0.1,group:'carb'},
{id:'quinoa',name:'Quinoa cocida',kcal:120,protein:4.4,carbs:21,fat:1.9,group:'carb'},
{id:'pasta',name:'Pasta cocida',kcal:158,protein:5.8,carbs:31,fat:0.9,group:'carb'},
{id:'bread',name:'Pan integral',kcal:247,protein:13,carbs:41,fat:4.2,group:'carb'},
{id:'broccoli',name:'Brócoli',kcal:35,protein:2.4,carbs:7,fat:0.4,group:'vegetable'},
{id:'carrot',name:'Zanahoria',kcal:41,protein:0.9,carbs:10,fat:0.2,group:'vegetable'},
{id:'tomato',name:'Tomate',kcal:18,protein:0.9,carbs:3.9,fat:0.2,group:'vegetable'},
{id:'spinach',name:'Espinaca',kcal:23,protein:2.9,carbs:3.6,fat:0.4,group:'vegetable'},
{id:'pumpkin',name:'Calabaza',kcal:26,protein:1,carbs:6.5,fat:0.1,group:'vegetable'},
{id:'zucchini',name:'Zapallito',kcal:17,protein:1.2,carbs:3.1,fat:0.3,group:'vegetable'},
{id:'olive',name:'Aceite de oliva',kcal:884,protein:0,carbs:0,fat:100,group:'fat'},
];
const p=['chicken','beef','fish','eggs','lentils'],c=['rice','potato','quinoa','pasta','bread'],v=['broccoli','carrot','tomato','spinach','pumpkin','zucchini'];
const get=(id:string)=>FOODS.find(f=>f.id===id)!;
export const MENUS:Meal[]=p.flatMap((protein,pi)=>c.flatMap((carb,ci)=>v.map((veg,vi)=>({
  id:'menu-'+(pi*30+ci*6+vi+1),title:get(protein).name+' con '+get(carb).name.toLowerCase()+' y '+get(veg).name.toLowerCase(),
  ingredients:[{id:protein,grams:protein==='eggs'?120:150},{id:carb,grams:180},{id:veg,grams:160},{id:'olive',grams:8}],
  tags:[protein==='lentils'?'vegetariano':'mixto',ci%2===0?'energía para entrenar':'comida completa']
}))));
export function nutrition(items:Portion[]){return items.reduce((a,item)=>{const f=FOODS.find(x=>x.id===item.id);if(!f)return a;const g=Math.max(0,Math.min(2000,item.grams))/100;return{kcal:a.kcal+f.kcal*g,proteinG:a.proteinG+f.protein*g,carbsG:a.carbsG+f.carbs*g,fatG:a.fatG+f.fat*g};},{kcal:0,proteinG:0,carbsG:0,fatG:0});}
/** Three editable meal ideas, not a prescribed complete diet. No intake is logged. */
export function suggestDailyMeals(targetKcal:number, dayKey:string, avoid:string[]=[]):{meal:Meal;kcal:number;proteinG:number}[]{
  const eligible=MENUS.filter(m=>!m.ingredients.some(i=>avoid.includes(i.id)));
  if(!eligible.length)return [];
  const safeTarget=Number.isFinite(targetKcal)&&targetKcal>0?targetKcal:1800;
  // These are substantial meal ideas; remaining energy may come from other food.
  const perMeal=safeTarget/3;
  const seed=[...dayKey].reduce((a,ch)=>a+ch.charCodeAt(0),0);
  const scored=eligible.map(meal=>{
    const totals=nutrition(meal.ingredients);
    return {meal,kcal:Math.round(totals.kcal),proteinG:Math.round(totals.proteinG),
      gap:Math.abs(totals.kcal-perMeal)};
  }).sort((a,b)=>a.gap-b.gap);
  const chosen:typeof scored=[];
  for(let offset=0;offset<Math.min(eligible.length,20)&&chosen.length<3;offset++){
    const candidate=scored[(seed+offset)%Math.min(eligible.length,20)]!;
    if(!chosen.some(x=>x.meal.ingredients[0]?.id===candidate.meal.ingredients[0]?.id))chosen.push(candidate);
  }
  return chosen;
}
export const THEORY=[
{title:'Carbohidratos: qué son',body:'Aportan energía y pueden ayudar a sostener el ejercicio. No hace falta evitarlos: importan la cantidad total, la fibra, el contexto y la tolerancia individual.'},
{title:'Absorción rápida y lenta',body:'Los alimentos menos procesados y ricos en fibra suelen producir una respuesta glucémica más gradual. El ritmo depende también de la porción, la cocción y la combinación con grasa y proteínas.'},
{title:'Índice glucémico y resistencia a la insulina',body:'El índice glucémico describe la respuesta a carbohidratos de un alimento, pero no mide por sí mismo resistencia a la insulina. Actividad física, calidad de dieta, balance energético y condiciones clínicas influyen. Evitá atribuir diagnósticos a una comida aislada.'},
{title:'Proteínas y recuperación',body:'La proteína aporta aminoácidos para tejidos y reparación. La meta diaria debe ajustarse al peso, entrenamiento y necesidades clínicas; más cantidad no siempre aporta beneficios.'},
{title:'Cómo interpretar una estimación',body:'Las calorías varían por marca, aceite, tamaño de porción y método de preparación. Esta biblioteca usa valores de referencia redondeados. Corregí cantidades antes de guardarlas.'},
{title:'Déficit y superávit',body:'La estimación calórica es una hipótesis inicial; se ajusta con tendencias de semanas y tolerancia al plan. No conviene forzar déficits agresivos por defecto.'},
{title:'Fibra y saciedad',body:'Verduras, legumbres y cereales integrales suman fibra y pueden favorecer la saciedad y el control glucémico. Aumentar fibra gradualmente mejora tolerancia.'},
{title:'Comer antes de correr',body:'El intervalo, duración e intensidad cambian qué alimentos convienen. Un refrigerio tolerable rico en carbohidratos puede servir antes de esfuerzos prolongados.'},
];
const normalized=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const synonyms:Record<string,string[]>={chicken:['pollo','pechuga'],beef:['carne','bife','bifes','vaca'],fish:['pescado','merluza'],eggs:['huevo','huevos'],lentils:['lenteja','lentejas'],rice:['arroz'],potato:['papa','papas'],quinoa:['quinoa'],pasta:['fideos','pasta'],bread:['pan'],broccoli:['brocoli'],carrot:['zanahoria'],tomato:['tomate'],spinach:['espinaca'],pumpkin:['calabaza','zapallo'],zucchini:['zapallito','zucchini'],olive:['aceite']};
export function parseSimpleFood(description:string):Portion[]{
const txt=normalized(description);const portions:Portion[]=[];
for(const food of FOODS){const aliases=synonyms[food.id]??[];const found=aliases.map(alias=>({alias,at:txt.indexOf(alias)})).find(x=>x.at>=0);if(!found)continue;
const after=txt.slice(found.at+found.alias.length,found.at+found.alias.length+18).split(/[,;.]/)[0]??'';
const before=txt.slice(Math.max(0,found.at-16),found.at).split(/[,;.]/).pop()??'';
const grams=after.match(/^\\s*(\\d{1,4})\\s*(?:g|gr|gramos)\\b/)??before.match(/(\\d{1,4})\\s*(?:g|gr|gramos)\\s*$/);
const count=before.match(/(\\d{1,2})\\s*$/);
const base=food.id==='eggs'?55:food.id==='olive'?10:150;
portions.push({id:food.id,grams:grams?Number(grams[1]):count?Number(count[1])*base:base});
}
return portions;
}
