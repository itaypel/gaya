// GAYA — application logic, state and rendering. Ported from the Claude Design source
// (Gaya.dc.html) into a plain state -> render() -> innerHTML loop with delegated events.

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nl2br(str) { return esc(str).replace(/\n/g, '<br>'); }

// Deterrent only, not real access control: this runs entirely in the visitor's
// browser, so the passcode below is visible to anyone who opens the page source
// and can be bypassed by editing local state in devtools. It exists only to keep
// ordinary shoppers from wandering into the staff screens via the footer link.
// Once real orders/customers exist, this must be replaced by server-side auth —
// the admin screen must not ship in the same public bundle as the storefront.
const ADMIN_GATE_PASSCODE = 'gaya-staff-2026';

class App {
  constructor(root) {
    this.root = root;
    let admAuthed = false;
    try { admAuthed = sessionStorage.getItem('gaya_admin_ok') === '1'; } catch (e) {}
    this.state = {
      screen: 'home', cat: 'kokedama', prod: 'p1', cart: {}, open: false, navOpen: false, method: 'ship', pay: 'card',
      a11y: false, font: 100, contrast: false, links: false, scrolled: false, fading: false,
      admTab: 'products', site: Object.assign({}, SITE),
      ordFilter: 'all', ordStates: {}, ordOpenRef: null,
      admFilter: 'all', admForm: false, editId: null, edits: {}, removed: {}, stock: Object.assign({}, STOCK), extra: [],
      nf: this.blankNf(),
      admAuthed, admPass: '', admGateError: false
    };
    this._fadeT = null;
    root.addEventListener('click', (e) => this.handleClick(e));
    root.addEventListener('change', (e) => this.handleChange(e));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.admPass) {
        e.preventDefault();
        this.state.admPass = e.target.value;
        this.tryAdminGate();
      }
    });
    window.addEventListener('scroll', () => {
      const past = window.scrollY > 64;
      if (past !== this.state.scrolled) { this.state.scrolled = past; this.render(); }
    }, { passive: true });
    this.render();
  }

  setState(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    Object.assign(this.state, p);
    this.render();
  }
  nav(patch) { this.setState(patch); window.scrollTo(0, 0); }

  // ── data helpers (ported 1:1) ──────────────────────────────────────────
  catalog() {
    const { edits, removed } = this.state;
    return CATALOG.concat(this.state.extra)
      .filter((p) => !removed[p.id])
      .map((p) => (edits[p.id] ? Object.assign({}, p, edits[p.id]) : p));
  }
  ordCatalog() { return CATALOG.concat(this.state.extra); }
  ordStateOf(ref) { return this.state.ordStates[ref] || (ORDERS.find((o) => o.ref === ref) || {}).state || 'new'; }
  ordAdvanceRef(ref) {
    const next = ORD_STATE[this.ordStateOf(ref)].next;
    if (!next) return;
    this.setState((st) => ({ ordStates: Object.assign({}, st.ordStates, { [ref]: next }) }));
  }
  ordSubtotalOf(o) {
    return o.items.reduce((t, [id, q]) => {
      const p = this.ordCatalog().find((x) => x.id === id);
      return t + (p ? p.price * q : 0);
    }, 0);
  }
  ordShipOf(o) { const subtotal = this.ordSubtotalOf(o); return o.method === 'איסוף' || subtotal >= 300 ? 0 : 39; }
  ordTotalOf(o) { return this.ordSubtotalOf(o) + this.ordShipOf(o); }

  setSite(k, v) { this.setState((st) => ({ site: Object.assign({}, st.site, { [k]: v }) })); }
  resetSite() { this.setState({ site: Object.assign({}, SITE) }); }
  blankNf() { return { name: '', price: '', stock: '', cat: 'kokedama', size: '', light: '', water: '', desc: '' }; }

  openEditor(id) {
    const p = this.catalog().find((x) => x.id === id);
    if (!p) return;
    this.setState({
      admForm: true, editId: id,
      nf: { name: p.name, price: String(p.price), stock: String(this.stockOf(id)),
            cat: p.cat === 'hydro' ? 'hydro' : 'kokedama',
            size: p.size || '', light: p.light || '', water: p.water || '', desc: p.desc || '' }
    });
  }
  saveEdit() {
    const { editId, nf } = this.state;
    const name = (nf.name || '').trim();
    if (!editId || !name) return;
    const patch = {
      name, price: Number(nf.price) || 0,
      cat: nf.cat === 'hydro' ? 'hydro' : undefined,
      size: (nf.size || '').trim(), light: (nf.light || '').trim(),
      water: (nf.water || '').trim(), desc: (nf.desc || '').trim()
    };
    this.setState((st) => ({
      edits: Object.assign({}, st.edits, { [editId]: Object.assign({}, st.edits[editId], patch) }),
      stock: Object.assign({}, st.stock, { [editId]: Number(nf.stock) || 0 }),
      admForm: false, editId: null, nf: this.blankNf()
    }));
  }
  removeProduct() {
    const id = this.state.editId;
    if (!id) return;
    this.setState((st) => ({
      removed: Object.assign({}, st.removed, { [id]: true }),
      admForm: false, editId: null, nf: this.blankNf()
    }));
  }
  stockOf(id) { const v = this.state.stock[id]; return v === undefined ? 0 : v; }
  bumpStock(id, d) {
    this.setState((st) => {
      const stock = Object.assign({}, st.stock);
      stock[id] = Math.max(0, (stock[id] === undefined ? 0 : stock[id]) + d);
      return { stock };
    });
  }
  setNf(k, v) { this.setState((st) => ({ nf: Object.assign({}, st.nf, { [k]: v }) })); }
  saveNf() {
    const nf = this.state.nf;
    const name = (nf.name || '').trim();
    if (!name) return;
    const id = 'x' + (this.state.extra.length + 1);
    const item = {
      id, img: '', cat: nf.cat === 'hydro' ? 'hydro' : undefined,
      name, price: Number(nf.price) || 0,
      size: (nf.size || '').trim() || 'בינונית',
      light: (nf.light || '').trim() || 'אור עקיף בהיר',
      water: (nf.water || '').trim() || (nf.cat === 'hydro' ? 'החלפת מים כל שבועיים' : 'טבילה אחת לשבוע'),
      desc: (nf.desc || '').trim() || 'תיאור להשלמה.',
      isNew: true
    };
    this.setState((st) => ({
      extra: st.extra.concat([item]),
      stock: Object.assign({}, st.stock, { [id]: Number(nf.stock) || 0 }),
      admForm: false,
      nf: this.blankNf()
    }));
  }

  swapCat(cat) {
    if (cat === this.state.cat) return;
    this.setState({ fading: true });
    clearTimeout(this._fadeT);
    this._fadeT = setTimeout(() => this.setState({ cat, fading: false }), 220);
  }
  fmt(n) { return n.toLocaleString('he-IL') + ' ' + SHEKEL; }
  setQty(id, delta) {
    this.setState((s) => {
      const cart = Object.assign({}, s.cart);
      const next = (cart[id] || 0) + delta;
      if (next <= 0) delete cart[id]; else cart[id] = next;
      return { cart };
    });
  }
  add(id) {
    this.setQty(id, 1);
    const narrow = window.innerWidth < 900;
    if (!narrow) this.setState({ open: true });
  }
  cartCount() { return Object.values(this.state.cart).reduce((a, b) => a + b, 0); }

  // ── events ───────────────────────────────────────────────────────────
  handleClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    e.preventDefault();
    const act = el.dataset.act;
    const id = el.dataset.id;
    const s = this.state;
    switch (act) {
      case 'goHome': this.nav({ screen: 'home', navOpen: false }); break;
      case 'goKokedama': this.nav({ screen: 'category', cat: 'kokedama', navOpen: false }); break;
      case 'goHydro': this.nav({ screen: 'category', cat: 'hydro', navOpen: false }); break;
      case 'goCare': this.nav({ screen: 'care', navOpen: false }); break;
      case 'goCheckout': this.nav({ screen: 'checkout', open: false }); break;
      case 'goAdmin': this.nav(s.admAuthed ? { screen: 'admin' } : { screen: 'adminGate', admPass: '', admGateError: false }); break;
      case 'admGateSubmit': this.tryAdminGate(); break;
      case 'goAccess': this.nav({ screen: 'access', a11y: false }); break;
      case 'goTerms': this.nav({ screen: 'terms' }); break;
      case 'goCatFromProduct': {
        const prod = this.catalog().find((x) => x.id === s.prod) || CATALOG[0];
        this.nav({ screen: 'category', cat: prod.cat === 'hydro' ? 'hydro' : 'kokedama' });
        break;
      }
      case 'setKokedama': this.swapCat('kokedama'); break;
      case 'setHydro': this.swapCat('hydro'); break;
      case 'toggleCart': this.setState((st) => ({ open: !st.open })); break;
      case 'closeCart': this.setState({ open: false }); break;
      case 'toggleNav': this.setState((st) => ({ navOpen: !st.navOpen })); break;
      case 'closeNav': this.setState({ navOpen: false }); break;
      case 'openCartBar': this.setState({ open: true }); break;
      case 'open': this.nav({ screen: 'product', prod: id }); break;
      case 'add': this.add(id); break;
      case 'qtyInc': this.setQty(id, 1); break;
      case 'qtyDec': this.setQty(id, -1); break;
      case 'qtyRemove': this.setQty(id, -(s.cart[id] || 0)); break;
      case 'addCurrent': this.add(s.prod); break;
      case 'pickShip': this.setState({ method: 'ship' }); break;
      case 'pickPickup': this.setState({ method: 'pickup' }); break;
      case 'payCard': this.setState({ pay: 'card' }); break;
      case 'payApple': this.setState({ pay: 'apple' }); break;
      case 'payGoogle': this.setState({ pay: 'google' }); break;
      case 'expressApple': this.nav({ screen: 'checkout', open: false, pay: 'apple' }); break;
      case 'expressGoogle': this.nav({ screen: 'checkout', open: false, pay: 'google' }); break;
      case 'toggleA11y': this.setState((st) => ({ a11y: !st.a11y })); break;
      case 'closeA11y': this.setState({ a11y: false }); break;
      case 'fontUp': this.setState((st) => ({ font: Math.min(150, st.font + 10) })); break;
      case 'fontDown': this.setState((st) => ({ font: Math.max(90, st.font - 10) })); break;
      case 'toggleContrast': this.setState((st) => ({ contrast: !st.contrast })); break;
      case 'toggleLinks': this.setState((st) => ({ links: !st.links })); break;
      case 'resetA11y': this.setState({ font: 100, contrast: false, links: false }); break;
      case 'admGoProducts': this.setState({ admTab: 'products' }); break;
      case 'admGoOrders': this.setState({ admTab: 'orders' }); break;
      case 'admGoSite': this.setState({ admTab: 'site' }); break;
      case 'admShowAll': this.setState({ admFilter: 'all' }); break;
      case 'admShowKok': this.setState({ admFilter: 'kok' }); break;
      case 'admShowHyd': this.setState({ admFilter: 'hyd' }); break;
      case 'admShowLow': this.setState({ admFilter: 'low' }); break;
      case 'admShowNew': this.setState({ admFilter: 'new' }); break;
      case 'admEdit': this.openEditor(id); break;
      case 'admInc': this.bumpStock(id, 1); break;
      case 'admDec': this.bumpStock(id, -1); break;
      case 'admOpenNew': this.setState({ admForm: true, editId: null, nf: this.blankNf() }); break;
      case 'admCloseNew': this.setState({ admForm: false, editId: null, nf: this.blankNf() }); break;
      case 'nfSetKok': this.setNf('cat', 'kokedama'); break;
      case 'nfSetHyd': this.setNf('cat', 'hydro'); break;
      case 'nfSave': (s.editId ? this.saveEdit() : this.saveNf()); break;
      case 'nfDelete': this.removeProduct(); break;
      case 'ordShowAll': this.setState({ ordFilter: 'all' }); break;
      case 'ordShowNew': this.setState({ ordFilter: 'new' }); break;
      case 'ordShowPrep': this.setState({ ordFilter: 'prep' }); break;
      case 'ordShowSent': this.setState({ ordFilter: 'sent' }); break;
      case 'ordOpen': this.setState({ ordOpenRef: id }); break;
      case 'ordClose': this.setState({ ordOpenRef: null }); break;
      case 'ordAdvance': this.ordAdvanceRef(id || s.ordOpenRef); break;
      case 'siteReset': this.resetSite(); break;
      default: break;
    }
  }
  handleChange(e) {
    const t = e.target;
    if (t.dataset.siteKey) this.setSite(t.dataset.siteKey, t.value);
    else if (t.dataset.nfField) this.setNf(t.dataset.nfField, t.value);
    else if (t.dataset.admPass) this.state.admPass = t.value;
  }

  tryAdminGate() {
    if (this.state.admPass === ADMIN_GATE_PASSCODE) {
      try { sessionStorage.setItem('gaya_admin_ok', '1'); } catch (e) {}
      this.nav({ screen: 'admin', admAuthed: true, admPass: '' });
    } else {
      this.setState({ admGateError: true });
    }
  }

  // ── render ───────────────────────────────────────────────────────────
  render() {
    const s = this.state;
    const html = `
      <div style="flex: 1; min-width: 0">
        <a href="#main" class="skip">דילוג לתוכן הראשי</a>
        ${this.renderHeader()}
        <div id="main" role="main">
          ${s.screen === 'home' ? this.renderHome() : ''}
          ${s.screen === 'category' ? this.renderCategory() : ''}
          ${s.screen === 'product' ? this.renderProductScreen() : ''}
          ${s.screen === 'care' ? this.renderCare() : ''}
          ${s.screen === 'checkout' ? this.renderCheckout() : ''}
          ${s.screen === 'access' ? this.renderAccess() : ''}
          ${s.screen === 'terms' ? this.renderTerms() : ''}
          ${s.screen === 'adminGate' ? this.renderAdminGate() : ''}
          ${s.screen === 'admin' ? this.renderAdmin() : ''}
        </div>
        ${this.renderFooter()}
      </div>
      ${this.renderCartBar()}
      ${this.renderA11yWidget()}
      ${this.renderProductEditorPanel()}
      ${this.renderOrderPanel()}
      ${this.renderCartAside()}
      ${this.renderNavAside()}
    `;
    this.root.innerHTML = html;
    document.documentElement.style.fontSize = s.font + '%';
    document.documentElement.style.filter = s.contrast ? 'contrast(1.35) saturate(1.1)' : 'none';
    this.root.setAttribute('data-a11y-links', s.links ? '1' : '0');
  }

  // ── shared: product tile ────────────────────────────────────────────
  shape(p) {
    const stock = this.stockOf(p.id);
    return {
      id: p.id, name: p.name, size: p.size, desc: p.desc,
      bg: p.img ? `url('${p.img}')` : 'none',
      has3d: !!p.embed || !!p.model, noPhoto: !p.img && !p.embed && !p.model,
      stockLabel: stock === 0 ? 'לא זמין' : (stock <= 2 ? 'יחידות אחרונות' : 'זמין במלאי'),
      stockTag: stock === 0 ? 'tag-outline' : (stock <= 2 ? 'tag-accent' : 'tag-neutral'),
      soldOut: stock === 0, inStock: stock > 0,
      priceLabel: this.fmt(p.price)
    };
  }
  productCard(p, { featured = false } = {}) {
    const sh = this.shape(p);
    return `
      <article style="display: flex; flex-direction: column; gap: ${featured ? '14px' : '13px'}; min-width: 0">
        <div data-act="open" data-id="${p.id}" class="plate" role="img" aria-label="${esc(p.name)}" style="position: relative; aspect-ratio: 4/5; cursor: pointer; min-width: 0; overflow: hidden; background-color: var(--color-neutral-200); background-image: ${sh.bg}; background-size: cover; background-position: center">
          ${sh.has3d ? `<span style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--color-neutral-800)">${ICON.cube}<span style="font-family: var(--font-heading); font-size: 13px; letter-spacing: 0.22em">מודל תלת־ממדי</span></span>` : ''}
          ${sh.noPhoto ? `<span style="position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--font-heading); font-size: 13px; letter-spacing: 0.22em; color: var(--color-neutral-800)">בצילום</span>` : ''}
        </div>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px">
          <h3 style="font-size: 19px; font-weight: 400; min-width: 0"><a href="#" data-act="open" data-id="${p.id}" style="color: inherit">${esc(p.name)}</a></h3>
          <span style="flex: 0 0 auto; white-space: nowrap; font-size: 15px; font-variant-numeric: tabular-nums; color: var(--color-neutral-700)">${sh.priceLabel}</span>
        </div>
        ${!featured ? `<p style="margin: 0; font-size: 13.5px; line-height: 1.75; color: var(--color-neutral-700); min-height: 48px">${esc(p.desc)}</p>` : ''}
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap">
          <span style="display: flex; gap: 6px; flex-wrap: wrap">
            ${!featured ? `<span class="tag tag-neutral">${esc(p.size)}</span>` : ''}
            <span class="tag ${sh.stockTag}">${sh.stockLabel}</span>
            ${sh.has3d ? `<span class="tag tag-accent">תלת־ממד</span>` : ''}
          </span>
          ${sh.inStock ? `<button class="btn ${featured ? 'btn-secondary' : 'btn-primary'}" data-act="add" data-id="${p.id}">${featured ? 'הוספה לעגלה' : 'הוספה'}</button>` : ''}
          ${sh.soldOut ? `<button class="btn btn-secondary" disabled>אזל</button>` : ''}
        </div>
      </article>`;
  }

  // ── header / footer / floating chrome ──────────────────────────────
  renderHeader() {
    const s = this.state;
    const logoScale = s.scrolled ? 0.72 : 1;
    return `
    <header style="display: flex; align-items: center; gap: 20px; padding: ${s.scrolled ? '6px' : '10px'} var(--pg); border-bottom: 1px solid var(--color-divider); position: sticky; top: 0; background: var(--color-bg); z-index: 20; transition: padding 0.28s ease, box-shadow 0.28s ease; box-shadow: ${s.scrolled ? '0 1px 0 rgba(35,42,34,0.10), var(--shadow-sm)' : 'none'}">
      <a href="#" data-act="goHome" style="display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; flex: 0 0 auto">
        <img src="${LOGO_IMG}" alt="GAYA" style="height: calc(var(--logo-h, 34px) * ${logoScale}); width: auto; display: block; transition: height 0.28s ease">
        <span style="font-family: var(--font-heading); font-size: 20px; font-weight: 400; letter-spacing: 0.12em; overflow: hidden; white-space: nowrap; flex: 0 0 auto; transition: max-width 0.3s ease, opacity 0.24s ease; max-width: ${s.scrolled ? '0px' : '120px'}; opacity: ${s.scrolled ? 0 : 1}">GAYA</span>
      </a>
      <nav style="display: var(--nav-display, flex); gap: 28px; font-size: 15px; margin-inline-start: auto; margin-inline-end: 8px">
        <a href="#" data-act="goHome">דף הבית</a>
        <a href="#" data-act="goKokedama">קוקודמות</a>
        <a href="#" data-act="goHydro">הידרופוני</a>
        <a href="#" data-act="goCare">טיפוח</a>
      </nav>
      <button class="btn btn-secondary btn-icon" data-act="toggleNav" aria-label="פתיחת תפריט" aria-expanded="${s.navOpen}" style="display: var(--menu-btn-display, none); margin-inline-start: auto">${ICON.menu}</button>
      <button class="btn btn-primary" data-act="toggleCart" style="gap: 8px; margin-inline-start: auto; white-space: nowrap; padding: 7px 14px; min-height: 0; font-size: 14px">
        ${ICON.bag}<span>עגלה</span><span style="font-variant-numeric: tabular-nums">(${this.cartCount()})</span>
      </button>
    </header>`;
  }

  renderNavAside() {
    const s = this.state;
    return `
    <div data-act="closeNav" aria-hidden="true" style="position: fixed; inset: 0; z-index: 64; background: rgba(24,30,24,0.34); transition: opacity 0.3s ease; display: var(--nav-drawer-display, none); opacity: ${s.navOpen ? 1 : 0}; pointer-events: ${s.navOpen ? 'auto' : 'none'}"></div>
    <aside role="dialog" aria-label="תפריט" style="position: fixed; inset-block: 0; inset-inline-start: 0; z-index: 66; width: min(300px, 84vw); background: var(--color-neutral-100); border-inline-end: 1px solid var(--color-divider); box-shadow: var(--shadow-lg); display: var(--nav-drawer-display, none); transition: transform 0.32s cubic-bezier(0.22,0.61,0.36,1), visibility 0s linear ${s.navOpen ? '0s' : '0.32s'}; transform: ${s.navOpen ? 'translateX(0)' : 'translateX(105%)'}; visibility: ${s.navOpen ? 'visible' : 'hidden'}">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 21px 26px; border-bottom: 1px solid var(--color-divider)">
        <span style="font-family: var(--font-heading); font-size: 19px; font-weight: 400; letter-spacing: 0.12em">GAYA</span>
        <button class="btn btn-secondary btn-icon" data-act="closeNav" aria-label="סגירת התפריט">${ICON.close16}</button>
      </div>
      <nav style="display: flex; flex-direction: column; padding: 10px; gap: 2px; font-size: 16px">
        <a href="#" data-act="goHome" style="padding: 15px 16px">דף הבית</a>
        <a href="#" data-act="goKokedama" style="padding: 15px 16px">קוקודמות</a>
        <a href="#" data-act="goHydro" style="padding: 15px 16px">הידרופוני</a>
        <a href="#" data-act="goCare" style="padding: 15px 16px">טיפוח</a>
      </nav>
    </aside>`;
  }

  renderFooter() {
    const s = this.state;
    const cartBarShown = !s.open && this.cartCount() > 0 && s.screen !== 'checkout' && s.screen !== 'admin' && s.screen !== 'adminGate';
    return `
    <footer style="padding: clamp(44px, 6vw, 68px) var(--pg) ${cartBarShown ? 'calc(48px + var(--cart-bar-h, 0px))' : '48px'}; border-top: 1px solid var(--color-divider); font-size: 13.5px; color: var(--color-neutral-600)">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: clamp(28px, 4vw, 56px); align-items: start">
        <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
          <img src="${LOGO_IMG}" alt="GAYA" style="height: 52px; width: auto; align-self: flex-start; display: block">
          <span style="line-height: 1.8; max-width: 34ch">${esc(s.site.footer)}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 11px; min-width: 0">
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.28em; color: var(--color-accent-700)">חנות</span>
          <a href="#" data-act="goKokedama">קוקודמות</a>
          <a href="#" data-act="goHydro">הידרופוני</a>
          <a href="#" data-act="goCare">מדריך טיפוח</a>
        </div>
        <div style="display: flex; flex-direction: column; gap: 11px; min-width: 0">
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.28em; color: var(--color-accent-700)">מידע</span>
          <a href="#" data-act="goTerms">תקנון, ביטולים ופרטיות</a>
          <a href="#" data-act="goAccess">הצהרת נגישות</a>
        </div>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-top: clamp(30px, 4vw, 46px); padding-top: 20px; border-top: 1px solid var(--color-divider)">
        <span style="font-family: var(--font-heading); font-size: 12px; letter-spacing: 0.16em; color: var(--color-neutral-700)">GAYA · סטודיו צמחים · רחובות</span>
        <span style="display: flex; align-items: center; gap: 14px">
          <span>כל הזכויות שמורות</span>
          <a href="#" data-act="goAdmin" style="font-size: 11px; color: var(--color-neutral-500)">כניסת צוות</a>
        </span>
      </div>
    </footer>`;
  }

  renderCartBar() {
    const s = this.state;
    const shown = !s.open && this.cartCount() > 0 && s.screen !== 'checkout' && s.screen !== 'admin' && s.screen !== 'adminGate';
    return `
    <div style="position: fixed; inset-block-end: 0; inset-inline: 0; z-index: 57; display: var(--cart-bar, none); pointer-events: ${shown ? 'auto' : 'none'}; transform: ${shown ? 'translateY(0)' : 'translateY(105%)'}; transition: transform 0.3s cubic-bezier(0.22,0.61,0.36,1)">
      <button data-act="openCartBar" style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 20px calc(14px + env(safe-area-inset-bottom)); min-height: 60px; border: 0; border-top: 1px solid var(--color-accent); background: var(--color-accent-100); box-shadow: 0 -6px 22px rgba(24,30,24,0.12); font-family: var(--font-body); color: var(--color-accent-900); cursor: pointer">
        <span style="display: flex; align-items: center; gap: 11px">
          ${ICON.bagLg}
          <span style="font-size: 15px">לעגלה</span>
          <span style="display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border: 1px solid var(--color-accent-700); border-radius: 999px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--color-accent-900)">${this.cartCount()}</span>
        </span>
        <span style="display: flex; align-items: center; gap: 10px">
          <span style="font-family: var(--font-heading); font-size: 19px; font-variant-numeric: tabular-nums">${this.fmt(this.subtotal())}</span>
          ${ICON.chevronBack}
        </span>
      </button>
    </div>`;
  }

  renderA11yWidget() {
    const s = this.state;
    return `
    <div data-act="closeA11y" aria-hidden="true" style="position: fixed; inset: 0; z-index: 69; background: transparent; display: ${s.a11y ? 'block' : 'none'}"></div>
    <button data-act="toggleA11y" aria-label="תפריט נגישות" aria-expanded="${s.a11y}" class="btn btn-secondary btn-icon" style="position: fixed; inset-inline-end: 18px; bottom: var(--a11y-b, 18px); z-index: 70; width: 46px; height: 46px; border-radius: 999px; background: var(--color-bg); box-shadow: var(--shadow-md)">${ICON.a11y}</button>
    <aside role="dialog" aria-label="הגדרות נגישות" style="position: fixed; inset-inline-end: 18px; bottom: var(--a11y-p, 74px); z-index: 70; width: 268px; background: var(--color-bg); border: 1px solid var(--color-divider); border-radius: var(--radius-sm); box-shadow: var(--shadow-lg); padding: 18px; display: ${s.a11y ? 'flex' : 'none'}; flex-direction: column; gap: 14px">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px">
        <h2 style="font-size: 17px; font-weight: 400">נגישות</h2>
        <button class="btn btn-secondary btn-icon" data-act="closeA11y" aria-label="סגירת תפריט הנגישות">${ICON.close}</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px">
        <span style="font-size: 12px; letter-spacing: 0.14em; color: var(--color-neutral-600)">גודל טקסט</span>
        <div class="seg">
          <button class="seg-opt" data-act="fontDown" aria-label="הקטנת טקסט">${ICON.minus}</button>
          <span class="seg-opt" style="min-width: 58px; justify-content: center; font-variant-numeric: tabular-nums">${s.font}%</span>
          <button class="seg-opt" data-act="fontUp" aria-label="הגדלת טקסט">${ICON.plus}</button>
        </div>
      </div>
      <button class="btn ${s.contrast ? 'btn-primary' : 'btn-secondary'}" data-act="toggleContrast" aria-pressed="${s.contrast}">ניגודיות גבוהה</button>
      <button class="btn ${s.links ? 'btn-primary' : 'btn-secondary'}" data-act="toggleLinks" aria-pressed="${s.links}">הדגשת קישורים</button>
      <button class="btn btn-ghost" data-act="resetA11y">איפוס</button>
      <hr class="hr" style="margin: 2px 0">
      <a href="#" data-act="goAccess" style="font-size: 13px">הצהרת הנגישות המלאה</a>
    </aside>`;
  }

  subtotal() {
    const s = this.state;
    return Object.keys(s.cart).reduce((sum, id) => {
      const p = this.catalog().find((x) => x.id === id);
      return sum + (p ? p.price * s.cart[id] : 0);
    }, 0);
  }

  renderCartAside() {
    const s = this.state;
    const subtotal = this.subtotal();
    const pickup = s.method === 'pickup';
    const freeShip = subtotal >= 300;
    const shipping = subtotal === 0 || pickup || freeShip ? 0 : 39;
    const lines = Object.keys(s.cart).map((id) => {
      const p = this.catalog().find((x) => x.id === id);
      const qty = s.cart[id];
      return { id, name: p.name, qty, lineLabel: this.fmt(p.price * qty) };
    });
    return `
    <div data-act="closeCart" aria-hidden="true" style="position: fixed; inset: 0; z-index: 58; background: rgba(24,30,24,0.34); transition: opacity 0.3s ease; display: var(--cart-scrim, none); opacity: ${s.open ? 1 : 0}; pointer-events: ${s.open ? 'auto' : 'none'}"></div>
    <aside data-cart="1" style="position: var(--cart-pos, sticky); top: 0; height: 100vh; flex: 0 0 auto; overflow: hidden; border-inline-end: 1px solid var(--color-divider); background: var(--color-neutral-100); transition: width 0.34s cubic-bezier(0.22,0.61,0.36,1), visibility 0s linear ${s.open ? '0s' : '0.34s'}; width: ${s.open ? 'var(--cart-w)' : '0px'}; visibility: ${s.open ? 'visible' : 'hidden'}">
      <div style="width: var(--cart-w); height: 100%; display: flex; flex-direction: column">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 21px 26px; border-bottom: 1px solid var(--color-divider)">
          <h2 style="font-size: 22px; font-weight: 400">העגלה</h2>
          <button class="btn btn-secondary btn-icon" data-act="closeCart" aria-label="סגירת העגלה">${ICON.close16}</button>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 0 26px">
          ${lines.length === 0 ? `<div style="padding: 70px 0; text-align: center; color: var(--color-neutral-600); font-size: 14px; line-height: 1.9">העגלה ריקה.<br>אפשר להתחיל בכריכה אחת.</div>` : ''}
          ${lines.map((l) => `
          <div style="display: grid; grid-template-columns: 62px 1fr; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--color-divider)">
            <div style="width: 62px; height: 78px; border: 1px solid var(--color-divider); background: var(--color-surface)"></div>
            <div style="display: flex; flex-direction: column; gap: 7px">
              <div style="display: flex; justify-content: space-between; gap: 10px; align-items: baseline">
                <span style="font-family: var(--font-heading); font-size: 16px">${esc(l.name)}</span>
                <span style="font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--color-neutral-700)">${l.lineLabel}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 14px; margin-top: 3px">
                <div class="seg">
                  <button class="seg-opt" data-act="qtyDec" data-id="${l.id}" aria-label="הפחתה">${ICON.minus15}</button>
                  <span class="seg-opt" style="min-width: 34px; justify-content: center; font-variant-numeric: tabular-nums">${l.qty}</span>
                  <button class="seg-opt" data-act="qtyInc" data-id="${l.id}" aria-label="הוספה">${ICON.plus15}</button>
                </div>
                <button class="btn btn-ghost" data-act="qtyRemove" data-id="${l.id}" style="border: 0; font-size: 13px">הסרה</button>
              </div>
            </div>
          </div>`).join('')}
        </div>
        <div style="border-top: 1px solid var(--color-divider); padding: 22px 26px 26px; display: flex; flex-direction: column; gap: 12px">
          <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--color-neutral-700)"><span>משלוח</span><span style="font-variant-numeric: tabular-nums">${subtotal === 0 ? '—' : (pickup ? 'איסוף' : (freeShip ? 'חינם' : this.fmt(39)))}</span></div>
          <div style="display: flex; justify-content: space-between; align-items: baseline">
            <span style="font-size: 15px">סה״כ</span>
            <span style="font-family: var(--font-heading); font-size: 26px; font-variant-numeric: tabular-nums">${this.fmt(subtotal + shipping)}</span>
          </div>
          <p style="margin: 0; font-size: 12px; line-height: 1.7; color: var(--color-neutral-600)">${subtotal === 0 ? 'משלוח חינם בהזמנה מעל 300 ₪.' : (pickup ? 'איסוף מהסטודיו ברחובות, בלי עלות משלוח.' : (freeShip ? 'המשלוח כלול בהזמנה.' : 'עוד ' + this.fmt(300 - subtotal) + ' למשלוח חינם.'))}</p>
          <button class="btn btn-primary btn-block" data-act="goCheckout" style="min-height: 46px">לתשלום</button>
          <div style="display: flex; align-items: center; gap: 10px; margin: 2px 0">
            <hr class="hr" style="flex: 1; margin: 0"><span style="font-size: 11px; letter-spacing: 0.18em; color: var(--color-neutral-600)">או</span><hr class="hr" style="flex: 1; margin: 0">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
            <button class="btn btn-secondary" data-act="expressApple" style="gap: 6px; padding: 8px 10px; font-size: 13px">${ICON.appleSm}<span>Apple&nbsp;Pay</span></button>
            <button class="btn btn-secondary" data-act="expressGoogle" style="gap: 6px; padding: 8px 10px; font-size: 13px">${ICON.googleSm}<span>Google&nbsp;Pay</span></button>
          </div>
        </div>
      </div>
    </aside>`;
  }

  // ── HOME ─────────────────────────────────────────────────────────────
  renderHome() {
    const s = this.state;
    const site = s.site;
    const kok = s.cat === 'kokedama';
    const all = this.catalog();
    const featured = ['p1', 'p5', 'p9', 'h1'].map((id) => all.find((x) => x.id === id)).filter(Boolean);
    const catItems = all.filter((p) => (kok ? p.cat !== 'hydro' : p.cat === 'hydro'));
    const catTitle = kok ? site.kokTitle : site.hydTitle;
    const catBlurb = kok ? site.kokBlurb : site.hydBlurb;
    return `
    <div data-screen-label="בית">
      <section style="position: relative; min-height: 92vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(30px, 5vh, 56px); padding: clamp(56px, 10vh, 120px) var(--pg) clamp(48px, 8vh, 92px); text-align: center; background: var(--color-bg); border-bottom: 1px solid var(--color-divider)">
        <img src="${LOGO_IMG}" alt="GAYA — styled by nature" style="width: clamp(240px, 44vw, 520px); height: auto; display: block">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 62ch">
          <span style="font-family: var(--font-heading); font-size: 12px; letter-spacing: 0.3em; color: var(--color-accent-700)">${esc(site.heroKicker)}</span>
          <h1 style="font-size: clamp(30px, 3.8vw, 54px); font-weight: 400; line-height: 1.1; text-wrap: pretty; max-width: 22ch">${esc(site.heroTitle)}</h1>
          <hr class="hr" style="width: 64px; margin: 4px 0">
          <p style="font-size: clamp(15px, 1.2vw, 17.5px); line-height: 1.9; margin: 0; color: var(--color-neutral-700)">${esc(site.heroBody)}</p>
          <div style="display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; justify-content: center">
            <button class="btn btn-primary" data-act="goKokedama" style="font-size: 17px; padding: 15px 34px">${esc(site.heroCta1)}</button>
            <button class="btn btn-secondary" data-act="goCare" style="font-size: 17px; padding: 15px 34px">${esc(site.heroCta2)}</button>
          </div>
        </div>
      </section>

      <section style="padding: clamp(48px, 7vw, 86px) var(--pg); border-bottom: 1px solid var(--color-divider)">
        <div style="display: flex; align-items: baseline; gap: 18px; margin-bottom: 34px">
          <span aria-hidden="true" style="font-family: var(--font-heading); font-size: clamp(30px, 3.4vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">I</span>
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">${esc(site.storyKicker)}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(330px, 100%), 1fr)); gap: clamp(30px, 4vw, 60px); align-items: stretch">
          <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
            <h2 style="font-size: clamp(27px, 2.9vw, 38px); font-weight: 400; line-height: 1.16; text-wrap: pretty">${esc(site.storyTitle)}</h2>
            <p style="margin: 0; font-size: 16.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(site.storyIntro)}</p>
            <hr class="hr" style="margin: 2px 0">
            <p style="margin: 0; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(site.storyFounders)}</p>
            <div class="plate" style="position: relative; flex: 1; min-height: clamp(220px, 24vw, 340px); min-width: 0; overflow: hidden"><img src="${STORY_IMG_2}" alt="פינה בסטודיו"></div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
            <div class="plate" style="position: relative; aspect-ratio: 4/5; min-width: 0; overflow: hidden"><img src="${STORY_IMG_1}" alt="הסטודיו של GAYA"></div>
            <div style="display: flex; flex-direction: column; gap: 12px">
              <h3 style="font-size: 22px; font-weight: 400">${esc(site.kokedamaQ)}</h3>
              <p style="margin: 0; font-size: 15px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(site.kokedamaA)}</p>
            </div>
          </div>
        </div>
      </section>

      <section style="padding: clamp(48px, 7vw, 86px) var(--pg); border-bottom: 1px solid var(--color-divider)">
        <div style="display: flex; align-items: baseline; gap: 18px; margin-bottom: 30px">
          <span aria-hidden="true" style="font-family: var(--font-heading); font-size: clamp(30px, 3.4vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">II</span>
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">${esc(site.beyondKicker)}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(330px, 100%), 1fr)); gap: clamp(28px, 4vw, 60px); align-items: start">
          <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0">
            <h2 style="font-size: clamp(26px, 2.7vw, 36px); font-weight: 400; line-height: 1.16; text-wrap: pretty">${esc(site.beyondTitle)}</h2>
            <p style="margin: 0; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(site.beyondIntro)}</p>
            <hr class="hr" style="margin: 2px 0">
            <p style="margin: 0; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(site.beyondClose)}</p>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0; min-width: 0">
            ${[['א׳', site.series1H, site.series1B], ['ב׳', site.series2H, site.series2B], ['ג׳', site.series3H, site.series3B]].map(([num, h, b], i) => `
            <div style="display: grid; grid-template-columns: 34px 1fr; gap: 16px; align-items: start; padding: ${i === 0 ? '0 0 22px' : (i === 2 ? '22px 0 0' : '22px 0')}">
              <span aria-hidden="true" style="font-family: var(--font-heading); font-size: 22px; font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">${num}</span>
              <div><h3 style="font-size: 20px; font-weight: 400; margin-bottom: 8px">${esc(h)}</h3><p style="margin: 0; font-size: 14.5px; line-height: 1.85; text-align: justify; color: var(--color-neutral-700)">${esc(b)}</p></div>
            </div>
            ${i < 2 ? '<hr class="hr" style="margin: 0">' : ''}`).join('')}
          </div>
        </div>
      </section>

      <section style="padding: clamp(44px, 6vw, 72px) var(--pg); border-bottom: 1px solid var(--color-divider)">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 32px; margin-bottom: 40px">
          <div style="display: flex; align-items: baseline; gap: 18px">
            <span aria-hidden="true" style="font-family: var(--font-heading); font-size: clamp(30px, 3.4vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">III</span>
            <h2 style="font-size: 34px; font-weight: 400">${esc(site.featured)}</h2>
          </div>
          <button class="btn btn-ghost" data-act="goKokedama" style="gap: 8px"><span>${esc(site.featuredLink)}</span>${ICON.chevronLeft}</button>
        </div>
        <div style="display: grid; grid-template-columns: var(--cards, repeat(4, minmax(0, 1fr))); gap: var(--cards-gap, 44px 30px)">
          ${featured.map((p) => this.productCard(p, { featured: true })).join('')}
        </div>
      </section>

      <section style="padding: clamp(44px, 6vw, 68px) var(--pg) 30px; border-top: 1px solid var(--color-divider)">
        <div style="display: flex; align-items: baseline; gap: 18px">
          <span aria-hidden="true" style="font-family: var(--font-heading); font-size: clamp(30px, 3.4vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">IV</span>
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">קטלוג</span>
        </div>
        <h2 style="font-size: clamp(32px, 3.4vw, 44px); font-weight: 400; margin: 14px 0 18px">${esc(catTitle)}</h2>
        <p style="font-size: 16px; line-height: 1.85; text-align: justify; max-width: 62ch; margin: 0; color: var(--color-neutral-800)">${esc(catBlurb)}</p>
        <div style="display: flex; gap: 10px; margin-top: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--color-divider)">
          <button class="btn ${kok ? 'btn-primary' : 'btn-secondary'}" data-act="setKokedama">קוקודמות</button>
          <button class="btn ${kok ? 'btn-secondary' : 'btn-primary'}" data-act="setHydro">הידרופוני</button>
          <span style="margin-inline-start: auto; align-self: center; font-size: 13px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums">${catItems.length} ${catItems.length === 1 ? 'פריט' : 'פריטים'}</span>
        </div>
      </section>

      <section style="padding: 38px var(--pg) 80px">
        <div style="display: grid; grid-template-columns: var(--cards, repeat(auto-fill, minmax(min(230px, 100%), 1fr))); gap: var(--cards-gap, 48px 30px); transition: opacity 0.22s ease; opacity: ${s.fading ? 0 : 1}">
          ${catItems.map((p) => this.productCard(p)).join('')}
        </div>
      </section>

      <section style="padding: clamp(44px, 6vw, 68px) var(--pg); border-top: 1px solid var(--color-divider)">
        <div style="display: flex; align-items: baseline; gap: 18px; margin-bottom: 34px">
          <span aria-hidden="true" style="font-family: var(--font-heading); font-size: clamp(30px, 3.4vw, 46px); font-weight: 300; font-variant-numeric: tabular-nums; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">V</span>
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">טיפוח</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 44px">
          ${[['א׳', site.care1H, site.care1B], ['ב׳', site.care2H, site.care2B], ['ג׳', site.care3H, site.care3B]].map(([num, h, b]) => `
          <div style="display: grid; grid-template-columns: 30px 1fr; gap: 16px; align-items: start">
            <span style="font-family: var(--font-heading); font-size: 20px; color: var(--color-accent)">${num}</span>
            <div><h4 style="font-size: 19px; font-weight: 400; margin-bottom: 8px">${esc(h)}</h4><p style="margin: 0; font-size: 14px; line-height: 1.85; color: var(--color-neutral-700)">${esc(b)}</p></div>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
  }

  // ── CATEGORY ─────────────────────────────────────────────────────────
  renderCategory() {
    const s = this.state;
    const site = s.site;
    const kok = s.cat === 'kokedama';
    const all = this.catalog();
    const catItems = all.filter((p) => (kok ? p.cat !== 'hydro' : p.cat === 'hydro'));
    const catTitle = kok ? site.kokTitle : site.hydTitle;
    const catBlurb = kok ? site.kokBlurb : site.hydBlurb;
    return `
    <div data-screen-label="קטגוריה">
      <section style="padding: clamp(36px, 5vw, 56px) var(--pg) 30px">
        <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">קטלוג</span>
        <h1 style="font-size: clamp(34px, 3.6vw, 48px); font-weight: 400; margin: 14px 0 20px">${esc(catTitle)}</h1>
        <p style="font-size: 16px; line-height: 1.85; text-align: justify; max-width: 62ch; margin: 0; color: var(--color-neutral-800)">${esc(catBlurb)}</p>
        <div style="display: flex; gap: 10px; margin-top: 30px; padding-bottom: 26px; border-bottom: 1px solid var(--color-divider)">
          <button class="btn ${kok ? 'btn-primary' : 'btn-secondary'}" data-act="goKokedama">קוקודמות</button>
          <button class="btn ${kok ? 'btn-secondary' : 'btn-primary'}" data-act="goHydro">הידרופוני</button>
          <span style="margin-inline-start: auto; align-self: center; font-size: 13px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums">${catItems.length} ${catItems.length === 1 ? 'פריט' : 'פריטים'}</span>
        </div>
      </section>
      <section style="padding: 40px var(--pg) 84px">
        <div style="display: grid; grid-template-columns: var(--cards, repeat(auto-fill, minmax(min(230px, 100%), 1fr))); gap: var(--cards-gap, 48px 30px)">
          ${catItems.map((p) => this.productCard(p)).join('')}
        </div>
      </section>
    </div>`;
  }

  // ── PRODUCT ──────────────────────────────────────────────────────────
  renderProductScreen() {
    const s = this.state;
    const all = this.catalog();
    const prod = all.find((x) => x.id === s.prod) || CATALOG[0];
    const stock = this.stockOf(prod.id);
    const stockLabel = stock === 0 ? 'לא זמין' : (stock <= 2 ? 'יחידות אחרונות' : 'זמין במלאי');
    const stockTag = stock === 0 ? 'tag-outline' : (stock <= 2 ? 'tag-accent' : 'tag-neutral');
    const relPool = all.filter((p) => p.id !== prod.id && p.light === prod.light);
    const related = relPool.slice()
      .sort((a, b) => (a.water === prod.water ? 0 : 1) - (b.water === prod.water ? 0 : 1))
      .slice(0, 3);
    const desc = prod.desc + (prod.cat === 'hydro'
      ? ' הצמח מגיע בכלי זכוכית עם רשת שורשים ואבני חלוקים. מחליפים מים כל שבועיים ומוסיפים שתי טיפות תמיסת מזון, ומשאירים את שליש השורשים העליון חשוף לאוויר.'
      : ' הכריכה נעשית ביד בכרית קוקוס וטחב ספגנום, בקוטר המתאים לגודל הצמח, וקשורה בחוט כותנה. משקים בטבילה, בלי אדמה ובלי עציץ.');
    return `
    <div data-screen-label="מוצר">
      <nav style="padding: 22px var(--pg); font-size: 13px; color: var(--color-neutral-600); display: flex; gap: 8px; align-items: center">
        <a href="#" data-act="goHome">בית</a><span style="opacity: 0.5">${ICON.crumb}</span>
        <a href="#" data-act="goCatFromProduct">${prod.cat === 'hydro' ? 'הידרופוני' : 'קוקודמות'}</a><span style="opacity: 0.5">${ICON.crumb}</span>
        <span>${esc(prod.name)}</span>
      </nav>
      <section style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr)); gap: 56px; padding: 12px var(--pg) 80px; align-items: start">
        <div style="display: grid; gap: 14px; min-width: 0">
          ${prod.model ? `
          <div class="plate" style="position: relative; aspect-ratio: 4/5; min-width: 0; overflow: hidden">
            <model-viewer src="${esc(prod.model)}" alt="${esc(prod.name)} — סריקה תלת־ממדית" camera-controls auto-rotate loading="eager" interaction-prompt="none" interpolation-decay="200" shadow-intensity="1" style="position: absolute; inset: 0; width: 100%; height: 100%; background: var(--color-neutral-200); display: block"></model-viewer>
          </div>
          <p style="margin: 0; font-size: 13px; line-height: 1.75; color: var(--color-neutral-600)">סריקה תלת־ממדית — מסתובבת לבד, ואפשר לגרור כדי לסובב ידנית.</p>
          ` : prod.embed ? `
          <div class="plate" style="position: relative; aspect-ratio: 4/5; min-width: 0; overflow: hidden">
            <iframe src="${prod.embed}" title="${esc(prod.name)} — סריקה תלת־ממדית" allow="fullscreen; xr-spatial-tracking" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block"></iframe>
          </div>
          <p style="margin: 0; font-size: 13px; line-height: 1.75; color: var(--color-neutral-600)">סריקה תלת־ממדית — מסתובבת לבד, ואפשר לגרור כדי לסובב ידנית.</p>
          ` : `
          <div class="plate" style="position: relative; aspect-ratio: 4/5; min-width: 0; overflow: hidden; background: var(--color-neutral-200)">
            ${prod.img ? `<img src="${prod.img}" alt="${esc(prod.name)}">` : `<span style="position:absolute; inset:0; display:grid; place-items:center; font-family: var(--font-heading); font-size: 13px; letter-spacing: 0.22em; color: var(--color-neutral-800)">בצילום</span>`}
          </div>`}
          ${related.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 16px; padding-top: 8px">
            <div style="display: flex; align-items: baseline; gap: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--color-divider)">
              ${ICON.dot}
              <h2 style="font-size: 19px; font-weight: 400">צמחים באותם תנאים</h2>
            </div>
            <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">כולם מבקשים ${esc(prod.light)} — אפשר להעמיד אותם באותה פינה. קצב ההשקיה מצוין מתחת לכל אחד.</p>
            <div style="display: grid; grid-template-columns: var(--rel, repeat(3, minmax(0, 1fr))); gap: 14px">
              ${related.map((r) => `
              <article style="display: flex; flex-direction: column; gap: 9px; min-width: 0">
                <div data-act="open" data-id="${r.id}" class="plate" role="img" aria-label="${esc(r.name)}" style="position: relative; aspect-ratio: 1; cursor: pointer; min-width: 0; overflow: hidden; background-color: var(--color-neutral-200); background-image: ${r.img ? `url('${r.img}')` : 'none'}; background-size: cover; background-position: center">
                  ${!r.img && !r.embed && !r.model ? `<span style="position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--font-heading); font-size: 12px; letter-spacing: 0.2em; color: var(--color-neutral-800)">בצילום</span>` : ''}
                  ${r.embed || r.model ? `<span style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--color-neutral-800)">${ICON.cubeSm}<span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.18em">תלת־ממד</span></span>` : ''}
                </div>
                <a href="#" data-act="open" data-id="${r.id}" style="font-size: 14px; line-height: 1.5; color: inherit">${esc(r.name)}</a>
                <span style="font-size: 13px; font-variant-numeric: tabular-nums; color: var(--color-neutral-700)">${this.fmt(r.price)}</span>
                <span style="font-size: 12px; line-height: 1.5; color: var(--color-neutral-700)">${esc(r.water)}</span>
              </article>`).join('')}
            </div>
          </div>` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 22px; padding-top: 10px">
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">${prod.cat === 'hydro' ? 'הידרופוני · שורשים במים' : 'קוקודמה · כריכת יד'}</span>
          <h1 style="font-size: clamp(30px, 3.2vw, 44px); font-weight: 400; line-height: 1.14">${esc(prod.name)}</h1>
          <span style="display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap">
            <span style="font-size: 24px; font-family: var(--font-heading); font-variant-numeric: tabular-nums">${this.fmt(prod.price)}</span>
            <span class="tag ${stockTag}">${stockLabel}</span>
          </span>
          <p style="margin: 0; font-size: 16px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">${esc(desc)}</p>
          <hr class="hr">
          <table class="table">
            <tbody>
              <tr><td style="color: var(--color-neutral-600); width: 34%">גודל</td><td>${esc(prod.size)}</td></tr>
              <tr><td style="color: var(--color-neutral-600)">אור</td><td>${esc(prod.light)}</td></tr>
              <tr><td style="color: var(--color-neutral-600)">השקיה</td><td>${esc(prod.water)}</td></tr>
              <tr><td style="color: var(--color-neutral-600)">כולל</td><td>מגש ניקוז וכרטיס טיפוח</td></tr>
            </tbody>
          </table>
          <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px">
            ${stock > 0 ? `<button class="btn btn-primary" data-act="addCurrent" style="flex: 1; min-height: 46px">הוספה לעגלה</button>` : `<button class="btn btn-secondary" disabled style="flex: 1; min-height: 46px">אזל מהמלאי</button>`}
            <button class="btn btn-secondary" data-act="goKokedama" style="min-height: 46px">לקטלוג</button>
          </div>
          <p style="margin: 0; font-size: 13px; color: var(--color-neutral-600)">משלוח חינם בהזמנה מעל 300 ₪ · שניים עד ארבעה ימי עסקים</p>
        </div>
      </section>
    </div>`;
  }

  // ── CARE ─────────────────────────────────────────────────────────────
  renderCare() {
    return `
    <div data-screen-label="טיפוח">
      <section style="padding: clamp(36px, 5vw, 60px) var(--pg) 84px; max-width: 900px">
        <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">מדריך</span>
        <h1 style="font-size: clamp(34px, 3.6vw, 48px); font-weight: 400; margin: 14px 0 28px">איך מטפחים קוקודמה</h1>
        <div style="columns: 2 300px; column-gap: 48px; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">
          <p style="margin: 0 0 18px">קוקודמה היא צמח ששורשיו כרוכים בכרית קוקוס וטחב במקום עציץ. הכרית מחזיקה לחות ומשחררת אותה בהדרגה, ולכן הטיפול בה שונה מטיפול בצמח בעציץ: לא משקים מלמעלה, אלא מטבילים.</p>
          <p style="margin: 0 0 18px">אחת לשבוע ממלאים קערה במים בטמפרטורת החדר, מניחים את הכרית בתוכה ומחכים עשר דקות עד שהיא סופגת. מוציאים, נותנים לעודפים לטפטף בכיור חמש דקות, ומחזירים למקום. בקיץ אפשר להוסיף ריסוס קל על העלים בין הטבילות.</p>
          <p style="margin: 0 0 18px">מקום נכון הוא חלון פונה מזרח, או שני מטר ממקור אור חזק. שמש ישירה שורפת את העלים בתוך יומיים. מרפסת מוצלת בקיץ מתאימה, אבל לא בחודשי החמסין.</p>
          <p style="margin: 0 0 18px">פעם בחודש בעונת הגדילה מוסיפים שתי טיפות דשן נוזלי למים שבקערה. בחורף מפסיקים לדשן ומורידים לטבילה אחת לעשרה ימים.</p>
        </div>
      </section>
    </div>`;
  }

  // ── CHECKOUT ─────────────────────────────────────────────────────────
  renderCheckout() {
    const s = this.state;
    const pickup = s.method === 'pickup';
    const subtotal = this.subtotal();
    const freeShip = subtotal >= 300;
    const shipping = subtotal === 0 || pickup || freeShip ? 0 : 39;
    const lines = Object.keys(s.cart).map((id) => {
      const p = this.catalog().find((x) => x.id === id);
      const qty = s.cart[id];
      return { name: p.name, qty, lineLabel: this.fmt(p.price * qty) };
    });
    const methodNote = pickup
      ? 'הסטודיו ברחובות, פתוח ראשון עד חמישי בין עשר לשש. נשלח הודעה כשההזמנה מוכנה לאיסוף.'
      : 'שליח עד הבית בתוך שניים עד ארבעה ימי עסקים, באריזת קרטון עם מגן שורשים. חינם מעל 300 ₪.';
    const payNote = s.pay === 'apple' ? 'האישור נעשה בטלפון או בשעון — פרטי הכרטיס לא נשמרים אצלנו.'
      : (s.pay === 'google' ? 'האישור נעשה בחשבון Google שלך, בלי להזין פרטי כרטיס בדף.' : 'הכרטיס נסלק דרך שרת מאובטח. אנחנו לא שומרים את המספר.');
    const payCta = s.pay === 'apple' ? 'תשלום ב־Apple Pay' : (s.pay === 'google' ? 'תשלום ב־Google Pay' : 'אישור ותשלום');
    return `
    <div data-screen-label="לתשלום">
      <section style="padding: clamp(36px, 5vw, 56px) var(--pg) 90px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); gap: 64px; align-items: start">
        <div style="display: flex; flex-direction: column; gap: 30px">
          <div>
            <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">תשלום</span>
            <h1 style="font-size: clamp(30px, 3.2vw, 44px); font-weight: 400; margin-top: 14px">פרטי ההזמנה</h1>
          </div>
          <div style="display: flex; flex-direction: column; gap: 16px">
            <h3 style="font-size: 20px; font-weight: 400">איך לקבל</h3>
            <div style="display: flex; gap: 10px">
              <button class="btn ${pickup ? 'btn-secondary' : 'btn-primary'}" data-act="pickShip">משלוח עד הבית</button>
              <button class="btn ${pickup ? 'btn-primary' : 'btn-secondary'}" data-act="pickPickup">איסוף מהסטודיו ברחובות</button>
            </div>
            <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">${methodNote}</p>
          </div>
          <hr class="hr">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 18px">
            <div class="field"><label for="f-name">שם מלא</label><input class="input" id="f-name" placeholder="שם ושם משפחה"></div>
            <div class="field"><label for="f-phone">טלפון</label><input class="input" id="f-phone" type="tel" placeholder="05X-0000000"></div>
            <div class="field" style="grid-column: 1 / -1"><label for="f-email">דואר אלקטרוני</label><input class="input" id="f-email" type="email" placeholder="name@example.com"></div>
            <div class="field" style="grid-column: 1 / -1"><label for="f-addr">כתובת למשלוח</label><input class="input" id="f-addr" placeholder="רחוב, מספר, דירה"></div>
            <div class="field"><label for="f-city">עיר</label><input class="input" id="f-city" placeholder="רחובות"></div>
            <div class="field"><label for="f-zip">מיקוד</label><input class="input" id="f-zip" placeholder="0000000"></div>
            <div class="field" style="grid-column: 1 / -1"><label for="f-note">הערה לשליח או ברכה לצירוף</label><textarea class="input" id="f-note" placeholder="אופציונלי"></textarea></div>
          </div>
          <hr class="hr">
          <div style="display: flex; flex-direction: column; gap: 16px">
            <h3 style="font-size: 20px; font-weight: 400">אמצעי תשלום</h3>
            <div style="display: flex; gap: 10px; flex-wrap: wrap">
              <button class="btn ${s.pay === 'card' ? 'btn-primary' : 'btn-secondary'}" data-act="payCard">כרטיס אשראי</button>
              <button class="btn ${s.pay === 'apple' ? 'btn-primary' : 'btn-secondary'}" data-act="payApple" style="gap: 8px">${ICON.apple}<span>Apple&nbsp;Pay</span></button>
              <button class="btn ${s.pay === 'google' ? 'btn-primary' : 'btn-secondary'}" data-act="payGoogle" style="gap: 8px">${ICON.google}<span>Google&nbsp;Pay</span></button>
            </div>
            <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">${payNote}</p>
            ${s.pay === 'card' ? `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 18px">
              <div class="field" style="grid-column: 1 / -1"><label for="f-card">מספר כרטיס</label><input class="input" id="f-card" placeholder="0000 0000 0000 0000"></div>
              <div class="field"><label for="f-exp">תוקף</label><input class="input" id="f-exp" placeholder="MM/YY"></div>
              <div class="field"><label for="f-cvv">שלוש ספרות בגב</label><input class="input" id="f-cvv" placeholder="CVV"></div>
            </div>` : ''}
          </div>
        </div>

        <aside class="card" style="padding: clamp(20px, 3vw, 30px); gap: 18px; position: sticky; top: 100px">
          <span class="card-kicker">סיכום</span>
          <h3 style="font-size: 24px; font-weight: 400">${this.cartCount()} פריטים בהזמנה</h3>
          <hr class="hr" style="margin: 0">
          ${lines.map((l) => `
          <div style="display: flex; justify-content: space-between; gap: 14px; font-size: 14px; line-height: 1.6">
            <span>${esc(l.name)} <span style="color: var(--color-neutral-600)">× ${l.qty}</span></span>
            <span style="font-variant-numeric: tabular-nums; white-space: nowrap">${l.lineLabel}</span>
          </div>`).join('')}
          <hr class="hr" style="margin: 0">
          <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--color-neutral-700)"><span>ביניים</span><span style="font-variant-numeric: tabular-nums">${this.fmt(subtotal)}</span></div>
          <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--color-neutral-700)"><span>${pickup ? 'איסוף מהסטודיו' : 'משלוח'}</span><span style="font-variant-numeric: tabular-nums">${subtotal === 0 ? '—' : (pickup ? 'איסוף' : (freeShip ? 'חינם' : this.fmt(39)))}</span></div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 6px; border-top: 1px solid var(--color-divider)">
            <span style="font-size: 16px">לתשלום</span>
            <span style="font-family: var(--font-heading); font-size: 28px; font-variant-numeric: tabular-nums">${this.fmt(subtotal + shipping)}</span>
          </div>
          <button class="btn btn-primary btn-block" style="min-height: 48px">${payCta}</button>
          <p style="margin: 0; font-size: 12px; line-height: 1.7; color: var(--color-neutral-600)">כל כריכה נבדקת ביד לפני האריזה.</p>
        </aside>
      </section>
    </div>`;
  }

  // ── ACCESSIBILITY STATEMENT ──────────────────────────────────────────
  renderAccess() {
    return `
    <div data-screen-label="הצהרת נגישות">
      <section style="padding: clamp(36px, 5vw, 60px) var(--pg) 84px; max-width: 760px">
        <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">נגישות</span>
        <h1 style="font-size: clamp(30px, 3.4vw, 44px); font-weight: 400; margin: 14px 0 26px">הצהרת נגישות</h1>
        <div style="display: flex; flex-direction: column; gap: 22px; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">
          <p style="margin: 0">GAYA רואה בנגישות האתר חלק מהשירות. האתר נבנה בהתאם לתקן הישראלי 5568 ברמת AA, המבוסס על הנחיות WCAG 2.0 של ארגון W3C, ובהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), תשע״ג-2013.</p>
          <div>
            <h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">מה הונגש באתר</h2>
            <ul style="margin: 0; padding-inline-start: 20px; display: flex; flex-direction: column; gap: 7px">
              <li>ניווט מלא במקלדת, עם קישור דילוג לתוכן הראשי וסימון מיקוד ברור.</li>
              <li>מבנה כותרות היררכי, אזורי תוכן מסומנים וטקסט חלופי לתמונות.</li>
              <li>ניגודיות צבע בהתאם לתקן, וטקסט הניתן להגדלה עד 150% בלי אובדן תוכן.</li>
              <li>תפריט נגישות בפינת המסך: הגדלת טקסט, ניגודיות גבוהה והדגשת קישורים.</li>
              <li>כיבוד העדפת המשתמש להפחתת אנימציות במערכת ההפעלה.</li>
              <li>האתר נבדק בדפדפנים Chrome, Safari ו־Firefox, בשולחן עבודה ובנייד.</li>
            </ul>
          </div>
          <div>
            <h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">התאמות בסטודיו</h2>
            <p style="margin: 0">[להשלים: נגישות פיזית של הסטודיו ברחובות — חניית נכים, גישה לכיסא גלגלים, שירותים נגישים, שעות הפעילות.]</p>
          </div>
          <div>
            <h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">מגבלות ידועות</h2>
            <p style="margin: 0">חלק מהתמונות באתר מקורן בצילומי הסטודיו ומתווסף להן תיאור חלופי באופן שוטף. אם נתקלתם בתוכן שאינו נגיש, נשמח לדעת ונטפל בו.</p>
          </div>
          <div>
            <h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">פנייה בנושא נגישות</h2>
            <p style="margin: 0">רכז הנגישות: [שם] · טלפון: [מספר] · דואר אלקטרוני: [כתובת]. נשיב לכל פנייה בתוך שני ימי עסקים.</p>
          </div>
          <p style="margin: 0; font-size: 13.5px; color: var(--color-neutral-600)">ההצהרה עודכנה בתאריך [להשלים].</p>
        </div>
      </section>
    </div>`;
  }

  // ── TERMS / RETURNS / PRIVACY ───────────────────────────────────────
  renderTerms() {
    return `
    <div data-screen-label="תקנון">
      <section style="padding: clamp(36px, 5vw, 60px) var(--pg) 84px; max-width: 760px">
        <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">מידע משפטי</span>
        <h1 style="font-size: clamp(30px, 3.4vw, 44px); font-weight: 400; margin: 14px 0 26px">תקנון, ביטולים ופרטיות</h1>
        <div style="display: flex; flex-direction: column; gap: 24px; font-size: 15.5px; line-height: 1.9; text-align: justify; color: var(--color-neutral-800)">
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">פרטי העוסק</h2><p style="margin: 0">[שם העוסק / החברה], ח.פ. / ע.מ. [מספר], כתובת: [רחוב ומספר], רחובות. טלפון: [מספר]. דואר אלקטרוני: [כתובת].</p></div>
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">מחירים ותשלום</h2><p style="margin: 0">כל המחירים באתר בשקלים חדשים וכוללים מע״מ כדין. התשלום נעשה בכרטיס אשראי, ב־Apple Pay או ב־Google Pay, דרך ספק סליקה מאובטח. פרטי הכרטיס אינם נשמרים בשרתי האתר.</p></div>
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">משלוחים</h2><p style="margin: 0">אספקה בשניים עד ארבעה ימי עסקים לכל הארץ, באריזה עם מגן שורשים. משלוח חינם בהזמנה מעל 300 ₪, אחרת 39 ₪. אפשר גם איסוף עצמי מהסטודיו ברחובות בתיאום מראש.</p></div>
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">ביטול עסקה והחזרות</h2><p style="margin: 0">בהתאם לחוק הגנת הצרכן, תשמ״א-1981 ולתקנות ביטול עסקה, ניתן לבטל עסקת מכר מרחוק בתוך 14 יום מיום קבלת המוצר או מיום קבלת מסמך הגילוי, לפי המאוחר. אדם עם מוגבלות, אזרח ותיק או עולה חדש רשאי לבטל בתוך ארבעה חודשים, בהצגת תעודה. הביטול יימסר בטלפון, בדואר אלקטרוני או בדואר רשום. החזרת המוצר תיעשה כשהוא שלם ובאריזתו, והחזר התשלום יבוצע בתוך 14 יום ממסירת הודעת הביטול, בהפחתת דמי ביטול של עד 5% ממחיר העסקה או 100 ₪, לפי הנמוך. מוצר שנפגם או ניזוק — נטפל בו בנפרד ובלי דמי ביטול.</p></div>
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">פרטיות ועוגיות</h2><p style="margin: 0">הפרטים הנאספים בעת ההזמנה — שם, טלפון, דואר אלקטרוני וכתובת — נדרשים לביצוע ההזמנה ולמשלוח, ומשמשים לכך בלבד. הם נשמרים בהתאם לחוק הגנת הפרטיות, תשמ״א-1981 ואינם מועברים לצד שלישי למעט ספק המשלוחים וספק הסליקה. האתר עושה שימוש בעוגיות תפעוליות לשמירת תוכן העגלה. לכל פנייה בנושא מידע אישי, כולל בקשת עיון, תיקון או מחיקה: [כתובת דואר אלקטרוני].</p></div>
          <div><h2 style="font-size: 21px; font-weight: 400; margin-bottom: 10px">שיפוט</h2><p style="margin: 0">על תקנון זה יחולו דיני מדינת ישראל, וסמכות השיפוט הייחודית תהיה לבתי המשפט במחוז תל אביב.</p></div>
          <p style="margin: 0; font-size: 13.5px; color: var(--color-neutral-600)">התקנון עודכן בתאריך [להשלים]. הסעיפים בסוגריים מרובעים דורשים השלמה בפרטים האמיתיים לפני עלייה לאוויר.</p>
        </div>
      </section>
    </div>`;
  }

  // ── ADMIN GATE ───────────────────────────────────────────────────────
  renderAdminGate() {
    const s = this.state;
    return `
    <div data-screen-label="כניסת צוות" style="display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 40px var(--pg)">
      <div class="card" style="max-width: 360px; width: 100%; padding: clamp(24px, 4vw, 34px); gap: 18px">
        <span class="card-kicker">כניסת צוות</span>
        <h1 style="font-size: 24px; font-weight: 400">אזור ניהול</h1>
        <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">המסך הזה מיועד לצוות GAYA בלבד. הזינו את קוד הצוות כדי להמשיך.</p>
        <div class="field">
          <label for="adm-pass">קוד צוות</label>
          <input class="input" id="adm-pass" type="password" data-adm-pass="1" value="${esc(s.admPass)}" placeholder="••••••••" autocomplete="off">
        </div>
        ${s.admGateError ? `<p style="margin: 0; font-size: 13px; color: var(--color-accent-700)">קוד שגוי, נסו שוב.</p>` : ''}
        <button class="btn btn-primary btn-block" data-act="admGateSubmit">כניסה</button>
        <button class="btn btn-ghost" data-act="goHome" style="border: 0">חזרה לחנות</button>
      </div>
    </div>`;
  }

  // ── ADMIN ────────────────────────────────────────────────────────────
  renderAdmin() {
    const s = this.state;
    const all = this.catalog();
    const admTotal = all.length;
    const admUnits = all.reduce((t, p) => t + this.stockOf(p.id), 0);
    const admLow = all.filter((p) => { const q = this.stockOf(p.id); return q > 0 && q <= 2; }).length;
    const admOut = all.filter((p) => this.stockOf(p.id) === 0).length;
    const admNoImg = all.filter((p) => !p.img && !p.embed && !p.model).length;
    return `
    <div data-screen-label="ניהול">
      <section style="padding: clamp(36px, 5vw, 56px) var(--pg) 28px">
        <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.3em; color: var(--color-accent-700)">ניהול</span>
        <h1 style="font-size: clamp(30px, 3.4vw, 44px); font-weight: 400; margin: 14px 0 22px">ניהול</h1>
        <div style="display: flex; gap: 10px; margin-bottom: 26px; flex-wrap: wrap">
          <button class="btn ${s.admTab === 'products' ? 'btn-primary' : 'btn-secondary'}" data-act="admGoProducts" style="gap: 8px">${ICON.bag}<span>מוצרים ומלאי</span></button>
          <button class="btn ${s.admTab === 'orders' ? 'btn-primary' : 'btn-secondary'}" data-act="admGoOrders" style="gap: 8px">${ICON.calendar}<span>יומן הזמנות</span></button>
          <button class="btn ${s.admTab === 'site' ? 'btn-primary' : 'btn-secondary'}" data-act="admGoSite" style="gap: 8px">${ICON.site}<span>ניהול האתר</span></button>
        </div>
        ${s.admTab === 'products' ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: 14px; padding-bottom: 26px; border-bottom: 1px solid var(--color-divider)">
          <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">פריטים בקטלוג</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${admTotal}</span></div>
          <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">יחידות במלאי</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${admUnits}</span></div>
          <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">מלאי נמוך</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums; color: var(--color-accent-700)">${admLow}</span></div>
          <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">אזל</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${admOut}</span></div>
          <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">חסרה תמונה</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${admNoImg}</span></div>
        </div>` : ''}
      </section>
      ${s.admTab === 'products' ? this.renderAdminProducts() : ''}
      ${s.admTab === 'orders' ? this.renderAdminOrders() : ''}
      ${s.admTab === 'site' ? this.renderAdminSite() : ''}
    </div>`;
  }

  renderAdminProducts() {
    const s = this.state;
    const all = this.catalog();
    const rows = all.filter((p) => {
      const q = this.stockOf(p.id);
      if (s.admFilter === 'kok') return p.cat !== 'hydro';
      if (s.admFilter === 'hyd') return p.cat === 'hydro';
      if (s.admFilter === 'low') return q <= 2;
      if (s.admFilter === 'new') return !!p.isNew;
      return true;
    });
    return `
    <section style="padding: 0 var(--pg) 30px">
      <div class="card" style="padding: clamp(18px, 2.4vw, 26px); gap: 18px; margin-top: 16px; flex-direction: row; align-items: flex-start; flex-wrap: wrap">
        <div class="plate" style="position: relative; width: 132px; aspect-ratio: 4/5; overflow: hidden; flex: 0 0 auto"><img src="${STORY_IMG_1}" alt="תמונת מדור הסטודיו"></div>
        <div style="flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px">
          <span class="card-kicker">מדור הסטודיו</span>
          <h2 style="font-size: 20px; font-weight: 400">התמונה בסיפור העסק</h2>
          <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">התמונה שמופיעה לצד הסיפור בדף הבית. פריים אנכי מתאים לה — היחס בעמוד הוא ארבע על חמש. להחלפתה יש לעדכן את הקובץ assets/images/plant-16.jpg. את הטקסט עצמו משנים בלשונית ניהול האתר.</p>
        </div>
      </div>
      <div class="card" style="padding: clamp(18px, 2.4vw, 26px); gap: 18px; margin-top: 16px; flex-direction: row; align-items: flex-start; flex-wrap: wrap">
        <div class="plate" style="position: relative; width: 168px; aspect-ratio: 3/2; overflow: hidden; flex: 0 0 auto"><img src="${STORY_IMG_2}" alt="פינה בסטודיו"></div>
        <div style="flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px">
          <span class="card-kicker">מדור הסטודיו</span>
          <h2 style="font-size: 20px; font-weight: 400">התמונה השנייה בסיפור</h2>
          <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">התמונה שיושבת מתחת לסיפור, מול ההסבר על הקוקודמה. להחלפתה יש לעדכן את הקובץ assets/images/plant-18.jpg.</p>
        </div>
      </div>

      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; padding: 24px 0">
        <div style="display: flex; gap: 10px; flex-wrap: wrap">
          <button class="btn ${s.admFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" data-act="admShowAll">הכל</button>
          <button class="btn ${s.admFilter === 'kok' ? 'btn-primary' : 'btn-secondary'}" data-act="admShowKok">קוקודמות</button>
          <button class="btn ${s.admFilter === 'hyd' ? 'btn-primary' : 'btn-secondary'}" data-act="admShowHyd">הידרופוני</button>
          <button class="btn ${s.admFilter === 'low' ? 'btn-primary' : 'btn-secondary'}" data-act="admShowLow">מלאי נמוך</button>
          <button class="btn ${s.admFilter === 'new' ? 'btn-primary' : 'btn-secondary'}" data-act="admShowNew">חדשים</button>
        </div>
        <button class="btn btn-primary" data-act="admOpenNew" style="gap: 8px">${ICON.plus15}<span>מוצר חדש</span></button>
      </div>

      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch">
      <table class="table" style="min-width: 680px">
        <thead><tr>
          <th style="text-align: start">מוצר</th><th style="text-align: start">קטגוריה</th><th style="text-align: start">מחיר</th>
          <th style="text-align: start">מלאי</th><th style="text-align: start">מצב</th><th style="text-align: start">תמונה</th><th style="text-align: start">פעולות</th>
        </tr></thead>
        <tbody>
          ${rows.map((p) => {
            const q = this.stockOf(p.id);
            const stateLabel = q === 0 ? 'אזל' : (q <= 2 ? 'מלאי נמוך' : 'במלאי');
            const stateTag = q === 0 ? 'tag-outline' : (q <= 2 ? 'tag-accent' : 'tag-neutral');
            const imgLabel = p.img ? '—' : ((p.embed || p.model) ? 'תלת־ממד' : 'חסרה');
            return `
          <tr>
            <td><span style="display: flex; align-items: center; gap: 12px">
              <span role="img" aria-label="${esc(p.name)}" style="position: relative; width: 40px; height: 50px; flex: 0 0 auto; border: 1px solid var(--color-divider); background-color: var(--color-neutral-200); background-image: ${p.img ? `url('${p.img}')` : 'none'}; background-size: cover; background-position: center; display: block"></span>
              <span>
                <button data-act="admEdit" data-id="${p.id}" style="background: none; border: 0; padding: 0; font-family: var(--font-body); font-size: inherit; color: inherit; cursor: pointer; text-align: start; text-decoration: underline; text-decoration-color: var(--color-neutral-400)">${esc(p.name)}</button>
                ${p.isNew ? `<span class="tag tag-accent" style="margin-inline-start: 8px">חדש</span>` : ''}
              </span>
            </span></td>
            <td>${p.cat === 'hydro' ? 'הידרופוני' : 'קוקודמה'}</td>
            <td style="font-variant-numeric: tabular-nums">${this.fmt(p.price)}</td>
            <td><span class="seg" style="display: inline-flex">
              <button class="seg-opt" data-act="admDec" data-id="${p.id}" aria-label="הפחתת יחידה">${ICON.minus}</button>
              <span class="seg-opt" style="min-width: 40px; justify-content: center; font-variant-numeric: tabular-nums">${q}</span>
              <button class="seg-opt" data-act="admInc" data-id="${p.id}" aria-label="הוספת יחידה">${ICON.plus}</button>
            </span></td>
            <td><span class="tag ${stateTag}">${stateLabel}</span></td>
            <td>${imgLabel}</td>
            <td><span style="display: flex; gap: 6px">
              <button class="btn btn-secondary btn-icon" data-act="admEdit" data-id="${p.id}" aria-label="עריכת ${esc(p.name)}">${ICON.edit}</button>
              <button class="btn btn-secondary btn-icon" data-act="open" data-id="${p.id}" aria-label="צפייה בחנות ב${esc(p.name)}">${ICON.eye}</button>
            </span></td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
      <p style="margin: 22px 0 0; font-size: 13px; line-height: 1.8; color: var(--color-neutral-600)">שינויי מלאי ומוצרים חדשים נשמרים בזיכרון הדפדפן לצורך התצוגה, וחוזרים לערכי המקור ברענון העמוד. חיבור למערכת אמיתית דורש שרת.</p>
    </section>`;
  }

  renderAdminOrders() {
    const s = this.state;
    const shaped = ORDERS.map((o) => {
      const st = this.ordStateOf(o.ref);
      const meta = ORD_STATE[st];
      const qty = o.items.reduce((t, [, q]) => t + q, 0);
      return { o, state: st, meta, qty, total: this.ordTotalOf(o) };
    });
    const rows = shaped.filter((r) => s.ordFilter === 'all' || r.state === s.ordFilter);
    return `
    <section style="padding: 0 var(--pg) 80px">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 14px; padding-bottom: 26px; border-bottom: 1px solid var(--color-divider)">
        <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">הזמנות החודש</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${ORDERS.length}</span></div>
        <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">ממתינות לטיפול</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums; color: var(--color-accent-700)">${shaped.filter((r) => r.state !== 'sent').length}</span></div>
        <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">נשלחו</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${shaped.filter((r) => r.state === 'sent').length}</span></div>
        <div class="card" style="padding: 18px; gap: 6px"><span class="card-kicker">מחזור</span><span style="font-family: var(--font-heading); font-size: 30px; font-variant-numeric: tabular-nums">${this.fmt(shaped.reduce((t, r) => t + r.total, 0))}</span></div>
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap; padding: 24px 0">
        <button class="btn ${s.ordFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" data-act="ordShowAll">הכל</button>
        <button class="btn ${s.ordFilter === 'new' ? 'btn-primary' : 'btn-secondary'}" data-act="ordShowNew">חדשות</button>
        <button class="btn ${s.ordFilter === 'prep' ? 'btn-primary' : 'btn-secondary'}" data-act="ordShowPrep">בהכנה</button>
        <button class="btn ${s.ordFilter === 'sent' ? 'btn-primary' : 'btn-secondary'}" data-act="ordShowSent">נשלחו</button>
      </div>
      <div style="overflow-x: auto; -webkit-overflow-scrolling: touch">
      <table class="table" style="min-width: 680px">
        <thead><tr>
          <th style="text-align: start">הזמנה</th><th style="text-align: start">תאריך</th><th style="text-align: start">לקוח</th><th style="text-align: start">פריטים</th>
          <th style="text-align: start">סכום</th><th style="text-align: start">אספקה</th><th style="text-align: start">מצב</th><th style="text-align: start">פעולות</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
          <tr>
            <td style="font-variant-numeric: tabular-nums">${r.o.ref}</td>
            <td style="font-variant-numeric: tabular-nums; color: var(--color-neutral-700)">${r.o.date}</td>
            <td>${esc(r.o.customer)}</td>
            <td style="color: var(--color-neutral-700)">${r.qty}${r.qty === 1 ? ' פריט' : ' פריטים'}</td>
            <td style="font-variant-numeric: tabular-nums">${this.fmt(r.total)}</td>
            <td style="color: var(--color-neutral-700)">${r.o.method}</td>
            <td><span class="tag ${r.meta.tag}">${r.meta.label}</span></td>
            <td><span style="display: flex; gap: 6px">
              ${r.meta.next ? `<button class="btn btn-secondary" data-act="ordAdvance" data-id="${r.o.ref}" style="padding: 6px 12px; font-size: 13px; min-height: 0">${r.meta.nextLabel}</button>` : ''}
              <button class="btn btn-secondary btn-icon" data-act="ordOpen" data-id="${r.o.ref}" aria-label="פרטי הזמנה ${r.o.ref}">${ICON.eye}</button>
            </span></td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <p style="margin: 22px 0 0; font-size: 13px; line-height: 1.8; color: var(--color-neutral-600)">היומן מוצג לצורך הדמו עם הזמנות לדוגמה. חיבור להזמנות אמיתיות דורש שרת וסליקה.</p>
    </section>`;
  }

  renderAdminSite() {
    const s = this.state;
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    return `
    <section style="padding: 0 var(--pg) 80px; max-width: 900px">
      <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.85; text-align: justify; color: var(--color-neutral-800)">כל שינוי כאן מופיע מיד באתר. השדות מסודרים לפי המדור שבו הטקסט מוצג.</p>
      <div style="display: flex; flex-direction: column; gap: 34px">
        ${SITE_FIELDS.map((grp, gi) => `
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div style="display: flex; align-items: baseline; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--color-divider)">
            <span aria-hidden="true" style="font-family: var(--font-heading); font-size: 26px; font-weight: 300; line-height: 1; color: color-mix(in srgb, var(--color-accent) 42%, transparent)">${numerals[gi] || String(gi + 1)}</span>
            <h2 style="font-size: 21px; font-weight: 400">${esc(grp.group)}</h2>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 18px">
            ${grp.keys.map(([key, label, kind]) => `
            <div class="field">
              <label for="site-${key}">${esc(label)}</label>
              ${kind === 'line'
                ? `<input class="input" id="site-${key}" data-site-key="${key}" value="${esc(s.site[key])}">`
                : `<textarea class="input" id="site-${key}" data-site-key="${key}" style="min-height: 88px">${esc(s.site[key])}</textarea>`}
            </div>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      <div style="display: flex; gap: 12px; align-items: center; margin-top: 34px; padding-top: 24px; border-top: 1px solid var(--color-divider); flex-wrap: wrap">
        <button class="btn btn-secondary" data-act="goHome">צפייה בדף הבית</button>
        <button class="btn btn-ghost" data-act="siteReset" style="border: 0">החזרה לטקסטים המקוריים</button>
      </div>
    </section>`;
  }

  // ── slide-over: product editor ──────────────────────────────────────
  renderProductEditorPanel() {
    const s = this.state;
    const open = s.admForm;
    const nf = s.nf;
    return `
    <div data-act="admCloseNew" aria-hidden="true" style="position: fixed; inset: 0; background: rgba(24,30,24,0.34); z-index: 64; transition: opacity 0.28s ease; opacity: ${open ? 1 : 0}; pointer-events: ${open ? 'auto' : 'none'}"></div>
    <aside role="dialog" aria-label="עריכת מוצר" style="position: fixed; inset-block: 0; inset-inline-start: 0; z-index: 66; width: min(440px, 92vw); background: var(--color-neutral-100); border-inline-end: 1px solid var(--color-divider); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; transition: transform 0.32s cubic-bezier(0.22,0.61,0.36,1), visibility 0s linear ${open ? '0s' : '0.32s'}; transform: ${open ? 'translateX(0)' : 'translateX(105%)'}; visibility: ${open ? 'visible' : 'hidden'}">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 21px 26px; border-bottom: 1px solid var(--color-divider)">
        <h2 style="font-size: 22px; font-weight: 400">${s.editId ? 'עריכת מוצר' : 'הוספת מוצר'}</h2>
        <button class="btn btn-secondary btn-icon" data-act="admCloseNew" aria-label="סגירת הטופס">${ICON.close}</button>
      </div>
      <div style="flex: 1; overflow-y: auto; padding: 22px 26px; display: flex; flex-direction: column; gap: 20px">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 18px">
          <div class="field" style="grid-column: 1 / -1"><label for="a-name">שם המוצר</label><input class="input" id="a-name" data-nf-field="name" value="${esc(nf.name)}" placeholder="קוקודמה ..."></div>
          <div class="field"><label for="a-price">מחיר בשקלים</label><input class="input" id="a-price" data-nf-field="price" type="number" value="${esc(nf.price)}" placeholder="250"></div>
          <div class="field"><label for="a-stock">יחידות במלאי</label><input class="input" id="a-stock" data-nf-field="stock" type="number" value="${esc(nf.stock)}" placeholder="6"></div>
          <div class="field"><label for="a-cat">קטגוריה</label>
            <div class="seg" id="a-cat">
              <button class="seg-opt" data-act="nfSetKok" aria-pressed="${nf.cat === 'kokedama'}" style="background: ${nf.cat === 'kokedama' ? 'var(--color-accent-100)' : 'transparent'}; color: ${nf.cat === 'kokedama' ? 'var(--color-accent-800)' : 'var(--color-text)'}">קוקודמה</button>
              <button class="seg-opt" data-act="nfSetHyd" aria-pressed="${nf.cat === 'hydro'}" style="background: ${nf.cat === 'hydro' ? 'var(--color-accent-100)' : 'transparent'}; color: ${nf.cat === 'hydro' ? 'var(--color-accent-800)' : 'var(--color-text)'}">הידרופוני</button>
            </div>
          </div>
          <div class="field"><label for="a-size">גודל</label><input class="input" id="a-size" data-nf-field="size" value="${esc(nf.size)}" placeholder="בינונית"></div>
          <div class="field"><label for="a-light">אור</label><input class="input" id="a-light" data-nf-field="light" value="${esc(nf.light)}" placeholder="אור עקיף בהיר"></div>
          <div class="field"><label for="a-water">השקיה</label><input class="input" id="a-water" data-nf-field="water" value="${esc(nf.water)}" placeholder="טבילה אחת לשבוע"></div>
          <div class="field" style="grid-column: 1 / -1"><label for="a-desc">תיאור</label><textarea class="input" id="a-desc" data-nf-field="desc" placeholder="שתי שורות על הצמח ועל הטיפול בו">${esc(nf.desc)}</textarea></div>
        </div>
        <div style="display: grid; grid-template-columns: 132px 1fr; gap: 18px; align-items: start">
          <div class="plate" style="position: relative; width: 132px; aspect-ratio: 4/5; overflow: hidden; background: var(--color-neutral-200); display: grid; place-items: center; font-family: var(--font-heading); font-size: 12px; letter-spacing: 0.18em; color: var(--color-neutral-800)">תמונה</div>
          <p style="margin: 0; font-size: 13.5px; line-height: 1.8; color: var(--color-neutral-700)">${s.editId ? 'להחלפת התמונה יש להוסיף קובץ לתיקייה assets/images ולעדכן את הנתיב בקטלוג (js/data.js). אותה תמונה מופיעה בכרטיס המוצר בקטלוג.' : 'מוצר חדש נוצר בלי תמונה ומסומן בקטלוג הניהול. תמונה מתווספת מאוחר יותר בקוד.'}</p>
        </div>
      </div>
      <div style="border-top: 1px solid var(--color-divider); padding: 20px 26px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--color-bg)">
        <button class="btn btn-primary" data-act="nfSave">${s.editId ? 'שמירת שינויים' : 'הוספה לקטלוג'}</button>
        <button class="btn btn-secondary" data-act="admCloseNew">ביטול</button>
        ${s.editId ? `<button class="btn btn-ghost" data-act="nfDelete" style="border: 0; margin-inline-start: auto">הסרה מהקטלוג</button>` : ''}
      </div>
    </aside>`;
  }

  // ── slide-over: order detail ────────────────────────────────────────
  renderOrderPanel() {
    const s = this.state;
    const sel = ORDERS.find((o) => o.ref === s.ordOpenRef);
    const open = !!sel;
    const state = sel ? ORD_STATE[this.ordStateOf(sel.ref)] : null;
    const lines = sel ? sel.items.map(([id, q]) => {
      const p = this.ordCatalog().find((x) => x.id === id);
      return { name: p ? p.name : id, qty: q, lineLabel: this.fmt(p ? p.price * q : 0) };
    }) : [];
    return `
    <div data-act="ordClose" aria-hidden="true" style="position: fixed; inset: 0; background: rgba(24,30,24,0.34); z-index: 64; transition: opacity 0.28s ease; opacity: ${open ? 1 : 0}; pointer-events: ${open ? 'auto' : 'none'}"></div>
    <aside role="dialog" aria-label="פרטי הזמנה" style="position: fixed; inset-block: 0; inset-inline-start: 0; z-index: 66; width: min(420px, 92vw); background: var(--color-neutral-100); border-inline-end: 1px solid var(--color-divider); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; transition: transform 0.32s cubic-bezier(0.22,0.61,0.36,1), visibility 0s linear ${open ? '0s' : '0.32s'}; transform: ${open ? 'translateX(0)' : 'translateX(105%)'}; visibility: ${open ? 'visible' : 'hidden'}">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 21px 26px; border-bottom: 1px solid var(--color-divider)">
        <h2 style="font-size: 22px; font-weight: 400">הזמנה ${sel ? sel.ref : ''}</h2>
        <button class="btn btn-secondary btn-icon" data-act="ordClose" aria-label="סגירת הפרטים">${ICON.close}</button>
      </div>
      <div style="flex: 1; overflow-y: auto; padding: 22px 26px; display: flex; flex-direction: column; gap: 20px">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          ${state ? `<span class="tag ${state.tag}">${state.label}</span>` : ''}
          <span style="font-size: 13px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums">${sel ? sel.date : ''}</span>
        </div>
        <table class="table" style="width: 100%"><tbody>
          <tr><td style="color: var(--color-neutral-600); width: 38%">לקוח</td><td>${sel ? esc(sel.customer) : ''}</td></tr>
          <tr><td style="color: var(--color-neutral-600)">טלפון</td><td style="font-variant-numeric: tabular-nums">${sel ? sel.phone : ''}</td></tr>
          <tr><td style="color: var(--color-neutral-600)">אספקה</td><td>${sel ? sel.method : ''}</td></tr>
          <tr><td style="color: var(--color-neutral-600)">כתובת</td><td>${sel ? esc(sel.address) : ''}</td></tr>
          <tr><td style="color: var(--color-neutral-600)">תשלום</td><td>${sel ? sel.pay : ''}</td></tr>
        </tbody></table>
        <div style="display: flex; flex-direction: column; gap: 12px">
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.28em; color: var(--color-neutral-600)">פריטים</span>
          ${lines.map((l) => `
          <div style="display: flex; justify-content: space-between; gap: 14px; font-size: 14px; line-height: 1.6; padding-bottom: 10px; border-bottom: 1px solid var(--color-divider)">
            <span>${esc(l.name)} <span style="color: var(--color-neutral-600)">× ${l.qty}</span></span>
            <span style="font-variant-numeric: tabular-nums; white-space: nowrap">${l.lineLabel}</span>
          </div>`).join('')}
          ${sel ? `
          <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--color-neutral-700); padding-top: 4px"><span>ביניים</span><span style="font-variant-numeric: tabular-nums">${this.fmt(this.ordSubtotalOf(sel))}</span></div>
          <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--color-neutral-700)"><span>${sel.method}</span><span style="font-variant-numeric: tabular-nums">${this.ordShipOf(sel) === 0 ? 'חינם' : this.fmt(this.ordShipOf(sel))}</span></div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; padding-top: 6px; border-top: 1px solid var(--color-divider)">
            <span style="font-size: 15px">סה״כ</span>
            <span style="font-family: var(--font-heading); font-size: 24px; font-variant-numeric: tabular-nums">${this.fmt(this.ordTotalOf(sel))}</span>
          </div>` : ''}
        </div>
        ${sel && sel.note ? `
        <div style="display: flex; flex-direction: column; gap: 8px">
          <span style="font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.28em; color: var(--color-neutral-600)">הערה</span>
          <p style="margin: 0; font-size: 14px; line-height: 1.8; color: var(--color-neutral-800)">${esc(sel.note)}</p>
        </div>` : ''}
      </div>
      <div style="border-top: 1px solid var(--color-divider); padding: 20px 26px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--color-bg)">
        ${state && state.next ? `<button class="btn btn-primary" data-act="ordAdvance">${state.nextLabel}</button>` : ''}
        <button class="btn btn-secondary" data-act="ordClose">סגירה</button>
      </div>
    </aside>`;
  }
}

new App(document.getElementById('root'));
