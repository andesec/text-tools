const APP_VERSION = '1.0.0';

(function() {
  const existing = document.querySelector('footer');
  if (existing) {
    const sep = existing.querySelector('p') ? ' · ' : '';
    const v = document.createElement('span');
    v.className = 'version';
    v.textContent = `${sep}v${APP_VERSION}`;
    (existing.querySelector('p') || existing).appendChild(v);
    return;
  }
  const f = document.createElement('footer');
  f.style.cssText = 'text-align:center;padding:1rem;color:var(--text-tertiary, #999);font-size:0.8rem;border-top:1px solid var(--border-default, #eee);margin-top:auto';
  f.textContent = `v${APP_VERSION}`;
  document.body.appendChild(f);
})();
