/* The container that holds the games. Each game owns a top-level element and
   its own element ids; the shell only swaps which one is visible, keeps the
   masthead in step, and routes the hash.

   Deliberately not the `$`-scoped refactor sketched in docs/shell-architecture.md.
   That rewrites fifty working, tested call sites in Game 100 to solve an id
   collision that does not exist yet - the two games share no ids. If a third
   game ever wants to reuse them, do it then. */

const GAMES = [];
let current = null;

const Shell = {
  register(g){ GAMES.push(g); },
  get current(){ return current; },
  get games(){ return GAMES.slice(); },
  show(id){ return go(id); },      // the menu's route, also how tests switch
};

function paint(g){
  document.getElementById('game-title').textContent = g.title;
  document.getElementById('game-tagline').textContent = g.tagline;
  document.title = `${g.title} · A Game of Numbers`;
  for (const other of GAMES)
    document.getElementById(other.el).classList.toggle('hidden', other !== g);
  const menu = document.getElementById('switch-menu');
  menu.querySelectorAll('[data-game]').forEach(b =>
    b.setAttribute('aria-current', String(b.dataset.game === g.id)));
}

async function go(id, {push = true} = {}){
  const g = GAMES.find(x => x.id === id) || GAMES[0];
  if (!g) return;
  /* a draft in progress is only in memory - leaving loses it */
  if (current && current !== g && current.isDirty && current.isDirty()){
    if (!confirm(`Leave ${current.title}? The game in progress will be lost.`)) return;
  }
  if (current && current !== g && current.leave) current.leave();
  current = g;
  paint(g);
  if (!g.booted){ g.booted = true; await g.boot(); }
  else if (g.enter) g.enter();
  if (push && location.hash !== '#/' + g.id) history.replaceState(null, '', '#/' + g.id);
  closeMenu();
}

function closeMenu(){
  const b = document.getElementById('switch-btn'), m = document.getElementById('switch-menu');
  if (!b) return;
  b.setAttribute('aria-expanded', 'false');
  m.classList.add('hidden');
}

function buildMenu(){
  const btn = document.getElementById('switch-btn');
  const menu = document.getElementById('switch-menu');
  menu.innerHTML = GAMES.map(g => `
    <li role="none"><button role="menuitem" data-game="${g.id}">
      <span class="t">${g.title}</span><span class="d">${g.tagline}</span>
    </button></li>`).join('');
  menu.querySelectorAll('[data-game]').forEach(b =>
    b.onclick = () => go(b.dataset.game));

  btn.onclick = e => {
    e.stopPropagation();
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    menu.classList.toggle('hidden', open);
    if (!open){ const f = menu.querySelector('button'); if (f) f.focus(); }
  };
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== btn) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true'){
      closeMenu(); btn.focus();
    }
    if (menu.classList.contains('hidden')) return;
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown'){ e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
}

function boot(){
  if (!GAMES.length) return;          // nothing registered; nothing to show
  buildMenu();
  const fromHash = () => (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  addEventListener('hashchange', () => go(fromHash(), {push: false}));
  go(fromHash() || GAMES[0].id);
}

/* The games register when their own script runs, which is after this one. Both
   paths below therefore have to yield first - booting inline would find an
   empty registry and show nothing. */
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else setTimeout(boot, 0);
