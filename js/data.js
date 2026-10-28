// GAYA — site copy, catalog and demo data. Ported 1:1 from the Claude Design source.
const SHEKEL = '₪';

const SITE = {
  heroKicker: 'לנשום. לאהוב. לצמוח.',
  heroTitle: 'קוקודמות וצמחי בוטיק',
  careTitle: 'בחרו את הצמח שלכם',
  careSub: 'מדריך לטיפול המלא מחכה לכם בפנים',
  storyKicker: 'הסטודיו',
  storyTitle: 'הכירו את GAYA – הטבע שנכנס אליכם הביתה',
  storyIntro: 'ברוכים הבאים ל-GAYA, הסטודיו שלנו ברחובות, המקום שבו האהבה העמוקה לצמחים פוגשת אומנות ועיצוב.',
  storyFounders: 'אנחנו גיל ושירן, זוג ושותפים לדרך, שהחליטו לקחת תשוקה ארוכת שנים לעולם הצומח ולהפוך אותה ליצירה שאפשר להכניס הביתה. הכל התחיל לפני כמה שנים, במהלך טיול קסום במזרח הרחוק, שם נחשפנו לראשונה לאומנות הקוקודמה – ופשוט התאהבנו. החלטנו שאנחנו חייבים להנגיש את היופי הייחודי הזה לכולם.',
  kokedamaQ: 'מה זה קוקודמה?',
  kokedamaA: 'אלו הם כדורי אדמה עטופים בטחב ירוק מיובש ומלופפים בחוט פשתן עדין, הנעשים כולם בעבודת יד מוקפדת. הם מהווים בית חם וטבעי לצמח, ומשלבים אסתטיקה של טבע פראי עם נגיעה עיצובית מודרנית. כדי להשלים את החוויה, בחרנו לשלב את הכדורים שלנו באלמנטים מברזל מינימליסטי, שמעניקים להם מראה נקי ותחושה קסומה של ריחוף בחלל.',
  footer: 'GAYA · סטודיו צמחים, רחובות · גאיה, מס׳ עוסק 300286986 · 050-7673034 · giljabes22@gmail.com'
};

const SITE_FIELDS = [
  { group: 'תמונת נושא בדף הבית', keys: [['heroKicker', 'כיתוב עליון', 'line'], ['heroTitle', 'כותרת ראשית', 'area']] },
  { group: 'עמוד מדריך הטיפול', keys: [['careTitle', 'כותרת', 'line'], ['careSub', 'שורה שנייה', 'line']] },
  { group: 'הסיפור של העסק', keys: [['storyKicker', 'כיתוב עליון', 'line'], ['storyTitle', 'כותרת', 'area'], ['storyIntro', 'פסקת פתיחה', 'area'], ['storyFounders', 'על גיל ושירן', 'area'], ['kokedamaQ', 'כותרת ההסבר', 'line'], ['kokedamaA', 'מה זה קוקודמה', 'area']] },
  { group: 'פוטר', keys: [['footer', 'שורת פרטי העסק', 'area']] }
];

const ORD_STATE = {
  new: { label: 'חדשה', tag: 'tag-accent', next: 'prep', nextLabel: 'להכנה' },
  prep: { label: 'בהכנה', tag: 'tag-neutral', next: 'sent', nextLabel: 'סימון כנשלחה' },
  sent: { label: 'נשלחה', tag: 'tag-outline', next: null, nextLabel: '' }
};

// Shop categories, in the order they appear in menus and tabs. The first one
// is where the catalog opens. Kokedama products predate categories and are
// stored with no cat field, so a missing or unknown cat reads as kokedama.
const CATS = [
  { id: 'boutique', label: 'עציצי בוטיק', one: 'עציץ בוטיק', kicker: 'עציץ בוטיק · קרמיקה בעבודת יד', water: 'השקיה כשהאדמה העליונה יבשה' },
  { id: 'kokedama', label: 'קוקודמות', one: 'קוקודמה', kicker: 'קוקודמה · כריכת יד', water: 'טבילה אחת לשבוע' },
  { id: 'hydro', label: 'הידרופוני', one: 'הידרופוני', kicker: 'הידרופוני · שורשים במים', water: 'החלפת מים כל שבועיים' }
];
function catInfo(id) { return CATS.find((c) => c.id === id) || CATS.find((c) => c.id === 'kokedama'); }
function catOf(p) { return catInfo(p && p.cat).id; }
// What to store on a product record for a category id (kokedama stays unset).
function catField(id) { const c = catInfo(id).id; return c === 'kokedama' ? undefined : c; }

const STOCK = { b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, p1: 3, p2: 6, p3: 4, p4: 2, p5: 5, p6: 3, p7: 0, p8: 7, p9: 3, p10: 2, p11: 8, p12: 5, p13: 9, p14: 4, p15: 0, p16: 1, h1: 6, h2: 3, h3: 8 };

// Product photos live in Vercel Blob storage (not this repo) so the admin panel
// can replace them without a code deploy — each product's photo is uploaded to
// a fixed path keyed by its id, so re-uploading the same id overwrites in place.
const BLOB_IMG_BASE = 'https://n5mm0fqiav7j7uht.public.blob.vercel-storage.com/products/';

// Admin edits to the catalog (price/stock/new products/removals) are saved here
// as one JSON file, fetched on every page load and merged over CATALOG/STOCK
// below — same fixed-path-overwrite pattern as the product photos.
const BLOB_DATA_URL = 'https://n5mm0fqiav7j7uht.public.blob.vercel-storage.com/data/catalog.json';

const CATALOG = [
  { id: 'b1', img: '/assets/images/boutique/b1.jpg', cat: 'boutique', name: 'בריכיכיטון שזור', price: 450, size: 'גדולה', light: 'אור ישיר או עקיף בהיר', water: 'השקיה כשהאדמה יבשה לגמרי', desc: 'גזעים עבים השזורים זה בזה ועלווה דקה ונטויה. פיסת פיסול חיה בכלי קרמיקה בעבודת יד.' },
  { id: 'b2', img: '/assets/images/boutique/b2.jpg', cat: 'boutique', name: 'אופרקוליקריה', price: 450, size: 'גדולה', light: 'אור ישיר או עקיף בהיר', water: 'השקיה כשהאדמה יבשה לגמרי', desc: 'גזע אפור ומעוצב וכיפה של עלים זעירים על ענפים מזגזגים. נראית כמו עץ בונסאי בוגר.' },
  { id: 'b3', img: '/assets/images/boutique/b3.jpg', cat: 'boutique', name: 'בריכיכיטון עלה מייפל', price: 450, size: 'גדולה', light: 'אור ישיר או עקיף בהיר', water: 'השקיה כשהאדמה יבשה לגמרי', desc: 'בסיס תפוח ושזור ועלים מחולקים בצורת עלה מייפל. אוגר מים בגזע וסלחן לשכחה.' },
  { id: 'b4', img: '/assets/images/boutique/b4.jpg', cat: 'boutique', name: 'פכירה קלועה', price: 450, size: 'גדולה', light: 'אור עקיף בהיר', water: 'השקיה כשהשכבה העליונה יבשה', desc: 'גזעים קלועים וכיפה מלאה של עלים בכף יד. צמח מזל קלאסי, בכלי קרמיקה בעבודת יד.' },
  { id: 'b5', img: '/assets/images/boutique/b5.jpg', cat: 'boutique', name: 'דרצנה מרגינטה', price: 450, size: 'גדולה', light: 'אור עקיף בינוני', water: 'השקיה כשהשכבה העליונה יבשה', desc: 'שני גזעים בגבהים שונים ועלים דקים בשוליים אדמדמים. עמידה וסלחנית, מתאימה גם למשרד.' },
  { id: 'p1', img: '', name: 'קוקודמה בריכיכיטון', price: 270, size: 'בינונית', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'עלים דמויי קרן איל, גדלים כלפי חוץ. הצמח שנראה הכי טוב תלוי מהתקרה.' },
  { id: 'p2', img: BLOB_IMG_BASE + 'p2.jpg', name: 'קוקודמה דרצנה גולדן', price: 250, size: 'בינונית', light: 'אור עקיף בינוני', water: 'טבילה אחת לשבוע', desc: 'פס זהוב לאורך העלה הצר. עומדת זקופה ומתאימה למדף גבוה.' },
  { id: 'p3', img: BLOB_IMG_BASE + 'p3.jpg', name: 'קוקודמה דרצנה מרגינטה', price: 250, size: 'בינונית', light: 'אור עקיף בינוני', water: 'טבילה אחת לשבוע', desc: 'עלים דקים בשוליים אדמדמים. סלחנית במיוחד למי ששוכח להשקות.' },
  { id: 'p4', img: BLOB_IMG_BASE + 'p4.jpg', name: 'קוקודמה שרך קן ציפור', price: 250, size: 'בינונית', light: 'צל חלקי', water: 'טבילה אחת לחמישה ימים', desc: 'רוזטת עלים גליים בהירים. אוהבת לחות, משגשגת באמבטיה עם חלון.' },
  { id: 'p5', img: BLOB_IMG_BASE + 'p5.jpg', name: 'קוקודמה מונסטרה', price: 250, size: 'גדולה', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'עלה מבוקע שמתרחב עם הזמן. פריט הצהרה לפינת סלון.' },
  { id: 'p6', img: BLOB_IMG_BASE + 'p6.jpg', name: 'קוקודמה אונטריום', price: 250, size: 'בינונית', light: 'אור עקיף בהיר', water: 'טבילה אחת לחמישה ימים', desc: 'עלים מבריקים כהים ופריחה אדומה בעונה. אוהבת לחות גבוהה.' },
  { id: 'p7', img: '', name: 'קוקודמה סנסיווריה', price: 250, size: 'בינונית', light: 'סובלת גם מעט אור', water: 'טבילה אחת לשבועיים', desc: 'עלים זקופים ועבים. הכריכה הכי עמידה בקטלוג, מתאימה למשרד.' },
  { id: 'p8', img: BLOB_IMG_BASE + 'p8.jpg', name: 'קוקודמה אופרקוליקריה', price: 270, size: 'קטנה', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'עלים עגולים קטנים על גבעולים אדומים. נראית כמו בונסאי צעיר.' },
  { id: 'p9', img: BLOB_IMG_BASE + 'p9.jpg', name: 'קוקודמה פיקוס בונסאי', price: 270, size: 'קטנה', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'גזע מעוצב וכיפת עלים קטנה. אפשר לגזום ולעצב פעמיים בשנה.' },
  { id: 'p10', img: BLOB_IMG_BASE + 'p10.jpg', name: 'קוקודמה פכירה', price: 270, size: 'בינונית', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'גבעולים קלועים וחמישה עלים ביד. נחשבת לצמח מזל, מתנה נפוצה.' },
  { id: 'p11', img: BLOB_IMG_BASE + 'p11.jpg', name: 'קוקודמה סינגוניום', price: 250, size: 'קטנה', light: 'אור עקיף בינוני', water: 'טבילה אחת לחמישה ימים', desc: 'עלי חץ ורודים־ירוקים. גדלה מהר וממלאת את הכריכה בחודשיים.' },
  { id: 'p12', img: BLOB_IMG_BASE + 'p12.jpg', name: 'קוקודמה פילודנדרון בירקין', price: 250, size: 'קטנה', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'פסים לבנים דקים על עלה כהה, שונים בכל עלה חדש.' },
  { id: 'p13', img: BLOB_IMG_BASE + 'p13.jpg', name: 'קוקודמה פוטוס', price: 250, size: 'תלייה', light: 'סובל גם מעט אור', water: 'טבילה אחת לשבוע', desc: 'גדל למטה עד מטר וחצי. הכריכה הסלחנית ביותר, טובה להתחלה.' },
  { id: 'p14', img: BLOB_IMG_BASE + 'p14.jpg', name: 'קוקודמה פיקוס גומי', price: 250, size: 'בינונית', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'עלים עבים ומבריקים בירוק כהה. עומד יפה גם בפינה חשופה.' },
  { id: 'p15', img: '', name: 'קוקודמה פיקוס כינורי', price: 250, size: 'גדולה', light: 'אור עקיף בהיר', water: 'טבילה אחת לשבוע', desc: 'עלים גדולים בצורת כינור. מבקש מקום קבוע ולא אוהב מעברים.' },
  { id: 'h2', img: BLOB_IMG_BASE + 'h2.jpg', cat: 'hydro', name: 'מונסטרה הידרופוני', price: 250, size: 'גדולה', light: 'אור עקיף בהיר', water: 'החלפת מים כל שבועיים', desc: 'עלה מבוקע ושורשים אוויריים באגרטל זכוכית גבוה. פריט הצהרה לפינת סלון.' },
  { id: 'h3', img: BLOB_IMG_BASE + 'h3.jpg', cat: 'hydro', name: 'פוטוס הידרופוני', price: 250, size: 'תלייה', light: 'סובל גם מעט אור', water: 'החלפת מים כל שבועיים', desc: 'גדל למטה מתוך צנצנת עם שורשים לבנים במים. הצמח הסלחני ביותר בסדרה.' },
  { id: 'h1', img: BLOB_IMG_BASE + 'h1.jpg', cat: 'hydro', name: 'אונטריום הידרופוני', price: 250, size: 'בינונית', light: 'אור עקיף בהיר', water: 'החלפת מים כל שבועיים', desc: 'עלים מבריקים כהים ופריחה אדומה בעונה, בכלי זכוכית עם שורשים חשופים במים צלולים.' },
  { id: 'p16', img: BLOB_IMG_BASE + 'p16.jpg', name: 'קוקודמה קלתאה אינסיגניס', price: 250, size: 'קטנה', light: 'צל חלקי', water: 'טבילה אחת לחמישה ימים', desc: 'עלים מנוקדים שנסגרים בלילה. צריכה לחות ומים בטמפרטורת החדר.' }
];

// Printed QR care tags point here — absolute, since they are scanned from
// paper with no page context to resolve a relative path against.
const SITE_URL = 'https://gayaplants.com/';

const STORY_IMG_1 = BLOB_IMG_BASE + 'story1.jpg';
const STORY_IMG_2 = BLOB_IMG_BASE + 'story2.jpg';
const LOGO_IMG = '/assets/images/gaya-logo.png';
