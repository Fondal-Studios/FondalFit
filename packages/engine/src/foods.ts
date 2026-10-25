export type FoodCat = 'meat' | 'fish' | 'dairy' | 'veg' | 'fruit' | 'grain' | 'legume' | 'nuts' | 'fats' | 'drinks' | 'sweets' | 'prepared';
export const FOOD_CATS: FoodCat[] = ['meat', 'fish', 'dairy', 'veg', 'fruit', 'grain', 'legume', 'nuts', 'fats', 'drinks', 'sweets', 'prepared'];
export type Lang = 'es' | 'pt' | 'en';

export interface Food {
  id: string; cat: FoodCat;
  /** [es, en, pt] */ n: [string, string, string];
  /** per 100 g (or 100 ml for liquids) */ kcal: number; p: number; c: number; f: number;
  /** typical serving in g/ml */ portionG: number;
  /** weight of one countable unit (egg, banana, slice…) */ unitG?: number;
  liquid?: boolean;
  /** extra search words (any language) */ alias?: string;
}

const f = (id: string, cat: FoodCat, n: [string, string, string], kcal: number, p: number, c: number, fat: number, portionG: number, o: { unit?: number; liquid?: boolean; alias?: string } = {}): Food =>
  ({ id, cat, n, kcal, p, c, f: fat, portionG, unitG: o.unit, liquid: o.liquid, alias: o.alias });

/**
 * Reference values per 100 g, rounded (cooked/ready-to-eat unless noted). Typical published composition-table magnitudes,
 * NOT laboratory analysis: brands, cuts and cooking fat change them. The UI shows ranges for that reason.
 */
export const FOODS: Food[] = [
  // ---- meat & poultry
  f('chicken_breast', 'meat', ['Pechuga de pollo cocida', 'Chicken breast, cooked', 'Peito de frango cozido'], 165, 31, 0, 3.6, 150, { alias: 'pollo pechuga suprema chicken frango' }),
  f('chicken_thigh', 'meat', ['Muslo de pollo sin piel', 'Chicken thigh, skinless', 'Coxa de frango sem pele'], 179, 24, 0, 8.5, 150, { alias: 'pata muslo pollo sobrecoxa' }),
  f('beef_lean', 'meat', ['Carne vacuna magra (lomo, bife)', 'Lean beef (steak)', 'Carne bovina magra (bife)'], 195, 29, 0, 8.5, 150, { alias: 'carne vaca bife lomo cuadril peceto nalga steak res' }),
  f('beef_mince', 'meat', ['Carne picada cocida', 'Ground beef, cooked', 'Carne moída cozida'], 250, 26, 0, 15, 120, { alias: 'carne picada molida moida' }),
  f('asado', 'meat', ['Asado (costilla) a la parrilla', 'Grilled beef ribs (asado)', 'Costela assada (churrasco)'], 290, 24, 0, 21, 200, { alias: 'asado parrilla costilla tira churrasco barbecue' }),
  f('milanesa_beef', 'meat', ['Milanesa de carne frita', 'Breaded beef cutlet, fried', 'Bife à milanesa frito'], 290, 18, 18, 16, 150, { unit: 150, alias: 'milanesa milanesas' }),
  f('milanesa_chicken_baked', 'meat', ['Milanesa de pollo al horno', 'Breaded chicken cutlet, baked', 'Filé de frango empanado assado'], 220, 20, 15, 9, 150, { unit: 150, alias: 'milanesa pollo horno suprema' }),
  f('pork_loin', 'meat', ['Lomo de cerdo cocido', 'Pork loin, cooked', 'Lombo de porco cozido'], 190, 27, 0, 8, 150, { alias: 'cerdo carre lomo porco' }),
  f('bondiola', 'meat', ['Bondiola de cerdo', 'Pork shoulder', 'Pernil de porco'], 250, 22, 0, 18, 150, { alias: 'bondiola pernil paleta' }),
  f('ham_cooked', 'meat', ['Jamón cocido', 'Cooked ham', 'Presunto cozido'], 110, 18, 1.5, 3.5, 40, { unit: 20, alias: 'jamon fiambre presunto' }),
  f('serrano_ham', 'meat', ['Jamón crudo', 'Cured ham', 'Presunto cru'], 240, 30, 0, 13, 40, { unit: 15, alias: 'jamon crudo serrano prosciutto' }),
  f('turkey_breast', 'meat', ['Pechuga de pavo', 'Turkey breast', 'Peito de peru'], 135, 30, 0, 1.5, 120, { alias: 'pavo peru turkey' }),
  f('liver_beef', 'meat', ['Hígado vacuno', 'Beef liver', 'Fígado bovino'], 175, 27, 4, 5, 100, { alias: 'higado figado' }),
  f('sausage_parrilla', 'meat', ['Chorizo / salchicha parrillera', 'Grilled sausage', 'Linguiça / salsicha'], 310, 14, 2, 27, 100, { unit: 100, alias: 'chorizo choripan salchicha linguica' }),
  f('burger_patty', 'meat', ['Hamburguesa casera de carne', 'Beef burger patty', 'Hambúrguer de carne'], 250, 20, 0, 18, 110, { unit: 110, alias: 'hamburguesa burger medallon' }),
  f('lamb', 'meat', ['Cordero cocido', 'Lamb, cooked', 'Cordeiro cozido'], 250, 25, 0, 17, 150, { alias: 'cordero cordeiro' }),
  // ---- fish & seafood
  f('hake', 'fish', ['Merluza cocida', 'White fish (hake), cooked', 'Peixe branco (merluza)'], 100, 21, 0, 1.5, 150, { alias: 'merluza pescado blanco fish pescada' }),
  f('tuna_water', 'fish', ['Atún al natural (lata)', 'Tuna in water (can)', 'Atum ao natural (lata)'], 116, 26, 0, 1, 80, { unit: 80, alias: 'atun lata tuna atum' }),
  f('tuna_oil', 'fish', ['Atún en aceite (lata)', 'Tuna in oil (can)', 'Atum em óleo (lata)'], 190, 26, 0, 9, 80, { unit: 80, alias: 'atun aceite' }),
  f('salmon', 'fish', ['Salmón cocido', 'Salmon, cooked', 'Salmão cozido'], 206, 22, 0, 12, 150, { alias: 'salmon salmao' }),
  f('sardines', 'fish', ['Sardinas en lata', 'Sardines (can)', 'Sardinhas (lata)'], 208, 25, 0, 11, 90, { alias: 'sardina sardinas sardine' }),
  f('shrimp', 'fish', ['Camarones / langostinos', 'Shrimp / prawns', 'Camarão'], 99, 24, 0.2, 0.3, 120, { alias: 'camarones langostinos gambas camarao shrimp prawns' }),
  f('trout', 'fish', ['Trucha cocida', 'Trout, cooked', 'Truta cozida'], 148, 21, 0, 7, 150, { alias: 'trucha truta' }),
  f('squid', 'fish', ['Calamar cocido', 'Squid, cooked', 'Lula cozida'], 92, 16, 3, 1.4, 120, { alias: 'calamar rabas lula' }),
  // ---- eggs & dairy
  f('egg', 'dairy', ['Huevo entero', 'Egg (whole)', 'Ovo inteiro'], 143, 13, 1, 10, 50, { unit: 50, alias: 'huevo huevos egg eggs ovo ovos' }),
  f('egg_white', 'dairy', ['Clara de huevo', 'Egg white', 'Clara de ovo'], 52, 11, 0.7, 0.2, 66, { unit: 33, alias: 'clara claras' }),
  f('milk_whole', 'dairy', ['Leche entera', 'Whole milk', 'Leite integral'], 61, 3.2, 4.8, 3.3, 200, { liquid: true, alias: 'leche leite milk' }),
  f('milk_skim', 'dairy', ['Leche descremada', 'Skim milk', 'Leite desnatado'], 35, 3.4, 5, 0.1, 200, { liquid: true, alias: 'leche descremada desnatada light' }),
  f('yogurt_plain', 'dairy', ['Yogur natural', 'Plain yogurt', 'Iogurte natural'], 61, 3.5, 4.7, 3.3, 170, { alias: 'yogur yogurt iogurte' }),
  f('yogurt_greek', 'dairy', ['Yogur griego natural', 'Greek yogurt, plain', 'Iogurte grego natural'], 97, 9, 4, 5, 170, { alias: 'yogur griego greek grego' }),
  f('yogurt_fruit', 'dairy', ['Yogur con frutas / saborizado', 'Fruit yogurt', 'Iogurte com frutas'], 85, 3.3, 14, 1.8, 170, { alias: 'yogur frutado saborizado bebible' }),
  f('cottage', 'dairy', ['Queso cottage', 'Cottage cheese', 'Queijo cottage'], 98, 11, 3.4, 4.3, 100, { alias: 'cottage' }),
  f('ricotta', 'dairy', ['Ricota / queso fresco', 'Ricotta / fresh cheese', 'Ricota / queijo fresco'], 174, 11, 3, 13, 60, { alias: 'ricota ricotta queso fresco' }),
  f('cream_cheese', 'dairy', ['Queso crema', 'Cream cheese', 'Cream cheese'], 342, 6, 4, 34, 30, { alias: 'queso crema untable philadelphia' }),
  f('mozzarella', 'dairy', ['Mozzarella', 'Mozzarella', 'Muçarela'], 280, 22, 2.2, 22, 50, { unit: 30, alias: 'muzzarella mozzarella mucarela queso' }),
  f('cheese_semi', 'dairy', ['Queso cuartirolo / semiduro', 'Semi-hard cheese', 'Queijo semiduro'], 300, 22, 2, 23, 40, { unit: 30, alias: 'queso cuartirolo gouda cheddar fontina' }),
  f('parmesan', 'dairy', ['Queso rallado / parmesano', 'Grated parmesan', 'Queijo ralado / parmesão'], 392, 36, 3, 26, 10, { alias: 'rallado parmesano sardo reggianito' }),
  f('dulce_leche', 'dairy', ['Dulce de leche', 'Dulce de leche', 'Doce de leite'], 315, 6, 55, 8, 20, { alias: 'dulce leche doce' }),
  f('butter', 'dairy', ['Manteca / mantequilla', 'Butter', 'Manteiga'], 717, 0.9, 0.1, 81, 10, { alias: 'manteca mantequilla butter manteiga' }),
  f('cream', 'dairy', ['Crema de leche', 'Cream', 'Creme de leite'], 340, 2, 3, 36, 30, { alias: 'crema nata creme' }),
  // ---- vegetables
  f('lettuce', 'veg', ['Lechuga', 'Lettuce', 'Alface'], 15, 1.4, 2.9, 0.2, 60, { alias: 'lechuga lettuce alface' }),
  f('tomato', 'veg', ['Tomate', 'Tomato', 'Tomate'], 18, 0.9, 3.9, 0.2, 120, { unit: 120, alias: 'tomate' }),
  f('onion', 'veg', ['Cebolla', 'Onion', 'Cebola'], 40, 1.1, 9.3, 0.1, 80, { unit: 110, alias: 'cebolla cebola onion' }),
  f('carrot', 'veg', ['Zanahoria', 'Carrot', 'Cenoura'], 41, 0.9, 10, 0.2, 80, { unit: 70, alias: 'zanahoria cenoura carrot' }),
  f('broccoli', 'veg', ['Brócoli cocido', 'Broccoli, cooked', 'Brócolis cozido'], 35, 2.4, 7, 0.4, 120, { alias: 'brocoli brócolis broccoli' }),
  f('spinach', 'veg', ['Espinaca cocida', 'Spinach, cooked', 'Espinafre cozido'], 23, 3, 3.6, 0.4, 100, { alias: 'espinaca espinafre spinach acelga' }),
  f('zucchini', 'veg', ['Zapallito / zucchini', 'Zucchini', 'Abobrinha'], 17, 1.2, 3.1, 0.3, 120, { alias: 'zapallito zucchini abobrinha calabacin' }),
  f('pumpkin', 'veg', ['Zapallo / calabaza', 'Pumpkin / squash', 'Abóbora'], 26, 1, 6.5, 0.1, 150, { alias: 'zapallo calabaza abobora pumpkin anco' }),
  f('eggplant', 'veg', ['Berenjena', 'Eggplant', 'Berinjela'], 25, 1, 6, 0.2, 120, { alias: 'berenjena berinjela eggplant' }),
  f('bell_pepper', 'veg', ['Morrón / pimiento', 'Bell pepper', 'Pimentão'], 31, 1, 6, 0.3, 100, { unit: 120, alias: 'morron pimiento pimentao pepper' }),
  f('cucumber', 'veg', ['Pepino', 'Cucumber', 'Pepino'], 15, 0.7, 3.6, 0.1, 100, { alias: 'pepino cucumber' }),
  f('cauliflower', 'veg', ['Coliflor', 'Cauliflower', 'Couve-flor'], 25, 1.9, 5, 0.3, 120, { alias: 'coliflor couve cauliflower' }),
  f('beet', 'veg', ['Remolacha cocida', 'Beetroot, cooked', 'Beterraba cozida'], 44, 1.7, 10, 0.2, 100, { alias: 'remolacha beterraba beet' }),
  f('corn', 'veg', ['Choclo / maíz cocido', 'Sweet corn, cooked', 'Milho cozido'], 96, 3.4, 21, 1.5, 150, { unit: 150, alias: 'choclo maiz milho corn' }),
  f('mushrooms', 'veg', ['Champiñones', 'Mushrooms', 'Cogumelos'], 22, 3.1, 3.3, 0.3, 100, { alias: 'champinones hongos cogumelos mushroom' }),
  f('salad_mixed', 'veg', ['Ensalada mixta (sin aderezo)', 'Mixed salad (no dressing)', 'Salada mista (sem molho)'], 25, 1.2, 4.5, 0.2, 150, { alias: 'ensalada salada salad' }),
  f('avocado', 'veg', ['Palta / aguacate', 'Avocado', 'Abacate'], 160, 2, 8.5, 14.7, 70, { unit: 150, alias: 'palta aguacate abacate avocado' }),
  // ---- fruit
  f('banana', 'fruit', ['Banana', 'Banana', 'Banana'], 89, 1.1, 23, 0.3, 120, { unit: 120, alias: 'banana platano' }),
  f('apple', 'fruit', ['Manzana', 'Apple', 'Maçã'], 52, 0.3, 14, 0.2, 180, { unit: 180, alias: 'manzana maca apple' }),
  f('orange', 'fruit', ['Naranja', 'Orange', 'Laranja'], 47, 0.9, 12, 0.1, 150, { unit: 150, alias: 'naranja laranja orange' }),
  f('mandarin', 'fruit', ['Mandarina', 'Mandarin', 'Tangerina'], 53, 0.8, 13, 0.3, 80, { unit: 80, alias: 'mandarina tangerina mandarin' }),
  f('pear', 'fruit', ['Pera', 'Pear', 'Pera'], 57, 0.4, 15, 0.1, 180, { unit: 180, alias: 'pera pear' }),
  f('strawberry', 'fruit', ['Frutillas / fresas', 'Strawberries', 'Morangos'], 32, 0.7, 7.7, 0.3, 150, { alias: 'frutilla frutillas fresa fresas morango strawberry' }),
  f('grapes', 'fruit', ['Uvas', 'Grapes', 'Uvas'], 69, 0.7, 18, 0.2, 120, { alias: 'uva uvas grapes' }),
  f('watermelon', 'fruit', ['Sandía', 'Watermelon', 'Melancia'], 30, 0.6, 7.6, 0.2, 250, { alias: 'sandia melancia watermelon' }),
  f('melon', 'fruit', ['Melón', 'Melon', 'Melão'], 34, 0.8, 8, 0.2, 200, { alias: 'melon melao' }),
  f('peach', 'fruit', ['Durazno / melocotón', 'Peach', 'Pêssego'], 39, 0.9, 10, 0.3, 150, { unit: 150, alias: 'durazno melocoton pessego peach' }),
  f('kiwi', 'fruit', ['Kiwi', 'Kiwi', 'Kiwi'], 61, 1.1, 15, 0.5, 70, { unit: 70, alias: 'kiwi' }),
  f('pineapple', 'fruit', ['Ananá / piña', 'Pineapple', 'Abacaxi'], 50, 0.5, 13, 0.1, 150, { alias: 'anana pina abacaxi pineapple' }),
  f('mango', 'fruit', ['Mango', 'Mango', 'Manga'], 60, 0.8, 15, 0.4, 150, { alias: 'mango manga' }),
  f('blueberries', 'fruit', ['Arándanos', 'Blueberries', 'Mirtilos'], 57, 0.7, 14, 0.3, 80, { alias: 'arandanos mirtilos blueberries berries' }),
  f('dates', 'fruit', ['Dátiles', 'Dates', 'Tâmaras'], 282, 2.5, 75, 0.4, 48, { unit: 24, alias: 'datiles tamaras dates' }),
  f('raisins', 'fruit', ['Pasas de uva', 'Raisins', 'Uvas-passas'], 299, 3, 79, 0.5, 30, { alias: 'pasas uvas passas raisins' }),
  // ---- grains, breads, tubers
  f('rice_white', 'grain', ['Arroz blanco cocido', 'White rice, cooked', 'Arroz branco cozido'], 130, 2.7, 28, 0.3, 180, { alias: 'arroz rice' }),
  f('rice_brown', 'grain', ['Arroz integral cocido', 'Brown rice, cooked', 'Arroz integral cozido'], 112, 2.3, 23.5, 0.8, 180, { alias: 'arroz integral brown' }),
  f('pasta', 'grain', ['Pasta / fideos cocidos', 'Pasta, cooked', 'Macarrão cozido'], 158, 5.8, 31, 0.9, 200, { alias: 'pasta fideos tallarines espagueti macarrao spaghetti noodles' }),
  f('bread_white', 'grain', ['Pan blanco (rebanada)', 'White bread (slice)', 'Pão branco (fatia)'], 265, 9, 49, 3.2, 60, { unit: 30, alias: 'pan blanco tostada rebanada pao' }),
  f('bread_whole', 'grain', ['Pan integral (rebanada)', 'Whole-wheat bread (slice)', 'Pão integral (fatia)'], 247, 13, 41, 4.2, 60, { unit: 30, alias: 'pan integral wholegrain' }),
  f('bread_roll', 'grain', ['Pan francés / miñón', 'Bread roll', 'Pãozinho'], 270, 9, 55, 1.5, 60, { unit: 60, alias: 'pan frances minon pancito pao frances bun roll' }),
  f('rice_cake', 'grain', ['Galletas de arroz', 'Rice cakes', 'Bolachas de arroz'], 380, 8, 80, 3, 18, { unit: 9, alias: 'galleta arroz galletas rice cake' }),
  f('oats_dry', 'grain', ['Avena (en copos, seca)', 'Oats (dry)', 'Aveia em flocos'], 389, 17, 66, 7, 40, { alias: 'avena oats aveia' }),
  f('oats_cooked', 'grain', ['Avena cocida (porridge)', 'Porridge, cooked', 'Mingau de aveia'], 71, 2.5, 12, 1.5, 250, { alias: 'porridge avena cocida mingau' }),
  f('polenta', 'grain', ['Polenta cocida', 'Polenta, cooked', 'Polenta cozida'], 70, 1.6, 15, 0.3, 200, { alias: 'polenta' }),
  f('quinoa', 'grain', ['Quinoa cocida', 'Quinoa, cooked', 'Quinoa cozida'], 120, 4.4, 21, 1.9, 150, { alias: 'quinoa quinua' }),
  f('couscous', 'grain', ['Cuscús cocido', 'Couscous, cooked', 'Cuscuz cozido'], 112, 3.8, 23, 0.2, 150, { alias: 'cuscus couscous cuscuz' }),
  f('potato', 'grain', ['Papa / patata hervida', 'Potato, boiled', 'Batata inglesa cozida'], 87, 1.9, 20, 0.1, 180, { unit: 150, alias: 'papa papas patata batata inglesa potato' }),
  f('sweet_potato', 'grain', ['Batata / camote hervida', 'Sweet potato, boiled', 'Batata-doce cozida'], 86, 1.6, 20, 0.1, 150, { unit: 150, alias: 'batata camote boniato batata doce sweet potato' }),
  f('fries', 'grain', ['Papas fritas', 'French fries', 'Batata frita'], 312, 3.4, 41, 15, 120, { alias: 'papas fritas fritas french fries' }),
  f('gnocchi', 'grain', ['Ñoquis cocidos', 'Gnocchi, cooked', 'Nhoque cozido'], 130, 3, 28, 0.5, 200, { alias: 'noquis ñoquis gnocchi nhoque' }),
  f('cornflakes', 'grain', ['Cereales de desayuno', 'Breakfast cereal', 'Cereal matinal'], 357, 7, 84, 0.4, 30, { alias: 'cereal cereales corn flakes copos' }),
  f('granola', 'grain', ['Granola', 'Granola', 'Granola'], 450, 10, 64, 18, 40, { alias: 'granola' }),
  f('wrap', 'grain', ['Wrap / tortilla de trigo', 'Flour tortilla / wrap', 'Wrap / tortilla'], 310, 8, 52, 7, 60, { unit: 60, alias: 'wrap tortilla fajita' }),
  f('crackers', 'grain', ['Galletitas de agua / crackers', 'Crackers', 'Biscoito cream cracker'], 430, 10, 72, 11, 30, { alias: 'galletitas agua crackers criollitas' }),
  f('flour', 'grain', ['Harina de trigo', 'Wheat flour', 'Farinha de trigo'], 364, 10, 76, 1, 30, { alias: 'harina farinha flour' }),
  // ---- legumes
  f('lentils', 'legume', ['Lentejas cocidas', 'Lentils, cooked', 'Lentilhas cozidas'], 116, 9, 20, 0.4, 180, { alias: 'lenteja lentejas lentilha lentils' }),
  f('chickpeas', 'legume', ['Garbanzos cocidos', 'Chickpeas, cooked', 'Grão-de-bico cozido'], 164, 9, 27, 2.6, 150, { alias: 'garbanzo garbanzos grao de bico chickpeas' }),
  f('black_beans', 'legume', ['Porotos / frijoles cocidos', 'Beans, cooked', 'Feijão cozido'], 132, 8.9, 24, 0.5, 150, { alias: 'poroto porotos frijoles feijao beans' }),
  f('peas', 'legume', ['Arvejas cocidas', 'Green peas, cooked', 'Ervilhas cozidas'], 81, 5, 14, 0.4, 100, { alias: 'arveja arvejas guisantes ervilha peas' }),
  f('tofu', 'legume', ['Tofu', 'Tofu', 'Tofu'], 76, 8, 1.9, 4.8, 120, { alias: 'tofu soja' }),
  f('hummus', 'legume', ['Hummus', 'Hummus', 'Homus'], 166, 8, 14, 10, 40, { alias: 'hummus humus homus' }),
  f('edamame', 'legume', ['Edamame', 'Edamame', 'Edamame'], 121, 12, 9, 5, 100, { alias: 'edamame' }),
  f('soy_chunks', 'legume', ['Soja texturizada hidratada', 'Textured soy protein, hydrated', 'Proteína de soja hidratada'], 110, 16, 7, 0.5, 100, { alias: 'soja texturizada proteina soja tvp' }),
  // ---- nuts & seeds
  f('almonds', 'nuts', ['Almendras', 'Almonds', 'Amêndoas'], 579, 21, 22, 50, 30, { unit: 1.2, alias: 'almendra almendras amendoa almonds' }),
  f('walnuts', 'nuts', ['Nueces', 'Walnuts', 'Nozes'], 654, 15, 14, 65, 30, { unit: 5, alias: 'nuez nueces noz nozes walnuts' }),
  f('peanuts', 'nuts', ['Maní / cacahuates', 'Peanuts', 'Amendoim'], 567, 26, 16, 49, 30, { alias: 'mani cacahuate cacahuete amendoim peanut peanuts' }),
  f('peanut_butter', 'nuts', ['Pasta de maní', 'Peanut butter', 'Pasta de amendoim'], 588, 25, 20, 50, 15, { alias: 'pasta mani mantequilla mani peanut butter pasta amendoim' }),
  f('cashews', 'nuts', ['Castañas de cajú', 'Cashews', 'Castanha de caju'], 553, 18, 30, 44, 30, { alias: 'caju casteñas cajú anacardo cashew' }),
  f('chia', 'nuts', ['Semillas de chía', 'Chia seeds', 'Sementes de chia'], 486, 17, 42, 31, 15, { alias: 'chia' }),
  f('sunflower_seeds', 'nuts', ['Semillas de girasol', 'Sunflower seeds', 'Sementes de girassol'], 584, 21, 20, 51, 20, { alias: 'girasol semillas girassol sunflower' }),
  f('mixed_nuts', 'nuts', ['Mix de frutos secos', 'Mixed nuts', 'Mix de castanhas'], 607, 17, 21, 54, 30, { alias: 'frutos secos mix castanhas trail' }),
  // ---- fats & condiments
  f('olive_oil', 'fats', ['Aceite de oliva', 'Olive oil', 'Azeite de oliva'], 884, 0, 0, 100, 10, { liquid: true, alias: 'aceite oliva azeite oil' }),
  f('sunflower_oil', 'fats', ['Aceite de girasol', 'Sunflower oil', 'Óleo de girassol'], 884, 0, 0, 100, 10, { liquid: true, alias: 'aceite girasol oleo' }),
  f('mayonnaise', 'fats', ['Mayonesa', 'Mayonnaise', 'Maionese'], 680, 1, 0.6, 75, 15, { alias: 'mayonesa maionese mayo' }),
  f('ketchup', 'fats', ['Ketchup', 'Ketchup', 'Ketchup'], 100, 1.2, 25, 0.1, 15, { alias: 'ketchup catsup' }),
  f('vinaigrette', 'fats', ['Aderezo / vinagreta', 'Salad dressing', 'Molho de salada'], 300, 0.5, 6, 30, 20, { alias: 'aderezo vinagreta molho dressing' }),
  // ---- drinks
  f('water', 'drinks', ['Agua', 'Water', 'Água'], 0, 0, 0, 0, 250, { liquid: true, alias: 'agua water' }),
  f('coffee_black', 'drinks', ['Café solo', 'Black coffee', 'Café preto'], 1, 0.1, 0, 0, 150, { liquid: true, alias: 'cafe solo espresso cafe preto cortado' }),
  f('coffee_milk', 'drinks', ['Café con leche', 'Coffee with milk', 'Café com leite'], 30, 1.6, 2.4, 1.6, 250, { liquid: true, alias: 'cafe con leche latte cappuccino' }),
  f('mate', 'drinks', ['Mate cebado (sin azúcar)', 'Mate (unsweetened)', 'Chimarrão (sem açúcar)'], 1, 0, 0.2, 0, 300, { liquid: true, alias: 'mate yerba chimarrao' }),
  f('tea', 'drinks', ['Té (sin azúcar)', 'Tea (unsweetened)', 'Chá (sem açúcar)'], 1, 0, 0.2, 0, 200, { liquid: true, alias: 'te tea cha' }),
  f('soda_cola', 'drinks', ['Gaseosa cola', 'Cola soda', 'Refrigerante cola'], 42, 0, 10.6, 0, 330, { liquid: true, alias: 'gaseosa cola coca refresco refrigerante soda' }),
  f('orange_juice', 'drinks', ['Jugo de naranja', 'Orange juice', 'Suco de laranja'], 45, 0.7, 10, 0.2, 200, { liquid: true, alias: 'jugo naranja suco laranja juice' }),
  f('beer', 'drinks', ['Cerveza', 'Beer', 'Cerveja'], 43, 0.5, 3.6, 0, 330, { liquid: true, alias: 'cerveza cerveja beer birra' }),
  f('wine_red', 'drinks', ['Vino tinto', 'Red wine', 'Vinho tinto'], 85, 0.1, 2.6, 0, 150, { liquid: true, alias: 'vino tinto vinho wine' }),
  f('sports_drink', 'drinks', ['Bebida isotónica', 'Sports drink', 'Bebida isotônica'], 26, 0, 6.5, 0, 500, { liquid: true, alias: 'isotonica gatorade powerade isotonic' }),
  f('almond_milk', 'drinks', ['Leche de almendras', 'Almond milk', 'Leite de amêndoas'], 15, 0.6, 0.3, 1.1, 200, { liquid: true, alias: 'leche almendras' }),
  f('soy_milk', 'drinks', ['Leche de soja', 'Soy milk', 'Leite de soja'], 54, 3.3, 6, 1.8, 200, { liquid: true, alias: 'leche soja' }),
  f('energy_drink', 'drinks', ['Bebida energética', 'Energy drink', 'Energético'], 45, 0, 11, 0, 250, { liquid: true, alias: 'energizante red bull monster energetico' }),
  // ---- sweets & snacks
  f('chocolate_milk', 'sweets', ['Chocolate con leche', 'Milk chocolate', 'Chocolate ao leite'], 535, 8, 59, 30, 25, { unit: 5, alias: 'chocolate cacao bombon' }),
  f('chocolate_dark', 'sweets', ['Chocolate amargo 70%', 'Dark chocolate 70%', 'Chocolate amargo 70%'], 598, 7.8, 46, 43, 25, { unit: 5, alias: 'chocolate amargo negro dark' }),
  f('alfajor', 'sweets', ['Alfajor', 'Alfajor (sandwich cookie)', 'Alfajor'], 410, 4.5, 62, 17, 50, { unit: 50, alias: 'alfajor' }),
  f('cookies', 'sweets', ['Galletitas dulces', 'Sweet cookies', 'Biscoitos doces'], 480, 6, 70, 20, 30, { unit: 10, alias: 'galletitas galletas dulces cookies biscoito' }),
  f('croissant', 'sweets', ['Medialuna / factura', 'Croissant / pastry', 'Croissant / folhado'], 406, 8, 45, 21, 60, { unit: 55, alias: 'medialuna factura croissant croasan' }),
  f('ice_cream', 'sweets', ['Helado', 'Ice cream', 'Sorvete'], 207, 3.5, 24, 11, 80, { unit: 70, alias: 'helado sorvete ice cream bocha' }),
  f('sugar', 'sweets', ['Azúcar', 'Sugar', 'Açúcar'], 387, 0, 100, 0, 5, { alias: 'azucar acucar sugar' }),
  f('honey', 'sweets', ['Miel', 'Honey', 'Mel'], 304, 0.3, 82, 0, 20, { alias: 'miel honey mel' }),
  f('jam', 'sweets', ['Mermelada', 'Jam', 'Geleia'], 250, 0.4, 65, 0, 20, { alias: 'mermelada dulce de batata geleia jam' }),
  f('cake', 'sweets', ['Torta / budín', 'Cake', 'Bolo'], 380, 5, 52, 17, 80, { alias: 'torta budin bizcochuelo bolo cake' }),
  f('chips', 'sweets', ['Papas fritas de bolsa', 'Potato chips', 'Batata chips'], 536, 7, 53, 34, 30, { alias: 'papas bolsa snack chips' }),
  f('popcorn', 'sweets', ['Pochoclo / palomitas', 'Popcorn', 'Pipoca'], 387, 13, 78, 4.5, 30, { alias: 'pochoclo palomitas pipoca popcorn' }),
  f('cereal_bar', 'sweets', ['Barra de cereal', 'Cereal bar', 'Barra de cereal'], 400, 6, 70, 12, 25, { unit: 25, alias: 'barra cereal barrita' }),
  // ---- prepared dishes
  f('pizza', 'prepared', ['Pizza de mozzarella', 'Cheese pizza', 'Pizza de muçarela'], 266, 11, 33, 10, 110, { unit: 110, alias: 'pizza porcion' }),
  f('empanada_baked', 'prepared', ['Empanada de carne (horno)', 'Beef empanada (baked)', 'Empanada de carne (forno)'], 270, 10, 27, 13, 90, { unit: 90, alias: 'empanada empanadas' }),
  f('burger_full', 'prepared', ['Hamburguesa completa con pan', 'Burger with bun', 'Hambúrguer com pão'], 250, 13, 30, 9, 200, { unit: 200, alias: 'hamburguesa completa burger cheeseburger lanche' }),
  f('veg_tart', 'prepared', ['Tarta de verduras', 'Vegetable tart', 'Torta de legumes'], 190, 6, 18, 10, 150, { alias: 'tarta pascualina torta' }),
  f('lentil_stew', 'prepared', ['Guiso de lentejas', 'Lentil stew', 'Guisado de lentilhas'], 100, 6, 14, 2.5, 300, { alias: 'guiso lentejas estofado' }),
  f('soup', 'prepared', ['Sopa casera de verduras', 'Vegetable soup', 'Sopa de legumes'], 40, 2, 6, 1, 300, { alias: 'sopa caldo sopita' }),
  f('tortilla_papa', 'prepared', ['Tortilla de papas', 'Potato omelette', 'Tortilha de batata'], 170, 6, 14, 10, 150, { alias: 'tortilla papa española' }),
  f('ravioli', 'prepared', ['Ravioles con salsa', 'Ravioli with sauce', 'Ravióli com molho'], 160, 6, 24, 4, 250, { alias: 'ravioles ravioli sorrentinos canelones' }),
  f('hot_dog', 'prepared', ['Pancho (panchuque)', 'Hot dog', 'Cachorro-quente'], 290, 10, 24, 17, 100, { unit: 100, alias: 'pancho pancho hot dog panchuque cachorro' }),
  f('sushi', 'prepared', ['Sushi (rolls)', 'Sushi rolls', 'Sushi'], 145, 5, 28, 1, 200, { unit: 30, alias: 'sushi roll' }),
  f('feijoada', 'prepared', ['Feijoada', 'Feijoada (bean & pork stew)', 'Feijoada'], 130, 8, 14, 5, 300, { alias: 'feijoada' }),
  f('pao_de_queijo', 'prepared', ['Pão de queijo', 'Cheese bread (pão de queijo)', 'Pão de queijo'], 360, 6, 40, 20, 50, { unit: 25, alias: 'pao de queijo' }),
  f('milkshake_protein', 'prepared', ['Licuado de banana y leche', 'Banana milk smoothie', 'Vitamina de banana e leite'], 75, 3, 12, 1.5, 300, { liquid: true, alias: 'licuado batido vitamina smoothie' }),
  // ---- sport nutrition
  f('whey', 'prepared', ['Proteína whey (polvo)', 'Whey protein (powder)', 'Whey protein (pó)'], 400, 80, 8, 6, 30, { unit: 30, alias: 'whey proteina polvo scoop medida batido proteico' }),
  f('protein_bar', 'prepared', ['Barra de proteína', 'Protein bar', 'Barra de proteína'], 350, 30, 35, 10, 60, { unit: 60, alias: 'barra proteina protein bar' }),
];

export const foodById = (id: string) => FOODS.find((x) => x.id === id);
export const foodName = (x: Food, lang: Lang) => x.n[lang === 'es' ? 0 : lang === 'en' ? 1 : 2];

export interface Macros { kcal: number; p: number; c: number; f: number }
export const macrosFor = (food: Food, grams: number): Macros => {
  const k = Math.max(0, Math.min(5000, grams)) / 100;
  return { kcal: Math.round(food.kcal * k), p: Math.round(food.p * k * 10) / 10, c: Math.round(food.c * k * 10) / 10, f: Math.round(food.f * k * 10) / 10 };
};
export const sumMacros = (xs: Macros[]): Macros => xs.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: Math.round((a.p + x.p) * 10) / 10, c: Math.round((a.c + x.c) * 10) / 10, f: Math.round((a.f + x.f) * 10) / 10 }), { kcal: 0, p: 0, c: 0, f: 0 });

export interface PlateItem { foodId: string; grams: number }
/** Verifiable calculation: the server recomputes plate totals from the reference table, never from client numbers. */
export const plateMacros = (items: PlateItem[]): Macros => sumMacros(items.flatMap((i) => { const fd = foodById(i.foodId); return fd ? [macrosFor(fd, i.grams)] : []; }));

/** Quick-pick gram chips for a food: 50…400 for staples, small steps for dense foods. */
export const gramChips = (x: Food): number[] => (x.portionG <= 20 ? [5, 10, 15, 20, 30] : x.unitG && x.unitG >= 30 && x.portionG <= 60 ? [x.unitG, x.unitG * 2, x.unitG * 3, x.unitG * 4] : x.cat === 'drinks' ? [150, 200, 250, 330, 500] : x.kcal > 450 ? [15, 30, 50, 100] : [50, 100, 150, 200, 250, 300]);
