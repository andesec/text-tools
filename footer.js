const APP_VERSION = '1.0.0';

function buildFooterLinks() {
	const embedLink = document.createElement('a');
	embedLink.href = 'embed.html';
	embedLink.textContent = 'Embed';
	embedLink.style.cssText = 'color: var(--text-secondary, #999); text-decoration: none;';
	embedLink.addEventListener('mouseenter', () => embedLink.style.textDecoration = 'underline');
	embedLink.addEventListener('mouseleave', () => embedLink.style.textDecoration = 'none');

	const sep = document.createTextNode(' \u00b7 ');

	const version = document.createElement('span');
	version.className = 'version';
	version.textContent = `v${APP_VERSION}`;

	const frag = document.createDocumentFragment();
	frag.appendChild(embedLink);
	frag.appendChild(sep);
	frag.appendChild(version);
	return frag;
}

(function () {
	const footers = document.querySelectorAll('footer');
	if (footers.length > 0) {
		footers.forEach((existing) => {
			const target = existing.querySelector('p') || existing;
			if (target.textContent.trim()) {
				target.appendChild(document.createTextNode(' \u00b7 '));
			}
			target.appendChild(buildFooterLinks());
		});
		return;
	}

	const f = document.createElement('footer');
	f.style.cssText = 'text-align:center;padding:1rem;color:var(--text-tertiary, #999);font-size:0.8rem;border-top:1px solid var(--border-default, #eee);margin-top:auto';
	f.appendChild(buildFooterLinks());
	document.body.appendChild(f);
})();
